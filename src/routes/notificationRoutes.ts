import { Router } from 'express';
import {
  getVapidPublicKey,
  subscribePush,
  getNotifications,
  markNotificationAsRead,
  sendMessage,
  getGroupMessages
} from '../controllers/notificationController';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

// Obtenir la clé publique VAPID (accessible sans authentification pour initier le push)
router.get('/vapid-public-key', getVapidPublicKey);

// Enregistrer la souscription push du navigateur
router.post('/subscribe', authenticate, subscribePush);

// Récupérer toutes les notifications de l'utilisateur
router.get('/', authenticate, getNotifications);

// Marquer une notification comme lue
router.put('/:notificationId/read', authenticate, markNotificationAsRead);

// Envoyer un message dans la messagerie du groupe (RF-12)
router.post('/messages', authenticate, sendMessage);

// Récupérer les messages du groupe pour l'utilisateur
router.get('/messages/:groupId', authenticate, getGroupMessages);

export default router;
