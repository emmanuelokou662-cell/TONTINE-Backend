import { Request, Response, NextFunction } from 'express';
import {
  declarePaymentSchema,
  validatePaymentSchema,
  rejectPaymentSchema,
  confirmDistributionSchema,
  setTourOrderSchema
} from '../validations/transactionValidation';
import {
  declareContribution,
  validateContribution,
  rejectContribution,
  getGroupTransactions
} from '../services/transactionService';
import {
  setTourOrderForCycle,
  confirmTourDistribution,
  evaluateTourEligibility,
  checkAndCompleteCycle
} from '../services/cycleService';
import { HTTP_STATUS } from '../constants/httpCodes';
import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/errorHandler';
import { ERROR_CODES } from '../constants/httpCodes';

/**
 * Déclarer une cotisation (RF-06)
 */
export const declarePaymentController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id_utilisateur;
    const validatedData = declarePaymentSchema.parse(req.body);

    // Trouver l'adhésion membre pour ce groupe
    const member = await prisma.membreGroupe.findUnique({
      where: {
        id_utilisateur_id_groupe: {
          id_utilisateur: userId,
          id_groupe: validatedData.id_groupe
        }
      }
    });

    if (!member || member.statut === 'retire') {
      throw new AppError('Vous n\'êtes pas membre actif de ce groupe.', HTTP_STATUS.FORBIDDEN, ERROR_CODES.UNAUTHORIZED_ACTION);
    }

    const proofUrl = req.file ? `/uploads/${req.file.filename}` : undefined;

    const transaction = await declareContribution({
      id_membre_groupe: member.id,
      id_tour: validatedData.id_tour,
      montant: validatedData.montant,
      moyen_paiement: validatedData.moyen_paiement,
      numero_tx_operateur: validatedData.numero_tx_operateur,
      preuve_capture_url: proofUrl
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Cotisation déclarée avec succès. En attente de validation par l\'administrateur.',
      data: transaction
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Valider une cotisation (RF-07)
 */
export const validatePaymentController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const adminUserId = req.user!.id_utilisateur;
    const { id_transaction } = validatePaymentSchema.parse(req.body);
    const result = await validateContribution(id_transaction, adminUserId);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Cotisation validée avec succès.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Rejeter une cotisation (RF-07)
 */
export const rejectPaymentController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const adminUserId = req.user!.id_utilisateur;
    const { id_transaction, motif_rejet } = rejectPaymentSchema.parse(req.body);
    const result = await rejectContribution(id_transaction, adminUserId, motif_rejet);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Cotisation rejetée.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Confirmer la distribution de la cagnotte (RF-11)
 */
export const confirmDistributionController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const adminUserId = req.user!.id_utilisateur;
    const { id_tour, montant } = confirmDistributionSchema.parse(req.body);
    const proofUrl = req.file ? `/uploads/${req.file.filename}` : undefined;

    const result = await confirmTourDistribution(id_tour, adminUserId, montant, proofUrl);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Distribution de la cagnotte confirmée avec succès.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Définir l'ordre des tours de passage (RF-09)
 */
export const setTourOrderController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id_cycle, ordres } = setTourOrderSchema.parse(req.body);
    const tours = await setTourOrderForCycle(id_cycle, ordres);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Ordre de passage des tours défini avec succès.',
      data: tours
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtenir l'historique des transactions d'un groupe (RF-08)
 */
export const getGroupTransactionsController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const groupId = req.params.groupId as string;
    const statut = req.query.statut as string | undefined;
    const transactions = await getGroupTransactions(groupId, statut);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: transactions
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Vérifier l'éligibilité d'un tour (RF-13)
 */
export const checkTourEligibilityController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tourId = req.params.tourId as string;
    const result = await evaluateTourEligibility(tourId);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Clôturer et réorganiser un cycle terminé (RF-14)
 */
export const completeCycleController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cycleId = req.params.cycleId as string;
    const newAmount = req.body.nouveau_montant ? Number(req.body.nouveau_montant) : undefined;
    const result = await checkAndCompleteCycle(cycleId, newAmount);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};
