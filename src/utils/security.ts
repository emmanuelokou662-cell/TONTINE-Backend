import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

const BCRYPT_SALT_ROUNDS = 12;

export interface JwtUserPayload {
  id_utilisateur: string;
  email: string;
  contact_paiement: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Hache un code PIN ou un mot de passe avec bcrypt (12 rounds)
 */
export const hashSecret = async (secret: string): Promise<string> => {
  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  return bcrypt.hash(secret, salt);
};

/**
 * Compare un secret en clair avec sa version hachée
 */
export const compareSecret = async (secret: string, hashed: string): Promise<boolean> => {
  return bcrypt.compare(secret, hashed);
};

/**
 * Génère les jetons JWT (Access Token 15 min + Refresh Token 7 jours)
 */
export const generateAuthTokens = (payload: JwtUserPayload): AuthTokens => {
  const accessToken = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as any
  });

  const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as any
  });

  return { accessToken, refreshToken };
};

/**
 * Vérifie et décode un Access Token JWT
 */
export const verifyAccessToken = (token: string): JwtUserPayload => {
  return jwt.verify(token, env.JWT_SECRET) as JwtUserPayload;
};

/**
 * Vérifie et décode un Refresh Token JWT
 */
export const verifyRefreshToken = (token: string): JwtUserPayload => {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtUserPayload;
};

/**
 * Génère un code OTP numérique cryptographiquement sécurisé à 6 chiffres
 */
export const generateSecureOtp = (): string => {
  const buffer = crypto.randomBytes(4);
  const randomNumber = buffer.readUInt32BE(0) % 900000 + 100000;
  return randomNumber.toString();
};
