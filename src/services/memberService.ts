import { GroupMember, Group, User, Notification, Transaction } from '../models';
import { AppError } from '../middlewares/errorHandler';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';
import { socketManager } from './socketManager';
import mongoose from 'mongoose';

/**
 * Récupérer la liste des membres d'un groupe avec leurs statuts (RF-20)
 */
export const getGroupMembers = async (groupId: string) => {
  const groupObjId = new mongoose.Types.ObjectId(groupId);

  const members = await GroupMember.find({
    id_groupe: groupObjId,
    statut: { $in: ['actif', 'suspecte'] }
  }).sort({ date_adhesion: 1 }).lean();

  const results = [];

  for (const m of members) {
    const user = await User.findById(m.id_utilisateur, 'nom prenom contact_paiement photo_profil_url ville').lean();
    const lastTx = await Transaction.findOne({ id_membre_groupe: m._id, type: 'depot' })
      .sort({ created_at: -1 })
      .lean();

    results.push({
      id_membre: m._id.toString(),
      id_utilisateur: user ? user._id.toString() : m.id_utilisateur.toString(),
      nom: user?.nom || '',
      prenom: user?.prenom || '',
      contact_paiement: user?.contact_paiement || '',
      photo_profil_url: user?.photo_profil_url || '',
      ville: user?.ville || '',
      role: m.role,
      statut: m.statut,
      credit_reporte: m.credit_reporte,
      retards_consecutifs: m.retards_consecutifs,
      date_adhesion: m.date_adhesion,
      derniere_cotisation_statut: lastTx?.statut || 'aucune'
    });
  }

  return results;
};

/**
 * Désigner l'administrateur secondaire parmi les membres du groupe (RF-04, 3.1)
 */
export const setSecondaryAdmin = async (groupId: string, requestingUserId: string, targetUserId: string) => {
  const groupObjId = new mongoose.Types.ObjectId(groupId);
  const group = await Group.findById(groupObjId);

  if (!group) {
    throw new AppError('Groupe introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.GROUP_NOT_FOUND);
  }

  // Seul l'administrateur principal peut nommer l'administrateur secondaire
  if (group.id_admin_principal.toString() !== requestingUserId) {
    throw new AppError('Seul l\'administrateur principal peut désigner le second administrateur.', HTTP_STATUS.FORBIDDEN, ERROR_CODES.UNAUTHORIZED_ACTION);
  }

  const targetUserObjId = new mongoose.Types.ObjectId(targetUserId);

  const targetMember = await GroupMember.findOne({
    id_utilisateur: targetUserObjId,
    id_groupe: groupObjId
  });

  if (!targetMember || targetMember.statut === 'retire') {
    throw new AppError('Le membre cible est introuvable ou inactif dans ce groupe.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.MEMBER_NOT_FOUND);
  }

  // Rétrograder l'ancien admin secondaire s'il existait
  if (group.id_admin_secondaire && group.id_admin_secondaire.toString() !== targetUserId) {
    await GroupMember.updateMany(
      { id_groupe: groupObjId, id_utilisateur: group.id_admin_secondaire },
      { $set: { role: 'membre' } }
    );
  }

  // Mettre à jour le groupe et le membre
  group.id_admin_secondaire = targetUserObjId;
  await group.save();

  targetMember.role = 'admin_secondaire';
  await targetMember.save();

  await Notification.create({
    id_utilisateur: targetUserObjId,
    id_groupe: groupObjId,
    type: 'signalement',
    message: 'Vous avez été désigné comme administrateur secondaire du groupe.'
  });

  // Diffusion temps réel Socket.IO
  socketManager.broadcastMemberUpdated(groupId, targetMember.toJSON());

  return { message: 'Administrateur secondaire désigné avec succès.' };
};

/**
 * Retirer un membre du groupe (RF-21)
 */
export const removeMemberFromGroup = async (groupId: string, memberId: string) => {
  const memberObjId = new mongoose.Types.ObjectId(memberId);
  const member = await GroupMember.findById(memberObjId);

  if (!member || member.id_groupe.toString() !== groupId || member.statut === 'retire') {
    throw new AppError('Membre introuvable dans ce groupe.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.MEMBER_NOT_FOUND);
  }

  // Règle de sécurité RF-21 : Impossible de retirer l'administrateur principal
  if (member.role === 'admin_principal') {
    throw new AppError('L\'administrateur principal ne peut pas être retiré du groupe.', HTTP_STATUS.FORBIDDEN, ERROR_CODES.CANNOT_REMOVE_ADMIN);
  }

  member.statut = 'retire';
  await member.save();

  await Notification.create({
    id_utilisateur: member.id_utilisateur,
    id_groupe: new mongoose.Types.ObjectId(groupId),
    type: 'signalement',
    message: 'Vous avez été retiré du groupe de tontine.'
  });

  // Diffusion temps réel Socket.IO
  socketManager.broadcastMemberRemoved(groupId, memberId);

  return { message: 'Le membre a été retiré du groupe avec succès.' };
};

/**
 * Décision de l'administrateur sur un membre suspecté (RF-16)
 */
export const handleSuspectedMember = async (groupId: string, memberId: string, decision: 'maintenir' | 'retirer') => {
  const memberObjId = new mongoose.Types.ObjectId(memberId);
  const member = await GroupMember.findById(memberObjId);

  if (!member || member.id_groupe.toString() !== groupId) {
    throw new AppError('Membre introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.MEMBER_NOT_FOUND);
  }

  if (decision === 'retirer') {
    member.statut = 'retire';
    await member.save();
    return { message: 'Le membre suspecté a été exclu du groupe.' };
  } else {
    // Maintien sous statut surveillé
    member.statut = 'suspecte';
    await member.save();
    return { message: 'Le membre a été maintenu sous surveillance.' };
  }
};
