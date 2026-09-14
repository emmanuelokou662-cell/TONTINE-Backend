import { PrismaClient } from '@prisma/client';

// Singleton pour l'instance Prisma Client afin d'éviter les fuites de connexion
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
});
