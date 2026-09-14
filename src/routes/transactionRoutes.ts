import { Router } from 'express';
import {
  declarePaymentController,
  validatePaymentController,
  rejectPaymentController,
  confirmDistributionController,
  setTourOrderController,
  getGroupTransactionsController,
  checkTourEligibilityController,
  completeCycleController
} from '../controllers/transactionController';
import { authenticate } from '../middlewares/authMiddleware';
import { upload } from '../middlewares/uploadMiddleware';

const router = Router();

// Déclaration d'une cotisation Mobile Money avec capture facultative (RF-06)
router.post('/declare', authenticate, upload.single('preuve'), declarePaymentController);

// Validation d'une cotisation par l'administrateur (RF-07)
router.post('/validate', authenticate, validatePaymentController);

// Rejet d'une cotisation avec motif (RF-07)
router.post('/reject', authenticate, rejectPaymentController);

// Confirmation de la distribution de cagnotte (RF-11)
router.post('/distribution', authenticate, upload.single('preuve'), confirmDistributionController);

// Définition de l'ordre de passage des membres pour un cycle (RF-09)
router.post('/tour-order', authenticate, setTourOrderController);

// Historique des transactions d'un groupe avec filtres (RF-08)
router.get('/group/:groupId', authenticate, getGroupTransactionsController);

// Vérification de l'éligibilité d'un tour (RF-13)
router.get('/tour/:tourId/eligibility', authenticate, checkTourEligibilityController);

// Clôture et réorganisation automatique du cycle (RF-14)
router.post('/cycle/:cycleId/complete', authenticate, completeCycleController);

export default router;
