import { Transaction, GroupMember, Group, User, Notification, Cycle } from '../models';
import { AppError } from '../middlewares/errorHandler';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';
import { socketManager } from './socketManager';
import mongoose from 'mongoose';

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
  const existingTx = await Transaction.findOne({ numero_tx_operateur: normalizedTx });

  if (existingTx) {
    throw new AppError(
      'Ce numéro de transaction opérateur a déjà été enregistré sur la plateforme.',
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.TRANSACTION_DUPLICATE
    );
  }

  const memberObjId = new mongoose.Types.ObjectId(input.id_membre_groupe);
  const member = await GroupMember.findById(memberObjId);

  if (!member || member.statut === 'retire') {
    throw new AppError('Membre introuvable ou inactif dans ce groupe.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.MEMBER_NOT_FOUND);
  }

  const group = await Group.findById(member.id_groupe);
  const user = await User.findById(member.id_utilisateur);

  // Sécurité : Récupérer impérativement le montant officiel fixé par le créateur de la tontine
  const activeCycle = (await Cycle.findOne({ id_groupe: member.id_groupe, statut: 'en_cours' })) || (await Cycle.findOne({ id_groupe: member.id_groupe }).sort({ numero_cycle: -1 }));
  const officialAmount = activeCycle ? activeCycle.montant_cotisation : input.montant;

  const transaction = await Transaction.create({
    id_membre_groupe: memberObjId,
    id_tour: input.id_tour ? new mongoose.Types.ObjectId(input.id_tour) : null,
    type: 'depot',
    montant: officialAmount,
    moyen_paiement: input.moyen_paiement,
    numero_tx_operateur: normalizedTx,
    preuve_capture_url: input.preuve_capture_url || null,
    statut: 'en_attente',
    synced_at: input.synced_at || new Date()
  });

  // Notifier l'administrateur principal du groupe (RF-06)
  if (group && user) {
    await Notification.create({
      id_utilisateur: group.id_admin_principal,
      id_groupe: member.id_groupe,
      type: 'validation',
      message: `${user.prenom} ${user.nom} a déclaré une cotisation de ${officialAmount.toLocaleString('fr-FR')} FCFA (${input.moyen_paiement}).`
    });
  }

  // Diffusion temps réel Socket.IO au groupe
  socketManager.broadcastPaymentDeclared(member.id_groupe.toString(), {
    ...transaction.toJSON(),
    nom: user?.nom,
    prenom: user?.prenom
  });

  return transaction;
};

/**
 * Valider une cotisation déclarée par un membre (RF-07)
 */
export const validateContribution = async (transactionId: string, adminUserId: string) => {
  const txObjId = new mongoose.Types.ObjectId(transactionId);
  const tx = await Transaction.findById(txObjId);

  if (!tx) {
    throw new AppError('Transaction introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.TRANSACTION_NOT_FOUND);
  }

  if (tx.statut !== 'en_attente') {
    throw new AppError('Cette transaction a déjà été traitée.', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.TRANSACTION_ALREADY_PROCESSED);
  }

  // 1. Mettre à jour la transaction
  tx.statut = 'confirme';
  tx.id_validateur = new mongoose.Types.ObjectId(adminUserId);
  await tx.save();

  // 2. Remettre le compteur de retards consécutifs à 0 (RF-15)
  const member = await GroupMember.findById(tx.id_membre_groupe);
  if (member) {
    member.retards_consecutifs = 0;
    await member.save();

    // 3. Notifier le membre par push Web (RF-07)
    await Notification.create({
      id_utilisateur: member.id_utilisateur,
      id_groupe: member.id_groupe,
      type: 'validation',
      message: `Votre cotisation de ${tx.montant.toLocaleString('fr-FR')} FCFA a été validée avec succès par l'administrateur.`
    });

    // 4. Diffusion temps réel Socket.IO
    socketManager.broadcastPaymentValidated(member.id_groupe.toString(), tx.toJSON());
    socketManager.broadcastNotification(member.id_utilisateur.toString(), {
      type: 'validation',
      message: `Votre cotisation de ${tx.montant.toLocaleString('fr-FR')} FCFA a été validée avec succès.`
    });
  }

  return tx;
};

/**
 * Rejeter une cotisation avec motif obligatoire (RF-07)
 */
export const rejectContribution = async (transactionId: string, adminUserId: string, motif: string) => {
  const txObjId = new mongoose.Types.ObjectId(transactionId);
  const tx = await Transaction.findById(txObjId);

  if (!tx) {
    throw new AppError('Transaction introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.TRANSACTION_NOT_FOUND);
  }

  if (tx.statut !== 'en_attente') {
    throw new AppError('Cette transaction a déjà été traitée.', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.TRANSACTION_ALREADY_PROCESSED);
  }

  tx.statut = 'rejete';
  tx.motif_rejet = motif.trim();
  tx.id_validateur = new mongoose.Types.ObjectId(adminUserId);
  await tx.save();

  // Incrémenter les retards consécutifs si rejet pour impayé (RF-15)
  const member = await GroupMember.findById(tx.id_membre_groupe);
  if (member) {
    const newRetards = member.retards_consecutifs + 1;
    member.retards_consecutifs = newRetards;
    if (newRetards >= 2) {
      member.statut = 'suspecte'; // Signalement automatique après 2 retards consécutifs (RF-15)
    }
    await member.save();

    // Notification au membre avec le motif de rejet (RF-07)
    await Notification.create({
      id_utilisateur: member.id_utilisateur,
      id_groupe: member.id_groupe,
      type: 'rejet',
      message: `Votre cotisation de ${tx.montant.toLocaleString('fr-FR')} FCFA a été rejetée. Motif : ${motif.trim()}`
    });

    // Diffusion temps réel Socket.IO
    socketManager.broadcastPaymentRejected(member.id_groupe.toString(), tx.toJSON());
    socketManager.broadcastNotification(member.id_utilisateur.toString(), {
      type: 'rejet',
      message: `Votre cotisation de ${tx.montant.toLocaleString('fr-FR')} FCFA a été rejetée. Motif : ${motif.trim()}`
    });
  }

  return tx;
};

/**
 * Récupérer les transactions d'un groupe avec filtres (RF-08)
 */
export const getGroupTransactions = async (groupId: string, statut?: string) => {
  const groupObjId = new mongoose.Types.ObjectId(groupId);

  const members = await GroupMember.find({ id_groupe: groupObjId }).select('_id');
  const memberIds = members.map((m) => m._id);

  const query: any = { id_membre_groupe: { $in: memberIds } };
  if (statut) {
    query.statut = statut;
  }

  const transactions = await Transaction.find(query).sort({ created_at: -1 }).lean();

  const results = [];
  for (const t of transactions) {
    const member = await GroupMember.findById(t.id_membre_groupe).lean();
    let userInfo = null;
    if (member) {
      const u = await User.findById(member.id_utilisateur, 'nom prenom photo_profil_url').lean();
      if (u) {
        userInfo = { ...u, id_utilisateur: u._id.toString() };
      }
    }

    let validatorInfo = null;
    if (t.id_validateur) {
      const v = await User.findById(t.id_validateur, 'nom prenom').lean();
      if (v) {
        validatorInfo = { ...v, id_utilisateur: v._id.toString() };
      }
    }

    results.push({
      ...t,
      id_transaction: t._id.toString(),
      membre_groupe: member
        ? {
            ...member,
            id: member._id.toString(),
            utilisateur: userInfo
          }
        : null,
      validateur: validatorInfo
    });
  }

  return results;
};
