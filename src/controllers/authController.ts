import { Request, Response, NextFunction } from 'express';
import { registerSchema, loginSchema, verifyOtpSchema, resendOtpSchema, refreshTokenSchema, changePinSchema, updateProfileSchema } from '../validations/authValidation';
import { registerUser, loginWithPin, refreshUserSession, getUserProfile, changePin } from '../services/authService';
import { verifyOtpCode, createAndSendOtp } from '../services/otpService';
import { HTTP_STATUS, ERROR_CODES } from '../constants/httpCodes';
import { AppError } from '../middlewares/errorHandler';
import { prisma } from '../config/prisma';

/**
 * Contrôleur d'inscription (RF-01, RF-02)
 */
export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const validatedData = registerSchema.parse(req.body);

    if (!req.file) {
      throw new AppError('La photo de profil est obligatoire pour créer un compte.', HTTP_STATUS.UNPROCESSABLE_ENTITY, ERROR_CODES.VALIDATION_ERROR);
    }

    const photoUrl = `/uploads/${req.file.filename}`;
    const result = await registerUser({
      ...validatedData,
      photo_profil_url: photoUrl
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Compte créé avec succès. Un code OTP a été envoyé à votre adresse email.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Contrôleur de connexion par code PIN (RF-02)
 */
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { contact_paiement, code_pin } = loginSchema.parse(req.body);
    const result = await loginWithPin(contact_paiement, code_pin);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Connexion réussie.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Contrôleur de vérification du code OTP (RF-03)
 */
export const verifyOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, code } = verifyOtpSchema.parse(req.body);
    await verifyOtpCode(email, code);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Adresse email vérifiée avec succès.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Contrôleur de renvoi de code OTP (RF-03)
 */
export const resendOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = resendOtpSchema.parse(req.body);
    await createAndSendOtp(email);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Un nouveau code de vérification a été envoyé à votre adresse email.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Contrôleur de rafraîchissement de session JWT
 */
export const refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { refreshToken: token } = refreshTokenSchema.parse(req.body);
    const tokens = await refreshUserSession(token);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: tokens
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Contrôleur pour récupérer le profil de l'utilisateur connecté (RF-22)
 */
export const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id_utilisateur;
    const profile = await getUserProfile(userId);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: profile
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Contrôleur de modification du code PIN (RF-28)
 */
export const updatePin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id_utilisateur;
    const { ancien_pin, nouveau_pin } = changePinSchema.parse(req.body);
    await changePin(userId, ancien_pin, nouveau_pin);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Code PIN modifié avec succès.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Contrôleur de mise à jour des informations de profil (RF-22, RF-29)
 */
export const updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id_utilisateur;
    const validated = updateProfileSchema.parse(req.body);

    const updatePayload: any = { ...validated };
    if (req.file) {
      updatePayload.photo_profil_url = `/uploads/${req.file.filename}`;
    }

    const updatedUser = await prisma.utilisateur.update({
      where: { id_utilisateur: userId },
      data: updatePayload
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Profil mis à jour avec succès.',
      data: {
        id_utilisateur: updatedUser.id_utilisateur,
        nom: updatedUser.nom,
        prenom: updatedUser.prenom,
        contact_paiement: updatedUser.contact_paiement,
        email: updatedUser.email,
        ville: updatedUser.ville,
        photo_profil_url: updatedUser.photo_profil_url,
        theme_preference: updatedUser.theme_preference
      }
    });
  } catch (error) {
    next(error);
  }
};
