import { createApp } from './app';
import { env } from './config/env';
import { startScheduledJobs } from './jobs/reminderCron';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log('====================================================');
  console.log(`🚀 Serveur TONTINE Backend démarré sur le port : ${env.PORT}`);
  console.log(`🌐 Environnement : ${env.NODE_ENV}`);
  console.log(`📡 Point d'accès santé : http://localhost:${env.PORT}/api/health`);
  console.log('====================================================');

  // Démarrer les tâches planifiées de rappels et de gestion des cycles
  startScheduledJobs();
});

// Arrêt propre du serveur (Graceful Shutdown)
process.on('SIGTERM', () => {
  console.log('⚠️ Signal SIGTERM reçu. Fermeture sécurisée du serveur...');
  server.close(() => {
    console.log('🛑 Serveur arrêté proprement.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('⚠️ Interruption détectée (Ctrl+C). Fermeture sécurisée du serveur...');
  server.close(() => {
    console.log('🛑 Serveur arrêté proprement.');
    process.exit(0);
  });
});
