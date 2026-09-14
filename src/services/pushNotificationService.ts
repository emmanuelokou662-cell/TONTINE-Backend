import webpush from 'web-push';
import { env } from '../config/env';
import { User, GroupMember } from '../models';
import mongoose from 'mongoose';

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
  await User.findByIdAndUpdate(userId, {
    push_subscription: JSON.stringify(subscription)
  });
};

/**
 * Envoyer une notification push Web à un utilisateur spécifique
 */
export const sendPushToUser = async (userId: string, payload: PushPayload): Promise<boolean> => {
  try {
    const user = await User.findById(userId, 'push_subscription');

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
      await User.findByIdAndUpdate(userId, { push_subscription: null });
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
  const groupObjId = new mongoose.Types.ObjectId(groupId);

  const query: any = {
    id_groupe: groupObjId,
    statut: { $in: ['actif', 'suspecte'] }
  };

  if (excludeUserId) {
    query.id_utilisateur = { $ne: new mongoose.Types.ObjectId(excludeUserId) };
  }

  const members = await GroupMember.find(query, 'id_utilisateur');

  const promises = members.map((m) =>
    sendPushToUser(m.id_utilisateur.toString(), {
      ...payload,
      data: { ...payload.data, groupId }
    })
  );

  await Promise.allSettled(promises);
};
