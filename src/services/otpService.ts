import { prisma } from '../config/prisma';
import { generateSecureOtp } from '../utils/security';
import { AppError } from '../middlewares/errorHandler';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';

const OTP_EXPIRATION_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 3;

/**
 * Génère et enregistre un nouveau code OTP pour une adresse email
 */
export const createAndSendOtp = async (email: string): Promise<string> => {
  const normalizedEmail = email.toLowerCase().trim();

  // Vérifier si un OTP récent a été envoyé il y a moins de 60 secondes (RF-03)
  const recentOtp = await prisma.otpCode.findFirst({
    where: {
      email: normalizedEmail,
      utilise: false,
      created_at: {
        gte: new Date(Date.now() - OTP_RESEND_COOLDOWN_SECONDS * 1000)
      }
    }
  });

  if (recentOtp) {
    throw new AppError(
      'Veuillez patienter 60 secondes avant de demander un nouveau code de vérification.',
      HTTP_STATUS.TOO_MANY_REQUESTS,
      ERROR_CODES.OTP_COOLDOWN
    );
  }

  // Invalider les anciens codes OTP non utilisés pour cet email
  await prisma.otpCode.updateMany({
    where: {
      email: normalizedEmail,
      utilise: false
    },
    data: { utilise: true }
  });

  const code = generateSecureOtp();
  const expireA = new Date(Date.now() + OTP_EXPIRATION_MINUTES * 60 * 1000);

  await prisma.otpCode.create({
    data: {
      email: normalizedEmail,
      code,
      expire_a: expireA,
      tentatives: 0,
      utilise: false
    }
  });

  // Simulation d'envoi d'email sécurisé (En production: SendGrid, Resend, Nodemailer)
  console.log(`📨 [OTP EMAIL ENVOYÉ] Destinataire: ${normalizedEmail} | Code: ${code} (Expire dans 10 min)`);

  return code;
};

/**
 * Valide un code OTP saisi par l'utilisateur (RF-03)
 */
export const verifyOtpCode = async (email: string, code: string): Promise<boolean> => {
  const normalizedEmail = email.toLowerCase().trim();

  const otpRecord = await prisma.otpCode.findFirst({
    where: {
      email: normalizedEmail,
      utilise: false
    },
    orderBy: { created_at: 'desc' }
  });

  if (!otpRecord) {
    throw new AppError(
      'Aucun code de vérification actif trouvé pour cette adresse email. Veuillez en demander un nouveau.',
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.OTP_INVALID
    );
  }

  // Vérifier si le code a expiré (10 minutes)
  if (new Date() > otpRecord.expire_a) {
    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { utilise: true }
    });
    throw new AppError(
      'Ce code de vérification a expiré. Veuillez demander un nouveau code.',
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.OTP_EXPIRED
    );
  }

  // Vérifier si le nombre de tentatives maximales est atteint (3 tentatives)
  if (otpRecord.tentatives >= OTP_MAX_ATTEMPTS) {
    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { utilise: true }
    });
    throw new AppError(
      'Nombre maximal de tentatives atteint (3 échecs). Ce code est invalidé.',
      HTTP_STATUS.TOO_MANY_REQUESTS,
      ERROR_CODES.OTP_MAX_ATTEMPTS
    );
  }

  // Vérification de la concordance du code
  if (otpRecord.code !== code) {
    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { tentatives: otpRecord.tentatives + 1 }
    });
    const restants = OTP_MAX_ATTEMPTS - (otpRecord.tentatives + 1);
    throw new AppError(
      `Code de vérification incorrect. Tentatives restantes : ${restants}.`,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.OTP_INVALID
    );
  }

  // Marquer le code comme utilisé
  await prisma.otpCode.update({
    where: { id: otpRecord.id },
    data: { utilise: true }
  });

  // Mettre à jour le statut email_verifie de l'utilisateur s'il existe
  await prisma.utilisateur.updateMany({
    where: { email: normalizedEmail },
    data: { email_verifie: true }
  });

  return true;
};
