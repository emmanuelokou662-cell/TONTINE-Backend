import { Group, GroupMember, Cycle, User, Notification, Tour } from '../models';
import { hashSecret, compareSecret } from '../utils/security';
import { AppError } from '../middlewares/errorHandler';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';
import { socketManager } from './socketManager';
import mongoose from 'mongoose';

export const MAX_GROUP_MEMBERS = 10; // Règle RF-05 : 10 membres maximum par groupe

export interface CreateGroupInput {
  nom_groupe: string;
  mot_de_passe_groupe: string;
  periodicite: '1jour' | '2jours' | '3jours' | '4jours' | '5jours' | '1semaine' | '2semaines' | '1mois' | '2mois' | '1an';
  montant_cotisation: number;
}

export interface UpdateGroupSettingsInput {
  periodicite?: '1jour' | '2jours' | '3jours' | '4jours' | '5jours' | '1semaine' | '2semaines' | '1mois' | '2mois' | '1an';
  montant_cotisation?: number;
}

/**
 * Mettre à jour les paramètres du groupe et du cycle (RF-25)
 */
export const updateGroupSettings = async (groupId: string, input: UpdateGroupSettingsInput) => {
  const group = await Group.findById(groupId);
  if (!group) {
    throw new AppError('Groupe introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.GROUP_NOT_FOUND);
  }

  if (input.periodicite) {
    group.periodicite = input.periodicite;
  }
  await group.save();

  if (input.montant_cotisation) {
    const activeCycle = await Cycle.findOne({ id_groupe: group._id, statut: 'en_cours' }).sort({ numero_cycle: -1 });
    if (activeCycle) {
      activeCycle.montant_cotisation = input.montant_cotisation;
      await activeCycle.save();
    }
  }

  socketManager.broadcastGroupUpdated(groupId, group.toJSON());

  return {
    id_groupe: group._id.toString(),
    periodicite: group.periodicite,
    nom_groupe: group.nom_groupe
  };
};

/**
 * Création d'un nouveau groupe de tontine (RF-04)
 */
export const createGroup = async (userId: string, input: CreateGroupInput) => {
  const hashedPassword = await hashSecret(input.mot_de_passe_groupe);

  const group = await Group.create({
    nom_groupe: input.nom_groupe.trim(),
    mot_de_passe_groupe: hashedPassword,
    id_admin_principal: new mongoose.Types.ObjectId(userId),
    periodicite: input.periodicite,
    statut: 'actif'
  });

  const member = await GroupMember.create({
    id_utilisateur: new mongoose.Types.ObjectId(userId),
    id_groupe: group._id,
    role: 'admin_principal',
    statut: 'actif'
  });

  const cycle = await Cycle.create({
    id_groupe: group._id,
    numero_cycle: 1,
    montant_cotisation: input.montant_cotisation,
    statut: 'en_cours'
  });

  return {
    group: {
      id_groupe: group._id.toString(),
      nom_groupe: group.nom_groupe,
      periodicite: group.periodicite,
      statut: group.statut,
      created_at: group.created_at
    },
    membership: member,
    active_cycle: cycle
  };
};

/**
 * Rejoindre un groupe existant via le mot de passe de groupe à 8 caractères (RF-05, RF-26)
 */
export const joinGroupByPassword = async (userId: string, passwordInput: string) => {
  const activeGroups = await Group.find({ statut: 'actif' });

  let matchingGroup: (typeof activeGroups)[0] | null = null;

  for (const group of activeGroups) {
    const isMatch = await compareSecret(passwordInput, group.mot_de_passe_groupe);
    if (isMatch) {
      matchingGroup = group;
      break;
    }
  }

  if (!matchingGroup) {
    throw new AppError(
      'Mot de passe de groupe incorrect ou groupe introuvable.',
      HTTP_STATUS.NOT_FOUND,
      ERROR_CODES.INVALID_GROUP_PASSWORD
    );
  }

  const userObjId = new mongoose.Types.ObjectId(userId);

  // Vérifier si l'utilisateur est déjà membre du groupe
  const existingMember = await GroupMember.findOne({
    id_utilisateur: userObjId,
    id_groupe: matchingGroup._id
  });

  if (existingMember && existingMember.statut !== 'retire') {
    throw new AppError('Vous êtes déjà membre de ce groupe de tontine.', HTTP_STATUS.CONFLICT, ERROR_CODES.ALREADY_MEMBER);
  }

  // Vérifier la limite stricte de 10 membres (RF-05)
  const activeMemberCount = await GroupMember.countDocuments({
    id_groupe: matchingGroup._id,
    statut: { $ne: 'retire' }
  });

  if (activeMemberCount >= MAX_GROUP_MEMBERS) {
    throw new AppError(
      `Ce groupe a atteint la limite maximale de ${MAX_GROUP_MEMBERS} membres.`,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.GROUP_FULL
    );
  }

  let newMember;
  if (existingMember) {
    existingMember.statut = 'actif';
    existingMember.role = 'membre';
    newMember = await existingMember.save();
  } else {
    newMember = await GroupMember.create({
      id_utilisateur: userObjId,
      id_groupe: matchingGroup._id,
      role: 'membre',
      statut: 'actif'
    });
  }

  // Notifier l'administrateur principal (RF-05)
  await Notification.create({
    id_utilisateur: matchingGroup.id_admin_principal,
    id_groupe: matchingGroup._id,
    type: 'signalement',
    message: 'Un nouveau membre a rejoint votre groupe de tontine.'
  });

  // Diffusion temps réel Socket.IO
  socketManager.broadcastMemberJoined(matchingGroup._id.toString(), newMember.toJSON());

  return {
    id_groupe: matchingGroup._id.toString(),
    nom_groupe: matchingGroup.nom_groupe,
    membership: newMember
  };
};

/**
 * Récupérer la liste des groupes de l'utilisateur connecté
 */
export const getUserGroups = async (userId: string) => {
  const userObjId = new mongoose.Types.ObjectId(userId);

  const memberships = await GroupMember.find({
    id_utilisateur: userObjId,
    statut: { $in: ['actif', 'suspecte'] }
  }).lean();

  const results = [];

  for (const m of memberships) {
    const group = await Group.findById(m.id_groupe).lean();
    if (!group) continue;

    const admin1 = await User.findById(group.id_admin_principal, 'nom prenom photo_profil_url').lean();
    const admin2 = group.id_admin_secondaire
      ? await User.findById(group.id_admin_secondaire, 'nom prenom photo_profil_url').lean()
      : null;

    const activeCycle = await Cycle.findOne({ id_groupe: group._id, statut: 'en_cours' })
      .sort({ numero_cycle: -1 })
      .lean();

    const memberCount = await GroupMember.countDocuments({
      id_groupe: group._id,
      statut: { $in: ['actif', 'suspecte'] }
    });

    results.push({
      id_groupe: group._id.toString(),
      nom_groupe: group.nom_groupe,
      periodicite: group.periodicite,
      role: m.role,
      statut_membre: m.statut,
      credit_reporte: m.credit_reporte,
      retards_consecutifs: m.retards_consecutifs,
      nombre_membres: memberCount,
      admin_principal: admin1 ? { ...admin1, id_utilisateur: admin1._id.toString() } : null,
      admin_secondaire: admin2 ? { ...admin2, id_utilisateur: admin2._id.toString() } : null,
      cycle_en_cours: activeCycle ? { ...activeCycle, id_cycle: activeCycle._id.toString() } : null
    });
  }

  return results;
};

/**
 * Récupérer les détails complets d'un groupe
 */
export const getGroupDetails = async (groupId: string, _userId: string) => {
  const groupObjId = new mongoose.Types.ObjectId(groupId);

  const group = await Group.findById(groupObjId).lean();
  if (!group) {
    throw new AppError('Groupe de tontine introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.GROUP_NOT_FOUND);
  }

  const admin1 = await User.findById(group.id_admin_principal, 'nom prenom contact_paiement photo_profil_url').lean();
  const admin2 = group.id_admin_secondaire
    ? await User.findById(group.id_admin_secondaire, 'nom prenom contact_paiement photo_profil_url').lean()
    : null;

  const cycles = await Cycle.find({ id_groupe: groupObjId, statut: 'en_cours' }).lean();

  const formattedCycles = [];
  for (const cycle of cycles) {
    const tours = await Tour.find({ id_cycle: cycle._id }).sort({ ordre_passage: 1 }).lean();
    const formattedTours = [];

    for (const tour of tours) {
      const gm = await GroupMember.findById(tour.id_membre_groupe).lean();
      let userInfo = null;
      if (gm) {
        const u = await User.findById(gm.id_utilisateur, 'nom prenom photo_profil_url contact_paiement').lean();
        if (u) {
          userInfo = { ...u, id_utilisateur: u._id.toString() };
        }
      }

      formattedTours.push({
        ...tour,
        id_tour: tour._id.toString(),
        membre_groupe: gm ? { ...gm, id: gm._id.toString(), utilisateur: userInfo } : null
      });
    }

    formattedCycles.push({
      ...cycle,
      id_cycle: cycle._id.toString(),
      tours: formattedTours
    });
  }

  const rawMembers = await GroupMember.find({
    id_groupe: groupObjId,
    statut: { $in: ['actif', 'suspecte'] }
  }).lean();

  const formattedMembers = [];
  for (const m of rawMembers) {
    const u = await User.findById(m.id_utilisateur, 'nom prenom contact_paiement photo_profil_url ville').lean();
    formattedMembers.push({
      ...m,
      id: m._id.toString(),
      utilisateur: u ? { ...u, id_utilisateur: u._id.toString() } : null
    });
  }

  return {
    ...group,
    id_groupe: group._id.toString(),
    admin_principal: admin1 ? { ...admin1, id_utilisateur: admin1._id.toString() } : null,
    admin_secondaire: admin2 ? { ...admin2, id_utilisateur: admin2._id.toString() } : null,
    cycles: formattedCycles,
    membres: formattedMembers
  };
};
