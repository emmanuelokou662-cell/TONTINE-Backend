import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/errorHandler';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';

export interface DeclareContributionInput {
  id_membre_groupe: string;
  id_tour?: string;
  montant: number;
  moyen_paiement: 'MTN_Money' | 'Wave';
  numero_tx_operateur: string;
  preuve_capture_url?: string;
  synced_at?: Date;
}

/**
 * Déclarer une cotisation Mobile Money avec preuve (RF-06)
 */
export const declareContribution = async (input: DeclareContributionInput) => {
  const normalizedTx = input.numero_tx_operateur.trim();

  // Règle de sécurité RF-210 : Anti-doublon strict sur le numéro de transaction opérateur
  const existingTx = await prisma.transaction.findUnique({
    where: { numero_tx_operateur: normalizedTx }
  });

  if (existingTx) {
    throw new AppError(
      'Ce numéro de transaction opérateur a déjà été enregistré sur la plateforme.',
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.TRANSACTION_DUPLICATE
    );
  }

  const member = await prisma.membreGroupe.findUnique({
    where: { id: input.id_membre_groupe },
    include: {
      utilisateur: true,
      groupe: true
    }
  });

  if (!member || member.statut === 'retire') {
    throw new AppError('Membre introuvable ou inactif dans ce groupe.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.MEMBER_NOT_FOUND);
  }

  const transaction = await prisma.transaction.create({
    data: {
      id_membre_groupe: input.id_membre_groupe,
      id_tour: input.id_tour,
      type: 'depot',
      montant: input.montant,
      moyen_paiement: input.moyen_paiement,
      numero_tx_operateur: normalizedTx,
      preuve_capture_url: input.preuve_capture_url,
      statut: 'en_attente',
      synced_at: input.synced_at || new Date()
    }
  });

  // Notifier l'administrateur principal du groupe (RF-06)
  await prisma.notification.create({
    data: {
      id_utilisateur: member.groupe.id_admin_principal,
      id_groupe: member.id_groupe,
      type: 'validation',
      message: `${member.utilisateur.prenom} ${member.utilisateur.nom} a déclaré une cotisation de ${input.montant.toLocaleString('fr-FR')} FCFA (${input.moyen_paiement}).`
    }
  });

  return transaction;
};

/**
 * Valider une cotisation déclarée par un membre (RF-07)
 */
export const validateContribution = async (transactionId: string, adminUserId: string) => {
  const tx = await prisma.transaction.findUnique({
    where: { id_transaction: transactionId },
    include: {
      membre_groupe: {
        include: { utilisateur: true, groupe: true }
      }
    }
  });

  if (!tx) {
    throw new AppError('Transaction introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.TRANSACTION_NOT_FOUND);
  }

  if (tx.statut !== 'en_attente') {
    throw new AppError('Cette transaction a déjà été traitée.', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.TRANSACTION_ALREADY_PROCESSED);
  }

  return prisma.$transaction(async (prismaTx) => {
    // 1. Mettre à jour la transaction
    const updatedTx = await prismaTx.transaction.update({
      where: { id_transaction: transactionId },
      data: {
        statut: 'confirme',
        id_validateur: adminUserId
      }
    });

    // 2. Remettre le compteur de retards consécutifs à 0 (RF-15)
    await prismaTx.membreGroupe.update({
      where: { id: tx.id_membre_groupe },
      data: { retards_consecutifs: 0 }
    });

    // 3. Notifier le membre par push Web (RF-07)
    await prismaTx.notification.create({
      data: {
        id_utilisateur: tx.membre_groupe.id_utilisateur,
        id_groupe: tx.membre_groupe.id_groupe,
        type: 'validation',
        message: `Votre cotisation de ${tx.montant.toLocaleString('fr-FR')} FCFA a été validée avec succès par l'administrateur.`
      }
    });

    return updatedTx;
  });
};

/**
 * Rejeter une cotisation avec motif obligatoire (RF-07)
 */
export const rejectContribution = async (transactionId: string, adminUserId: string, motif: string) => {
  const tx = await prisma.transaction.findUnique({
    where: { id_transaction: transactionId },
    include: {
      membre_groupe: {
        include: { utilisateur: true, groupe: true }
      }
    }
  });

  if (!tx) {
    throw new AppError('Transaction introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.TRANSACTION_NOT_FOUND);
  }

  if (tx.statut !== 'en_attente') {
    throw new AppError('Cette transaction a déjà été traitée.', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.TRANSACTION_ALREADY_PROCESSED);
  }

  return prisma.$transaction(async (prismaTx) => {
    const updatedTx = await prismaTx.transaction.update({
      where: { id_transaction: transactionId },
      data: {
        statut: 'rejete',
        motif_rejet: motif.trim(),
        id_validateur: adminUserId
      }
    });

    // Incrémenter les retards consécutifs si rejet pour impayé (RF-15)
    const newRetards = tx.membre_groupe.retards_consecutifs + 1;
    let newStatus = tx.membre_groupe.statut;
    if (newRetards >= 2) {
      newStatus = 'suspecte'; // Signalement automatique après 2 retards consécutifs (RF-15)
    }

    await prismaTx.membreGroupe.update({
      where: { id: tx.id_membre_groupe },
      data: {
        retards_consecutifs: newRetards,
        statut: newStatus
      }
    });

    // Notification au membre avec le motif de rejet (RF-07)
    await prismaTx.notification.create({
      data: {
        id_utilisateur: tx.membre_groupe.id_utilisateur,
        id_groupe: tx.membre_groupe.id_groupe,
        type: 'rejet',
        message: `Votre cotisation de ${tx.montant.toLocaleString('fr-FR')} FCFA a été rejetée. Motif : ${motif.trim()}`
      }
    });

    return updatedTx;
  });
};

/**
 * Récupérer les transactions d'un groupe avec filtres (RF-08)
 */
export const getGroupTransactions = async (groupId: string, statut?: string) => {
  return prisma.transaction.findMany({
    where: {
      membre_groupe: { id_groupe: groupId },
      ...(statut ? { statut } : {})
    },
    include: {
      membre_groupe: {
        include: {
          utilisateur: {
            select: { id_utilisateur: true, nom: true, prenom: true, photo_profil_url: true }
          }
        }
      },
      validateur: {
        select: { id_utilisateur: true, nom: true, prenom: true }
      }
    },
    orderBy: { created_at: 'desc' }
  });
};
