import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { savePushSubscription, sendPushToUser } from '../services/pushNotificationService';
import { env } from '../config/env';
import { HTTP_STATUS } from '../constants/httpCodes';
import { z } from 'zod';

const messageSchema = z.object({
  id_groupe: z.string().uuid(),
  id_destinataire: z.string().uuid(),
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
    const userId = req.user!.id_utilisateur;
    const notifications = await prisma.notification.findMany({
      where: { id_utilisateur: userId },
      orderBy: { created_at: 'desc' },
      take: 50
    });

    const unreadCount = await prisma.notification.count({
      where: { id_utilisateur: userId, lue: false }
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        notifications,
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
    await prisma.notification.update({
      where: { id_notification: notificationId },
      data: { lue: true }
    });

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

    const message = await prisma.message.create({
      data: {
        id_groupe,
        id_expediteur: senderId,
        id_destinataire,
        contenu: contenu.trim()
      }
    });

    // Envoi d'une notification push au destinataire
    await sendPushToUser(id_destinataire, {
      title: 'Nouveau message reçu',
      body: contenu.length > 50 ? `${contenu.substring(0, 47)}...` : contenu
    });

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
    const userId = req.user!.id_utilisateur;
    const groupId = req.params.groupId as string;

    const messages = await prisma.message.findMany({
      where: {
        id_groupe: groupId,
        OR: [
          { id_expediteur: userId },
          { id_destinataire: userId }
        ]
      },
      include: {
        expediteur: {
          select: { id_utilisateur: true, nom: true, prenom: true, photo_profil_url: true }
        }
      },
      orderBy: { created_at: 'asc' }
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: messages
    });
  } catch (error) {
    next(error);
  }
};
