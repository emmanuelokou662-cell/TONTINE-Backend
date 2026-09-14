import { z } from 'zod';

/**
 * Schéma de validation pour la déclaration d'une cotisation (RF-06)
 */
export const declarePaymentSchema = z.object({
  id_groupe: z.string().uuid('Identifiant du groupe invalide'),
  id_tour: z.string().uuid('Identifiant du tour invalide').optional(),
  montant: z.coerce.number().positive('Le montant doit être supérieur à 0'),
  moyen_paiement: z.enum(['MTN_Money', 'Wave'], {
    errorMap: () => ({ message: 'Le moyen de paiement doit être "MTN_Money" ou "Wave"' })
  }),
  numero_tx_operateur: z.string().min(4, 'Le numéro de transaction opérateur est requis').max(100)
});

/**
 * Schéma de validation pour valider une cotisation (RF-07)
 */
export const validatePaymentSchema = z.object({
  id_transaction: z.string().uuid('Identifiant de transaction invalide')
});

/**
 * Schéma de validation pour rejeter une cotisation (RF-07)
 */
export const rejectPaymentSchema = z.object({
  id_transaction: z.string().uuid('Identifiant de transaction invalide'),
  motif_rejet: z.string().min(5, 'Le motif du rejet est obligatoire et doit comporter au moins 5 caractères')
});

/**
 * Schéma pour la confirmation de versement de la cagnotte par l'admin (RF-11)
 */
export const confirmDistributionSchema = z.object({
  id_tour: z.string().uuid('Identifiant du tour invalide'),
  montant: z.coerce.number().positive('Le montant distribué doit être supérieur à 0')
});

/**
 * Schéma pour la définition de l'ordre de passage des membres (RF-09)
 */
export const setTourOrderSchema = z.object({
  id_cycle: z.string().uuid('Identifiant de cycle invalide'),
  ordres: z.array(
    z.object({
      id_membre_groupe: z.string().uuid(),
      ordre_passage: z.number().int().positive()
    })
  ).min(2, 'Le cycle doit comporter au moins 2 membres ordonnés')
});

/**
 * Schéma pour fixer le montant de cotisation du cycle (RF-25)
 */
export const setCycleAmountSchema = z.object({
  id_cycle: z.string().uuid('Identifiant de cycle invalide'),
  montant_cotisation: z.number().positive('Le montant doit être strictement positif')
});
