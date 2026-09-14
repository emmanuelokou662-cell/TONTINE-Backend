import { Request, Response, NextFunction } from 'express';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';
import { JwtUserPayload, verifyAccessToken } from '../utils/security';
import { GroupMember } from '../models';
import mongoose from 'mongoose';

// Extension du type Request d'Express pour inclure l'utilisateur authentifié
declare global {
  namespace Express {
    interface Request {
      user?: JwtUserPayload;
    }
  }
}

/**
 * Middleware d'authentification obligatoire par JWT Bearer Token
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: {
        code: ERROR_CODES.UNAUTHORIZED_ACTION,
        message: 'Jeton d\'authentification manquant ou format invalide.'
      }
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (error: any) {
    const isExpired = error?.name === 'TokenExpiredError';
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: {
        code: isExpired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.TOKEN_INVALID,
        message: isExpired ? 'Votre session a expiré. Veuillez vous reconnecter.' : 'Jeton de session invalide.'
      }
    });
  }
};

/**
 * Middleware pour restreindre l'accès aux seuls administrateurs (principal ou secondaire) d'un groupe
 */
export const requireGroupAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: {
        code: ERROR_CODES.UNAUTHORIZED_ACTION,
        message: 'Authentification requise.'
      }
    });
    return;
  }

  const groupId = req.params.groupId || req.params.id_groupe || req.body.id_groupe;

  if (!groupId) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Identifiant du groupe requis pour cette opération.'
      }
    });
    return;
  }

  try {
    const groupObjId = new mongoose.Types.ObjectId(groupId);
    const userObjId = new mongoose.Types.ObjectId(req.user.id_utilisateur);

    const membership = await GroupMember.findOne({
      id_groupe: groupObjId,
      id_utilisateur: userObjId,
      role: { $in: ['admin_principal', 'admin_secondaire'] },
      statut: 'actif'
    });

    if (!membership) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: ERROR_CODES.UNAUTHORIZED_ACTION,
          message: 'Action réservée aux administrateurs de ce groupe.'
        }
      });
      return;
    }

    next();
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Erreur lors de la vérification des autorisations administratives.'
      }
    });
  }
};
