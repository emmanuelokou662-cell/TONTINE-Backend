import { Request, Response, NextFunction } from 'express';
import {
  createGroupSchema,
  joinGroupSchema,
  setSecondaryAdminSchema,
  decideSuspectedMemberSchema,
  updateGroupSettingsSchema
} from '../validations/groupValidation';
import {
  createGroup,
  joinGroupByPassword,
  getUserGroups,
  getGroupDetails,
  updateGroupSettings
} from '../services/groupService';
import {
  getGroupMembers,
  setSecondaryAdmin,
  removeMemberFromGroup,
  handleSuspectedMember
} from '../services/memberService';
import { HTTP_STATUS } from '../constants/httpCodes';

/**
 * Mettre à jour les paramètres du groupe (périodicité, délai de retrait, montant) (RF-25)
 */
export const updateGroupSettingsController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const groupId = req.params.groupId as string;
    const validatedData = updateGroupSettingsSchema.parse(req.body);
    const result = await updateGroupSettings(groupId, validatedData);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Paramètres du groupe mis à jour avec succès.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Créer un nouveau groupe de tontine (RF-04)
 */
export const createGroupController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id_utilisateur;
    const validatedData = createGroupSchema.parse(req.body);
    const result = await createGroup(userId, validatedData);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Groupe de tontine créé avec succès.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Rejoindre un groupe via son mot de passe de 8 caractères (RF-05, RF-26)
 */
export const joinGroupController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id_utilisateur;
    const { mot_de_passe_groupe } = joinGroupSchema.parse(req.body);
    const result = await joinGroupByPassword(userId, mot_de_passe_groupe);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Vous avez rejoint le groupe de tontine avec succès.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtenir tous les groupes de l'utilisateur connecté
 */
export const getMyGroupsController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id_utilisateur;
    const groups = await getUserGroups(userId);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: groups
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtenir les détails d'un groupe spécifique
 */
export const getGroupDetailsController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id_utilisateur;
    const groupId = req.params.groupId as string;
    const details = await getGroupDetails(groupId, userId);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: details
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtenir la liste des membres d'un groupe (RF-20)
 */
export const getGroupMembersController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const groupId = req.params.groupId as string;
    const members = await getGroupMembers(groupId);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: members
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Désigner l'administrateur secondaire (RF-04)
 */
export const setSecondaryAdminController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const requestingUserId = req.user!.id_utilisateur;
    const groupId = req.params.groupId as string;
    const { id_membre_utilisateur } = setSecondaryAdminSchema.parse(req.body);

    const result = await setSecondaryAdmin(groupId, requestingUserId, id_membre_utilisateur);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retirer un membre du groupe (RF-21)
 */
export const removeMemberController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const groupId = req.params.groupId as string;
    const memberId = req.params.memberId as string;
    const result = await removeMemberFromGroup(groupId, memberId);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Arbitrage d'un membre suspecté (RF-16)
 */
export const decideSuspectedMemberController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const groupId = req.params.groupId as string;
    const { id_membre_groupe, decision } = decideSuspectedMemberSchema.parse(req.body);
    const result = await handleSuspectedMember(groupId, id_membre_groupe, decision);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};
