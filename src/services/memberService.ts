import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/errorHandler';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';

/**
 * Récupérer la liste des membres d'un groupe avec leurs statuts (RF-20)
 */
export const getGroupMembers = async (groupId: string) => {
  const members = await prisma.membreGroupe.findMany({
    where: {
      id_groupe: groupId,
      statut: { in: ['actif', 'suspecte'] }
    },
    include: {
      utilisateur: {
        select: {
          id_utilisateur: true,
          nom: true,
          prenom: true,
          contact_paiement: true,
          photo_profil_url: true,
          ville: true
        }
      },
      transactions: {
        where: { type: 'depot' },
        orderBy: { created_at: 'desc' },
        take: 1
      }
    },
    orderBy: { date_adhesion: 'asc' }
  });

  return members.map((m) => ({
    id_membre: m.id,
    id_utilisateur: m.utilisateur.id_utilisateur,
    nom: m.utilisateur.nom,
    prenom: m.utilisateur.prenom,
    contact_paiement: m.utilisateur.contact_paiement,
    photo_profil_url: m.utilisateur.photo_profil_url,
    ville: m.utilisateur.ville,
    role: m.role,
    statut: m.statut,
    credit_reporte: m.credit_reporte,
    retards_consecutifs: m.retards_consecutifs,
    date_adhesion: m.date_adhesion,
    derniere_cotisation_statut: m.transactions[0]?.statut || 'aucune'
  }));
};

/**
 * Désigner l'administrateur secondaire parmi les membres du groupe (RF-04, 3.1)
 */
export const setSecondaryAdmin = async (groupId: string, requestingUserId: string, targetUserId: string) => {
  const group = await prisma.groupe.findUnique({
    where: { id_groupe: groupId }
  });

  if (!group) {
    throw new AppError('Groupe introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.GROUP_NOT_FOUND);
  }

  // Seul l'administrateur principal peut nommer l'administrateur secondaire
  if (group.id_admin_principal !== requestingUserId) {
    throw new AppError('Seul l\'administrateur principal peut désigner le second administrateur.', HTTP_STATUS.FORBIDDEN, ERROR_CODES.UNAUTHORIZED_ACTION);
  }

  const targetMember = await prisma.membreGroupe.findUnique({
    where: {
      id_utilisateur_id_groupe: {
        id_utilisateur: targetUserId,
        id_groupe: groupId
      }
    }
  });

  if (!targetMember || targetMember.statut === 'retire') {
    throw new AppError('Le membre cible est introuvable ou inactif dans ce groupe.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.MEMBER_NOT_FOUND);
  }

  // Rétrograder l'ancien admin secondaire s'il existait
  if (group.id_admin_secondaire && group.id_admin_secondaire !== targetUserId) {
    await prisma.membreGroupe.updateMany({
      where: {
        id_groupe: groupId,
        id_utilisateur: group.id_admin_secondaire
      },
      data: { role: 'membre' }
    });
  }

  // Mettre à jour le groupe et le membre
  await prisma.$transaction([
    prisma.groupe.update({
      where: { id_groupe: groupId },
      data: { id_admin_secondaire: targetUserId }
    }),
    prisma.membreGroupe.update({
      where: { id: targetMember.id },
      data: { role: 'admin_secondaire' }
    }),
    prisma.notification.create({
      data: {
        id_utilisateur: targetUserId,
        id_groupe: groupId,
        type: 'signalement',
        message: 'Vous avez été désigné comme administrateur secondaire du groupe.'
      }
    })
  ]);

  return { message: 'Administrateur secondaire désigné avec succès.' };
};

/**
 * Retirer un membre du groupe (RF-21)
 */
export const removeMemberFromGroup = async (groupId: string, memberId: string) => {
  const member = await prisma.membreGroupe.findUnique({
    where: { id: memberId },
    include: { groupe: true }
  });

  if (!member || member.id_groupe !== groupId || member.statut === 'retire') {
    throw new AppError('Membre introuvable dans ce groupe.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.MEMBER_NOT_FOUND);
  }

  // Règle de sécurité RF-21 : Impossible de retirer l'administrateur principal ou de laisser moins de 2 admins si configurés
  if (member.role === 'admin_principal') {
    throw new AppError('L\'administrateur principal ne peut pas être retiré du groupe.', HTTP_STATUS.FORBIDDEN, ERROR_CODES.CANNOT_REMOVE_ADMIN);
  }

  await prisma.$transaction([
    prisma.membreGroupe.update({
      where: { id: memberId },
      data: { statut: 'retire' }
    }),
    prisma.notification.create({
      data: {
        id_utilisateur: member.id_utilisateur,
        id_groupe: groupId,
        type: 'signalement',
        message: 'Vous avez été retiré du groupe de tontine.'
      }
    })
  ]);

  return { message: 'Le membre a été retiré du groupe avec succès.' };
};

/**
 * Décision de l'administrateur sur un membre suspecté (RF-16)
 */
export const handleSuspectedMember = async (groupId: string, memberId: string, decision: 'maintenir' | 'retirer') => {
  const member = await prisma.membreGroupe.findUnique({
    where: { id: memberId }
  });

  if (!member || member.id_groupe !== groupId) {
    throw new AppError('Membre introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.MEMBER_NOT_FOUND);
  }

  if (decision === 'retirer') {
    await prisma.membreGroupe.update({
      where: { id: memberId },
      data: { statut: 'retire' }
    });
    return { message: 'Le membre suspecté a été exclu du groupe.' };
  } else {
    // Maintien sous statut surveillé
    await prisma.membreGroupe.update({
      where: { id: memberId },
      data: { statut: 'suspecte' }
    });
    return { message: 'Le membre a été maintenu sous surveillance.' };
  }
};
