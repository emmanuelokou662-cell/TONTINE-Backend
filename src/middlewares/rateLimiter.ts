import rateLimit from 'express-rate-limit';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';

/**
 * Limiteur général pour protéger l'ensemble des endpoints de l'API contre les abus
 */
export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requêtes par fenêtre de 15 min par IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      error: {
        code: ERROR_CODES.TOO_MANY_ATTEMPTS,
        message: 'Trop de requêtes envoyées. Veuillez patienter quelques instants avant de réessayer.'
      }
    });
  }
});

/**
 * Limiteur anti-brute-force strict pour la saisie du code PIN (RF-02)
 * Bloque temporairement après 5 tentatives infructueuses sur 15 minutes
 */
export const pinAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives maximum
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Seuls les échecs comptent
  handler: (_req, res) => {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      error: {
        code: ERROR_CODES.PIN_BLOCKED,
        message: 'Compte temporairement bloqué suite à 5 tentatives de code PIN échouées. Réessayez dans 15 minutes.'
      }
    });
  }
});

/**
 * Limiteur pour la vérification OTP Email (RF-03)
 * 3 tentatives maximum par fenêtre de 10 minutes
 */
export const otpVerificationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 3, // 3 tentatives
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, res) => {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      error: {
        code: ERROR_CODES.OTP_MAX_ATTEMPTS,
        message: 'Nombre maximal de tentatives OTP atteint (3 échecs). Veuillez demander un nouveau code.'
      }
    });
  }
});
