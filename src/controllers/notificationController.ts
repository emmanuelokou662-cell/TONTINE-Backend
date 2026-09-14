import { Request, Response, NextFunction } from 'express';
import { Notification, Message, User } from '../models';
import { savePushSubscription, sendPushToUser } from '../services/pushNotificationService';
import { socketManager } from '../services/socketManager';
import { env } from '../config/env';
import { HTTP_STATUS } from '../constants/httpCodes';
import { z } from 'zod';
import mongoose from 'mongoose';

const messageSchema = z.object({
  id_groupe: z.string().min(1, 'Identifiant du groupe requis'),
  id_destinataire: z.string().min(1, 'Identifiant du destinataire requis'),
  contenu: z.string().min(1, 'Le message ne peut pas être vide').max(1000)
});

/**
 * Obtenir la clé publique VAPID pour l'abonnement du navigateur (RF-88)
 */
export const getVapidPublicKey = (_req: Request, res: Response): void => {
  res.status(HTTP_STATUS.OK).json({
    success: true,
    data: { publicKey: env.VAPID_PUBLIC_KEY }
  });
};

/**
 * Enregistrer l'abonnement push Web du client
 */
export const subscribePush = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id_utilisateur;
    const subscription = req.body;
    await savePushSubscription(userId, subscription);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Abonnement aux notifications push enregistré avec succès.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Récupérer les notifications de l'utilisateur connecté
 */
export const getNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userObjId = new mongoose.Types.ObjectId(req.user!.id_utilisateur);

    const notifications = await Notification.find({ id_utilisateur: userObjId })
      .sort({ created_at: -1 })
      .limit(50)
      .lean();

    const unreadCount = await Notification.countDocuments({
      id_utilisateur: userObjId,
      lue: false
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        notifications: notifications.map((n) => ({
          ...n,
          id_notification: n._id.toString()
        })),
        unreadCount
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Marquer une notification comme lue
 */
export const markNotificationAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const notificationId = req.params.notificationId as string;
    await Notification.findByIdAndUpdate(notificationId, { lue: true });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Notification marquée comme lue.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Envoyer un message dans la boîte de messagerie / Inbox du groupe (RF-12, 14.8)
 */
export const sendMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const senderId = req.user!.id_utilisateur;
    const { id_groupe, id_destinataire, contenu } = messageSchema.parse(req.body);

    const message = await Message.create({
      id_groupe: new mongoose.Types.ObjectId(id_groupe),
      id_expediteur: new mongoose.Types.ObjectId(senderId),
      id_destinataire: new mongoose.Types.ObjectId(id_destinataire),
      contenu: contenu.trim()
    });

    // Envoi d'une notification push au destinataire
    await sendPushToUser(id_destinataire, {
      title: 'Nouveau message reçu',
      body: contenu.length > 50 ? `${contenu.substring(0, 47)}...` : contenu
    });

    // Diffusion temps réel Socket.IO au groupe et au destinataire
    socketManager.broadcastNewMessage(id_groupe, message.toJSON());

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: message
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtenir les messages échangés dans un groupe
 */
export const getGroupMessages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userObjId = new mongoose.Types.ObjectId(req.user!.id_utilisateur);
    const groupObjId = new mongoose.Types.ObjectId(req.params.groupId as string);

    const messages = await Message.find({
      id_groupe: groupObjId,
      $or: [
        { id_expediteur: userObjId },
        { id_destinataire: userObjId }
      ]
    }).sort({ created_at: 1 }).lean();

    const formattedMessages = [];
    for (const msg of messages) {
      const expediteur = await User.findById(msg.id_expediteur, 'nom prenom photo_profil_url').lean();
      formattedMessages.push({
        ...msg,
        id_message: msg._id.toString(),
        expediteur: expediteur ? { ...expediteur, id_utilisateur: expediteur._id.toString() } : null
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: formattedMessages
    });
  } catch (error) {
    next(error);
  }
};
