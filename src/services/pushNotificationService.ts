import webpush from 'web-push';
import { env } from '../config/env';
import { prisma } from '../config/prisma';

// Initialisation des clés VAPID standard W3C (RF-88)
webpush.setVapidDetails(
  env.VAPID_SUBJECT,
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY
);

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: {
    url?: string;
    groupId?: string;
    type?: string;
  };
}

/**
 * Enregistrer ou mettre à jour la souscription Web Push d'un utilisateur
 */
export const savePushSubscription = async (userId: string, subscription: any): Promise<void> => {
  await prisma.utilisateur.update({
    where: { id_utilisateur: userId },
    data: {
      push_subscription: JSON.stringify(subscription)
    }
  });
};

/**
 * Envoyer une notification push Web à un utilisateur spécifique
 */
export const sendPushToUser = async (userId: string, payload: PushPayload): Promise<boolean> => {
  try {
    const user = await prisma.utilisateur.findUnique({
      where: { id_utilisateur: userId },
      select: { push_subscription: true }
    });

    if (!user || !user.push_subscription) {
      return false;
    }

    const subscription = JSON.parse(user.push_subscription);
    const notificationString = JSON.stringify({
      notification: {
        title: payload.title,
        body: payload.body,
        icon: payload.icon || '/icons/icon-192x192.png',
        badge: payload.badge || '/icons/badge-72x72.png',
        data: payload.data || {}
      }
    });

    await webpush.sendNotification(subscription, notificationString);
    return true;
  } catch (error: any) {
    // Si la souscription a expiré ou a été révoquée par le navigateur (410 Gone / 404 Not Found)
    if (error.statusCode === 410 || error.statusCode === 404) {
      await prisma.utilisateur.update({
        where: { id_utilisateur: userId },
        data: { push_subscription: null }
      });
    }
    console.warn(`Impossible d'envoyer la notification push à l'utilisateur ${userId} :`, error.message);
    return false;
  }
};

/**
 * Envoyer une notification push à tous les membres actifs d'un groupe (RF-91)
 */
export const sendPushToGroup = async (
  groupId: string,
  payload: PushPayload,
  excludeUserId?: string
): Promise<void> => {
  const members = await prisma.membreGroupe.findMany({
    where: {
      id_groupe: groupId,
      statut: { in: ['actif', 'suspecte'] },
      ...(excludeUserId ? { id_utilisateur: { not: excludeUserId } } : {})
    },
    select: { id_utilisateur: true }
  });

  const promises = members.map((m) =>
    sendPushToUser(m.id_utilisateur, {
      ...payload,
      data: { ...payload.data, groupId }
    })
  );

  await Promise.allSettled(promises);
};
