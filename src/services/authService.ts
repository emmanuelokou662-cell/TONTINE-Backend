import { prisma } from '../config/prisma';
import { hashSecret, compareSecret, generateAuthTokens, verifyRefreshToken, AuthTokens } from '../utils/security';
import { AppError } from '../middlewares/errorHandler';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';
import { createAndSendOtp } from './otpService';

const MAX_PIN_FAILURES = 5;
const PIN_BLOCK_DURATION_MINUTES = 15;

export interface RegisterUserInput {
  nom: string;
  prenom: string;
  contact_paiement: string;
  email: string;
  ville: string;
  code_pin: string;
  photo_profil_url: string;
}

export interface UserResponse {
  id_utilisateur: string;
  nom: string;
  prenom: string;
  contact_paiement: string;
  email: string;
  email_verifie: boolean;
  ville: string;
  photo_profil_url: string;
  theme_preference: string;
  created_at: Date;
}

const sanitizeUser = (user: any): UserResponse => ({
  id_utilisateur: user.id_utilisateur,
  nom: user.nom,
  prenom: user.prenom,
  contact_paiement: user.contact_paiement,
  email: user.email,
  email_verifie: user.email_verifie,
  ville: user.ville,
  photo_profil_url: user.photo_profil_url,
  theme_preference: user.theme_preference,
  created_at: user.created_at
});

/**
 * Inscription d'un nouvel utilisateur (RF-01, RF-02)
 */
export const registerUser = async (data: RegisterUserInput): Promise<{ user: UserResponse; tokens: AuthTokens }> => {
  const normalizedEmail = data.email.toLowerCase().trim();
  const normalizedContact = data.contact_paiement.trim();

  // Vérifier l'unicité de l'email
  const existingEmail = await prisma.utilisateur.findUnique({
    where: { email: normalizedEmail }
  });
  if (existingEmail) {
    throw new AppError('Cette adresse email est déjà utilisée par un autre compte.', HTTP_STATUS.CONFLICT, ERROR_CODES.VALIDATION_ERROR);
  }

  // Vérifier l'unicité du contact Mobile Money
  const existingContact = await prisma.utilisateur.findUnique({
    where: { contact_paiement: normalizedContact }
  });
  if (existingContact) {
    throw new AppError('Ce numéro Mobile Money est déjà enregistré sur la plateforme.', HTTP_STATUS.CONFLICT, ERROR_CODES.VALIDATION_ERROR);
  }

  // Hachage du code PIN (12 rounds)
  const hashedPin = await hashSecret(data.code_pin);

  const newUser = await prisma.utilisateur.create({
    data: {
      nom: data.nom.trim(),
      prenom: data.prenom.trim(),
      contact_paiement: normalizedContact,
      email: normalizedEmail,
      email_verifie: false,
      code_pin: hashedPin,
      ville: data.ville.trim(),
      photo_profil_url: data.photo_profil_url,
      theme_preference: 'clair'
    }
  });

  // Envoi automatique du code OTP par email (RF-03)
  try {
    await createAndSendOtp(newUser.email);
  } catch (otpErr) {
    console.warn('Erreur lors de l\'envoi de l\'OTP initial :', otpErr);
  }

  const tokens = generateAuthTokens({
    id_utilisateur: newUser.id_utilisateur,
    email: newUser.email,
    contact_paiement: newUser.contact_paiement
  });

  return { user: sanitizeUser(newUser), tokens };
};

/**
 * Connexion sécurisée par code PIN (RF-02)
 */
export const loginWithPin = async (contactPaiement: string, codePin: string): Promise<{ user: UserResponse; tokens: AuthTokens }> => {
  const normalizedContact = contactPaiement.trim();

  const user = await prisma.utilisateur.findUnique({
    where: { contact_paiement: normalizedContact }
  });

  if (!user) {
    throw new AppError('Identifiants incorrects. Numéro ou code PIN invalide.', HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.INVALID_CREDENTIALS);
  }

  // Vérifier le blocage temporaire (RF-02)
  if (user.blocage_jusqu_a && user.blocage_jusqu_a > new Date()) {
    const minutesRestantes = Math.ceil((user.blocage_jusqu_a.getTime() - Date.now()) / (60 * 1000));
    throw new AppError(
      `Compte temporairement verrouillé. Veuillez réessayer dans ${minutesRestantes} minute(s).`,
      HTTP_STATUS.TOO_MANY_REQUESTS,
      ERROR_CODES.PIN_BLOCKED
    );
  }

  const isPinValid = await compareSecret(codePin, user.code_pin);

  if (!isPinValid) {
    const newFailures = user.tentatives_echouees + 1;
    let updateData: any = { tentatives_echouees: newFailures };

    if (newFailures >= MAX_PIN_FAILURES) {
      updateData = {
        tentatives_echouees: 0,
        blocage_jusqu_a: new Date(Date.now() + PIN_BLOCK_DURATION_MINUTES * 60 * 1000)
      };
      await prisma.utilisateur.update({ where: { id_utilisateur: user.id_utilisateur }, data: updateData });
      throw new AppError(
        'Code PIN incorrect. 5 tentatives échouées : votre compte est bloqué pendant 15 minutes.',
        HTTP_STATUS.TOO_MANY_REQUESTS,
        ERROR_CODES.PIN_BLOCKED
      );
    }

    await prisma.utilisateur.update({ where: { id_utilisateur: user.id_utilisateur }, data: updateData });
    const restants = MAX_PIN_FAILURES - newFailures;
    throw new AppError(
      `Code PIN incorrect. ${restants} tentative(s) restante(s) avant verrouillage.`,
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.INVALID_PIN
    );
  }

  // Réinitialisation des tentatives échouées après succès
  await prisma.utilisateur.update({
    where: { id_utilisateur: user.id_utilisateur },
    data: { tentatives_echouees: 0, blocage_jusqu_a: null }
  });

  const tokens = generateAuthTokens({
    id_utilisateur: user.id_utilisateur,
    email: user.email,
    contact_paiement: user.contact_paiement
  });

  return { user: sanitizeUser(user), tokens };
};

/**
 * Renouvellement du jeton d'accès via le refresh token
 */
export const refreshUserSession = async (refreshToken: string): Promise<AuthTokens> => {
  try {
    const decoded = verifyRefreshToken(refreshToken);
    const user = await prisma.utilisateur.findUnique({
      where: { id_utilisateur: decoded.id_utilisateur }
    });

    if (!user) {
      throw new AppError('Utilisateur introuvable.', HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.TOKEN_INVALID);
    }

    return generateAuthTokens({
      id_utilisateur: user.id_utilisateur,
      email: user.email,
      contact_paiement: user.contact_paiement
    });
  } catch (err) {
    throw new AppError('Session expirée ou jeton de rafraîchissement invalide.', HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.TOKEN_EXPIRED);
  }
};

/**
 * Récupération des informations de profil
 */
export const getUserProfile = async (userId: string): Promise<UserResponse> => {
  const user = await prisma.utilisateur.findUnique({
    where: { id_utilisateur: userId }
  });
  if (!user) {
    throw new AppError('Utilisateur introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }
  return sanitizeUser(user);
};

/**
 * Mise à jour du code PIN personnel (RF-28)
 */
export const changePin = async (userId: string, ancienPin: string, nouveauPin: string): Promise<void> => {
  const user = await prisma.utilisateur.findUnique({
    where: { id_utilisateur: userId }
  });
  if (!user) {
    throw new AppError('Utilisateur introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const isOldPinValid = await compareSecret(ancienPin, user.code_pin);
  if (!isOldPinValid) {
    throw new AppError('L\'ancien code PIN est incorrect.', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_PIN);
  }

  const hashedNewPin = await hashSecret(nouveauPin);
  await prisma.utilisateur.update({
    where: { id_utilisateur: userId },
    data: { code_pin: hashedNewPin }
  });
};
