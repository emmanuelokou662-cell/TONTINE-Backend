import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';
import { env } from '../config/env';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = HTTP_STATUS.BAD_REQUEST, errorCode: string = ERROR_CODES.VALIDATION_ERROR) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Middleware de gestion globale des erreurs
 */
export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Gestion des erreurs de validation Zod
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      champ: e.path.join('.'),
      message: e.message
    }));

    res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Les données fournies ne respectent pas les critères de validation.',
        details: formattedErrors
      }
    });
    return;
  }

  // Gestion des erreurs applicatives intentionnelles
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.errorCode,
        message: err.message
      }
    });
    return;
  }

  // Erreurs d'unicité Prisma (P2002)
  if (err.code === 'P2002') {
    const targetField = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : 'champ';
    res.status(HTTP_STATUS.CONFLICT).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Une entrée avec cette valeur existe déjà (${targetField}).`
      }
    });
    return;
  }

  // Erreurs inattendues (500)
  const isDev = env.NODE_ENV === 'development';
  console.error('💥 Erreur serveur inattendue :', err);

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Une erreur interne est survenue sur le serveur.',
      ...(isDev ? { stack: err.stack, raw: err.message } : {})
    }
  });
};

/**
 * Middleware pour intercepter les routes inexistantes (404)
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    success: false,
    error: {
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
      message: `La ressource demandée [${req.method} ${req.originalUrl}] est introuvable.`
    }
  });
};
