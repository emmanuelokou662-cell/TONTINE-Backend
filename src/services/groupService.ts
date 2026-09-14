import { prisma } from '../config/prisma';
import { hashSecret, compareSecret } from '../utils/security';
import { AppError } from '../middlewares/errorHandler';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';

export const MAX_GROUP_MEMBERS = 10; // Règle RF-05 : 10 membres maximum par groupe

export interface CreateGroupInput {
  nom_groupe: string;
  mot_de_passe_groupe: string;
  periodicite: '1semaine' | '2semaines' | '1mois' | '2mois';
  montant_cotisation: number;
}

/**
 * Création d'un nouveau groupe de tontine (RF-04)
 */
export const createGroup = async (userId: string, input: CreateGroupInput) => {
  const hashedPassword = await hashSecret(input.mot_de_passe_groupe);

  // Transaction Prisma pour garantir l'atomicité de la création
  return prisma.$transaction(async (tx) => {
    // 1. Créer le groupe
    const group = await tx.groupe.create({
      data: {
        nom_groupe: input.nom_groupe.trim(),
        mot_de_passe_groupe: hashedPassword,
        id_admin_principal: userId,
        periodicite: input.periodicite,
        statut: 'actif'
      }
    });

    // 2. Ajouter le créateur en tant que Membre Administrateur Principal
    const member = await tx.membreGroupe.create({
      data: {
        id_utilisateur: userId,
        id_groupe: group.id_groupe,
        role: 'admin_principal',
        statut: 'actif'
      }
    });

    // 3. Initialiser le premier cycle (Cycle 1) avec le montant fixé (RF-25)
    const cycle = await tx.cycle.create({
      data: {
        id_groupe: group.id_groupe,
        numero_cycle: 1,
        montant_cotisation: input.montant_cotisation,
        statut: 'en_cours'
      }
    });

    return {
      group: {
        id_groupe: group.id_groupe,
        nom_groupe: group.nom_groupe,
        periodicite: group.periodicite,
        statut: group.statut,
        created_at: group.created_at
      },
      membership: member,
      active_cycle: cycle
    };
  });
};

/**
 * Rejoindre un groupe existant via le mot de passe de groupe à 8 caractères (RF-05, RF-26)
 */
export const joinGroupByPassword = async (userId: string, passwordInput: string) => {
  // Récupérer tous les groupes actifs pour comparer le mot de passe haché
  const activeGroups = await prisma.groupe.findMany({
    where: { statut: 'actif' },
    include: {
      membres: true,
      admin_principal: true
    }
  });

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

  // Vérifier si l'utilisateur est déjà membre du groupe
  const alreadyMember = matchingGroup.membres.find(
    (m) => m.id_utilisateur === userId && m.statut !== 'retire'
  );
  if (alreadyMember) {
    throw new AppError('Vous êtes déjà membre de ce groupe de tontine.', HTTP_STATUS.CONFLICT, ERROR_CODES.ALREADY_MEMBER);
  }

  // Vérifier la limite stricte de 10 membres (RF-05)
  const activeMemberCount = matchingGroup.membres.filter((m) => m.statut !== 'retire').length;
  if (activeMemberCount >= MAX_GROUP_MEMBERS) {
    throw new AppError(
      `Ce groupe a atteint la limite maximale de ${MAX_GROUP_MEMBERS} membres.`,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.GROUP_FULL
    );
  }

  // Ajouter l'utilisateur comme nouveau membre
  const newMember = await prisma.membreGroupe.create({
    data: {
      id_utilisateur: userId,
      id_groupe: matchingGroup.id_groupe,
      role: 'membre',
      statut: 'actif'
    }
  });

  // Notifier l'administrateur principal (RF-05)
  await prisma.notification.create({
    data: {
      id_utilisateur: matchingGroup.id_admin_principal,
      id_groupe: matchingGroup.id_groupe,
      type: 'signalement',
      message: 'Un nouveau membre a rejoint votre groupe de tontine.'
    }
  });

  return {
    id_groupe: matchingGroup.id_groupe,
    nom_groupe: matchingGroup.nom_groupe,
    membership: newMember
  };
};

/**
 * Récupérer la liste des groupes de l'utilisateur connecté
 */
export const getUserGroups = async (userId: string) => {
  const memberships = await prisma.membreGroupe.findMany({
    where: {
      id_utilisateur: userId,
      statut: { in: ['actif', 'suspecte'] }
    },
    include: {
      groupe: {
        include: {
          admin_principal: {
            select: { id_utilisateur: true, nom: true, prenom: true, photo_profil_url: true }
          },
          admin_secondaire: {
            select: { id_utilisateur: true, nom: true, prenom: true, photo_profil_url: true }
          },
          cycles: {
            where: { statut: 'en_cours' },
            orderBy: { numero_cycle: 'desc' },
            take: 1
          },
          membres: {
            where: { statut: { in: ['actif', 'suspecte'] } },
            select: { id: true }
          }
        }
      }
    }
  });

  return memberships.map((m) => ({
    id_groupe: m.groupe.id_groupe,
    nom_groupe: m.groupe.nom_groupe,
    periodicite: m.groupe.periodicite,
    role: m.role,
    statut_membre: m.statut,
    credit_reporte: m.credit_reporte,
    retards_consecutifs: m.retards_consecutifs,
    nombre_membres: m.groupe.membres.length,
    admin_principal: m.groupe.admin_principal,
    admin_secondaire: m.groupe.admin_secondaire,
    cycle_en_cours: m.groupe.cycles[0] || null
  }));
};

/**
 * Récupérer les détails complets d'un groupe
 */
export const getGroupDetails = async (groupId: string, _userId: string) => {
  const group = await prisma.groupe.findUnique({
    where: { id_groupe: groupId },
    include: {
      admin_principal: {
        select: { id_utilisateur: true, nom: true, prenom: true, contact_paiement: true, photo_profil_url: true }
      },
      admin_secondaire: {
        select: { id_utilisateur: true, nom: true, prenom: true, contact_paiement: true, photo_profil_url: true }
      },
      cycles: {
        where: { statut: 'en_cours' },
        include: {
          tours: {
            orderBy: { ordre_passage: 'asc' },
            include: {
              membre_groupe: {
                include: {
                  utilisateur: {
                    select: { id_utilisateur: true, nom: true, prenom: true, photo_profil_url: true, contact_paiement: true }
                  }
                }
              }
            }
          }
        }
      },
      membres: {
        where: { statut: { in: ['actif', 'suspecte'] } },
        include: {
          utilisateur: {
            select: { id_utilisateur: true, nom: true, prenom: true, contact_paiement: true, photo_profil_url: true, ville: true }
          }
        }
      }
    }
  });

  if (!group) {
    throw new AppError('Groupe de tontine introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.GROUP_NOT_FOUND);
  }

  return group;
};
