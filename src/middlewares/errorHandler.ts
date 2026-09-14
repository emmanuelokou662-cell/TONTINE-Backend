import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';
import { env } from '../config/env';

/**
 * Classe d'erreur personnalisée pour les erreurs métier de l'API
 */
export class AppError extends Error {
  public statusCode: number;
  public errorCode: string;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = HTTP_STATUS.BAD_REQUEST, errorCode: string = ERROR_CODES.INTERNAL_ERROR) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Middleware global de capture et de formatage des erreurs
 */
export const errorHandler: ErrorRequestHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Gestion des erreurs de validation Zod (RF-01, RF-06)
  if (err instanceof ZodError) {
    const formattedErrors: Record<string, string[]> = {};
    err.errors.forEach((e) => {
      const field = e.path.join('.') || 'general';
      if (!formattedErrors[field]) {
        formattedErrors[field] = [];
      }
      formattedErrors[field].push(e.message);
    });

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

  // Erreurs d'unicité MongoDB (E11000 duplicate key error)
  if (err.code === 11000) {
    const keys = Object.keys(err.keyPattern || err.keyValue || {}).join(', ') || 'champ';
    res.status(HTTP_STATUS.CONFLICT).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Une entrée avec cette valeur existe déjà (${keys}).`
      }
    });
    return;
  }

  // Erreurs de Cast Mongoose (ID invalide)
  if (err.name === 'CastError') {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Format d'identifiant invalide pour le champ ${err.path}.`
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
      message: `Point d'accès introuvable : ${req.method} ${req.originalUrl}`
    }
  });
};
