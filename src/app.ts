import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { env } from './config/env';
import { generalApiLimiter } from './middlewares/rateLimiter';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';

// Import des routeurs
import authRoutes from './routes/authRoutes';
import groupRoutes from './routes/groupRoutes';
import transactionRoutes from './routes/transactionRoutes';
import notificationRoutes from './routes/notificationRoutes';

export const createApp = (): Express => {
  const app = express();

  // 1. Sécurité HTTP & En-têtes avec Helmet
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));

  // 2. Configuration CORS sécurisée (Supporte ALLOW_ORIGINS, localhost & production)
  app.use(cors({
    origin: (origin, callback) => {
      // Autoriser les requêtes sans origin (applis PWA natives, requêtes serveur-à-serveur, healthcheck, curl)
      if (!origin) return callback(null, true);

      const normalizedOrigin = origin.replace(/\/+$/, '');

      // Autorisation si wildcard '*' ou présent dans la liste
      if (
        env.ALLOWED_ORIGINS_LIST.includes('*') ||
        env.ALLOWED_ORIGINS_LIST.includes(normalizedOrigin) ||
        env.ALLOWED_ORIGINS_LIST.includes(origin)
      ) {
        return callback(null, true);
      }

      // En mode développement, autoriser automatiquement toutes les variantes de localhost
      if (env.NODE_ENV === 'development' && /^http:\/\/localhost(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }

      console.warn(`⚠️ [CORS] Origine bloquée : ${origin}. Origines configurées :`, env.ALLOWED_ORIGINS_LIST);
      return callback(new Error(`Origine non autorisée par la politique CORS : ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
  }));

  // 3. Limiteur de débit global
  app.use('/api', generalApiLimiter);

  // 4. Analyseurs de corps de requêtes (Body Parsers)
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 5. Service des fichiers statiques d'uploads (photos de profil, reçus)
  const uploadPath = path.resolve(process.cwd(), env.UPLOAD_DIR);
  app.use('/uploads', express.static(uploadPath));

  // 6. Point de contrôle de santé du serveur (Health Check)
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'success',
      service: 'Tontine PWA Backend API',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV
    });
  });

  // 7. Montage des routes métiers
  app.use('/api/auth', authRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/transactions', transactionRoutes);
  app.use('/api/notifications', notificationRoutes);

  // 8. Gestionnaires d'erreurs et routes introuvables (404)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
