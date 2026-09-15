import { z } from 'zod';

export const periodiciteEnum = z.enum(
  ['1jour', '2jours', '3jours', '4jours', '5jours', '1semaine', '2semaines', '1mois', '2mois', '1an'],
  {
    errorMap: () => ({ message: 'La périodicité doit être de 1 à 5 jours, 1 ou 2 semaines, 1 ou 2 mois, ou 1 an' })
  }
);

/**
 * Schéma de validation pour la création d'un groupe
 * Accepte les chiffres, lettres (majuscules/minuscules) et symboles (min 6 caractères)
 */
export const createGroupSchema = z.object({
  nom_groupe: z.string().min(3, 'Le nom du groupe doit comporter au moins 3 caractères').max(100),
  mot_de_passe_groupe: z.string().min(6, 'Le mot de passe du groupe doit comporter au moins 6 caractères').max(32, 'Le mot de passe ne doit pas dépasser 32 caractères'),
  periodicite: periodiciteEnum,
  montant_cotisation: z.number().positive('Le montant de cotisation doit être supérieur à 0')
});

/**
 * Schéma de validation pour la mise à jour des paramètres du groupe / cycle (RF-25)
 */
export const updateGroupSettingsSchema = z.object({
  periodicite: periodiciteEnum.optional(),
  montant_cotisation: z.number().positive('Le montant de cotisation doit être supérieur à 0').optional()
});

/**
 * Schéma de validation pour rejoindre un groupe existant
 */
export const joinGroupSchema = z.object({
  mot_de_passe_groupe: z.string().min(6, 'Le mot de passe du groupe doit comporter au moins 6 caractères').max(32)
});

/**
 * Schéma pour désigner l'administrateur secondaire (RF-04)
 */
export const setSecondaryAdminSchema = z.object({
  id_membre_utilisateur: z.string().uuid('Identifiant utilisateur invalide')
});

/**
 * Schéma pour la décision sur un membre suspecté (RF-16)
 */
export const decideSuspectedMemberSchema = z.object({
  id_membre_groupe: z.string().uuid('Identifiant membre invalide'),
  decision: z.enum(['maintenir', 'retirer'], {
    errorMap: () => ({ message: 'La décision doit être "maintenir" ou "retirer"' })
  })
});
