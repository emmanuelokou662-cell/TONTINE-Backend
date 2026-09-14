import mongoose from 'mongoose';
import { env } from './env';

/**
 * Gestionnaire de connexion asynchrone à MongoDB via Mongoose
 */
export const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(env.MONGODB_URI, {
      autoIndex: true,
      serverSelectionTimeoutMS: 5000,
    });

    console.log(`🍃 MongoDB connecté avec succès : ${conn.connection.host} (Base: ${conn.connection.name})`);
  } catch (error: any) {
    console.error('❌ Erreur critique de connexion à MongoDB :', error.message);
    if (env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      console.warn('⚠️ En mode développement local, assurez-vous que MongoDB est démarré ou renseignez MONGODB_URI dans votre .env');
    }
  }
};

// Gestion de la fermeture propre de la connexion MongoDB
mongoose.connection.on('disconnected', () => {
  console.log('⚠️ Déconnexion de MongoDB.');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Erreur d\'exécution MongoDB :', err);
});
