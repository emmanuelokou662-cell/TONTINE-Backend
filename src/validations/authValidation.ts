import { z } from 'zod';

// Regex pour valider le format ivoirien Mobile Money (+225 suivi de 10 chiffres ou 10 chiffres directs)
const PHONE_CI_REGEX = /^(\+225|00225)?[0-9]{10}$/;

// Regex pour valider un code PIN à exactement 5 chiffres
const PIN_REGEX = /^[0-9]{5}$/;

// Regex pour valider un code OTP à 6 chiffres
const OTP_REGEX = /^[0-9]{6}$/;

/**
 * Schéma de validation pour l'inscription (RF-01, RF-02)
 */
export const registerSchema = z.object({
  nom: z.string().min(2, 'Le nom doit comporter au moins 2 caractères').max(100),
  prenom: z.string().min(2, 'Le prénom doit comporter au moins 2 caractères').max(100),
  contact_paiement: z.string().regex(PHONE_CI_REGEX, 'Le contact Mobile Money doit comporter l\'indicatif +225 et 10 chiffres valides'),
  email: z.string().email('Format d\'adresse email invalide'),
  ville: z.string().min(2, 'La ville doit comporter au moins 2 caractères').max(100),
  code_pin: z.string().regex(PIN_REGEX, 'Le code PIN doit comporter exactement 5 chiffres'),
  confirmation_pin: z.string().regex(PIN_REGEX, 'La confirmation du PIN doit comporter exactement 5 chiffres')
}).refine((data) => data.code_pin === data.confirmation_pin, {
  message: 'Le code PIN et sa confirmation ne correspondent pas.',
  path: ['confirmation_pin']
});

/**
 * Schéma de validation pour la connexion par PIN (RF-02)
 */
export const loginSchema = z.object({
  contact_paiement: z.string().min(8, 'Le contact de paiement est requis'),
  code_pin: z.string().regex(PIN_REGEX, 'Le code PIN doit comporter exactement 5 chiffres')
});

/**
 * Schéma de validation pour la vérification OTP (RF-03)
 */
export const verifyOtpSchema = z.object({
  email: z.string().email('Format d\'adresse email invalide'),
  code: z.string().regex(OTP_REGEX, 'Le code de vérification doit comporter 6 chiffres')
});

/**
 * Schéma pour demander un renvoi de code OTP
 */
export const resendOtpSchema = z.object({
  email: z.string().email('Format d\'adresse email invalide')
});

/**
 * Schéma pour le rafraîchissement de token JWT
 */
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Le jeton de rafraîchissement est requis')
});

/**
 * Schéma pour le changement de code PIN (RF-28)
 */
export const changePinSchema = z.object({
  ancien_pin: z.string().regex(PIN_REGEX, 'L\'ancien code PIN doit comporter 5 chiffres'),
  nouveau_pin: z.string().regex(PIN_REGEX, 'Le nouveau code PIN doit comporter 5 chiffres'),
  confirmation_nouveau_pin: z.string().regex(PIN_REGEX, 'La confirmation doit comporter 5 chiffres')
}).refine((data) => data.nouveau_pin === data.confirmation_nouveau_pin, {
  message: 'Le nouveau code PIN et sa confirmation ne correspondent pas.',
  path: ['confirmation_nouveau_pin']
});

/**
 * Schéma pour la mise à jour des informations du profil (RF-22)
 */
export const updateProfileSchema = z.object({
  nom: z.string().min(2).max(100).optional(),
  prenom: z.string().min(2).max(100).optional(),
  ville: z.string().min(2).max(100).optional(),
  theme_preference: z.enum(['clair', 'sombre']).optional()
});

/**
 * Schéma pour la modification du contact de paiement Mobile Money (RF-27)
 */
export const updatePaymentContactSchema = z.object({
  nouveau_contact: z.string().regex(PHONE_CI_REGEX, 'Le nouveau contact Mobile Money doit être valide (+225)'),
  code_pin: z.string().regex(PIN_REGEX, 'Le code PIN est requis pour valider cette modification')
});
