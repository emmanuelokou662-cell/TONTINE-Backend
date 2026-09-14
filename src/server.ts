import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDB } from './config/database';
import { socketManager } from './services/socketManager';
import { startScheduledJobs } from './jobs/reminderCron';
import mongoose from 'mongoose';

const startServer = async () => {
  // 1. Initialiser la connexion à MongoDB
  await connectDB();

  // 2. Créer l'application Express
  const app = createApp();

  // 3. Créer le serveur HTTP et y attacher Socket.IO
  const httpServer = http.createServer(app);
  socketManager.init(httpServer);

  // 4. Démarrer le serveur HTTP
  const server = httpServer.listen(env.PORT, '0.0.0.0', () => {
    console.log('====================================================');
    console.log(`🚀 Serveur TONTINE Backend (MERN + Socket.IO) démarré sur le port : ${env.PORT}`);
    console.log(`🌐 Environnement : ${env.NODE_ENV}`);
    console.log(`⚡ Temps Réel Socket.IO : ACTIF`);
    console.log(`📡 Point d'accès santé : http://0.0.0.0:${env.PORT}/api/health`);
    console.log('====================================================');

    // Démarrer les tâches planifiées de rappels et de gestion des cycles
    startScheduledJobs();
  });

  // Arrêt propre du serveur (Graceful Shutdown)
  const shutdown = async (signal: string) => {
    console.log(`⚠️ Signal ${signal} reçu. Fermeture sécurisée du serveur...`);
    server.close(async () => {
      try {
        await mongoose.connection.close();
        console.log('🍃 Connexion MongoDB fermée proprement.');
      } catch (err) {
        console.error('Erreur lors de la fermeture MongoDB :', err);
      }
      console.log('🛑 Serveur arrêté proprement.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

startServer().catch((err) => {
  console.error('💥 Échec critique au démarrage du serveur :', err);
  process.exit(1);
});
