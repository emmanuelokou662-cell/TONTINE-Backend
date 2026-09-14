import { Router } from 'express';
import {
  createGroupController,
  joinGroupController,
  getMyGroupsController,
  getGroupDetailsController,
  getGroupMembersController,
  setSecondaryAdminController,
  removeMemberController,
  decideSuspectedMemberController
} from '../controllers/groupController';
import { authenticate, requireGroupAdmin } from '../middlewares/authMiddleware';

const router = Router();

// Création d'un groupe (RF-04)
router.post('/', authenticate, createGroupController);

// Adhésion à un groupe via mot de passe (RF-05, RF-26)
router.post('/join', authenticate, joinGroupController);

// Liste des groupes de l'utilisateur connecté
router.get('/my', authenticate, getMyGroupsController);

// Détails d'un groupe spécifique
router.get('/:groupId', authenticate, getGroupDetailsController);

// Liste des membres d'un groupe avec leurs statuts (RF-20)
router.get('/:groupId/members', authenticate, getGroupMembersController);

// Désigner l'administrateur secondaire (RF-04) - Réservé aux administrateurs
router.post('/:groupId/admin-secondary', authenticate, requireGroupAdmin, setSecondaryAdminController);

// Retirer un membre du groupe (RF-21) - Réservé aux administrateurs
router.delete('/:groupId/members/:memberId', authenticate, requireGroupAdmin, removeMemberController);

// Décision sur un membre suspecté (RF-16) - Réservé aux administrateurs
router.post('/:groupId/suspected-member', authenticate, requireGroupAdmin, decideSuspectedMemberController);

export default router;
