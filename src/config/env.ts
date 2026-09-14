import dotenv from 'dotenv';
import { z } from 'zod';

// Chargement des variables d'environnement depuis le fichier .env
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  
  // URI MongoDB (supporte MONGODB_URI ou DATABASE_URL pour compatibilité)
  MONGODB_URI: z.string().default(
    process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://127.0.0.1:27017/tontine_db'
  ),
  
  // Sécurité JWT
  JWT_SECRET: z.string().min(32, 'Le secret JWT doit comporter au moins 32 caractères').default('tontine_jwt_super_secret_key_prod_grade_2026_securite_maximale'),
  JWT_REFRESH_SECRET: z.string().min(32, 'Le secret de rafraîchissement doit comporter au moins 32 caractères').default('tontine_refresh_super_secret_key_prod_grade_2026_securite_maximale'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  
  // Clés Web Push (VAPID)
  VAPID_PUBLIC_KEY: z.string().default('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckj0Ks2ln0GwHY49If80bmndyHUFVU'),
  VAPID_PRIVATE_KEY: z.string().default('UUxI1Mm-QhQxYQ3iUeM9Hn7O8k9L8P7Y6R5T4W3Q2Z1'),
  VAPID_SUBJECT: z.string().default('mailto:contact@tontine-pwa.ci'),
  
  // Configuration CORS et Origines autorisées
  ALLOW_ORIGINS: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:4173,http://localhost:3000'),
  
  // Configuration Stockage et Uploads
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_FILE_SIZE_MB: z.coerce.number().default(5)
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Configuration des variables d\'environnement invalide :');
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
};

const rawEnv = parseEnv();

// Résolution de la chaîne des origines autorisées
const originsSource = process.env.ALLOW_ORIGINS || process.env.ALLOWED_ORIGINS || rawEnv.ALLOW_ORIGINS || rawEnv.ALLOWED_ORIGINS || rawEnv.CORS_ORIGIN;

const originsList = originsSource
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export const env = {
  ...rawEnv,
  ALLOWED_ORIGINS_LIST: originsList
};
