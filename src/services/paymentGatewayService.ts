import { Group, GroupMember, Cycle, Transaction, User, Notification } from '../models';
import { AppError } from '../middlewares/errorHandler';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';
import { socketManager } from './socketManager';
import mongoose from 'mongoose';

export interface InitiatePaymentParams {
  userId: string;
  groupId: string;
  provider: 'Wave' | 'MTN_Money' | 'Orange_Money' | 'MoMo';
}

export interface WebhookPaymentPayload {
  provider: 'Wave' | 'MTN_Money' | 'Orange_Money' | 'MoMo';
  transactionIdOperator: string;
  amount: number;
  currency: string;
  groupId: string;
  userId?: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  metadata?: Record<string, any>;
}

/**
 * Service Cerveau de Passerelle de Paiement Automatique
 * Préparé pour intégration d'API et Webhooks (Wave, MTN MoMo, CinetPay, etc.)
 */
class PaymentGatewayService {
  /**
   * 1. Récupère le montant officiel exact fixé par le créateur de la tontine
   */
  public async getOfficialGroupAmount(groupId: string): Promise<number> {
    const groupObjId = new mongoose.Types.ObjectId(groupId);
    const group = await Group.findById(groupObjId);

    if (!group) {
      throw new AppError('Groupe de tontine introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.GROUP_NOT_FOUND);
    }

    // Vérifier si un cycle actif existe avec le montant officiel fixé lors de la création
    const activeCycle = (await Cycle.findOne({ id_groupe: groupObjId, statut: 'en_cours' })) || (await Cycle.findOne({ id_groupe: groupObjId }).sort({ numero_cycle: -1 }));
    const officialAmount = activeCycle ? activeCycle.montant_cotisation : 0;

    return officialAmount;
  }

  /**
   * 2. Préparation d'une session de paiement via API
   * Utilisé lorsque l'API de paiement directe sera activée
   */
  public async initiateDirectPayment(params: InitiatePaymentParams) {
    const { userId, groupId, provider } = params;

    const groupObjId = new mongoose.Types.ObjectId(groupId);
    const userObjId = new mongoose.Types.ObjectId(userId);

    const member = await GroupMember.findOne({ id_groupe: groupObjId, id_utilisateur: userObjId });
    if (!member || member.statut === 'retire') {
      throw new AppError('Membre non autorisé dans ce groupe.', HTTP_STATUS.FORBIDDEN, ERROR_CODES.UNAUTHORIZED_ACTION);
    }

    const officialAmount = await this.getOfficialGroupAmount(groupId);

    // Payload préparé pour l'API de paiement (ex: Wave Checkout URL, MTN MoMo API)
    return {
      groupId,
      userId,
      provider,
      officialAmount,
      currency: 'XOF',
      status: 'INITIALIZED',
      message: 'Prêt pour redirection vers la passerelle de paiement.'
    };
  }

  /**
   * 3. Traitement intelligent et validation automatique par Webhook
   * Valide la cotisation en temps réel sans intervention humaine dès confirmation de l'opérateur
   */
  public async processPaymentWebhook(payload: WebhookPaymentPayload) {
    const { provider, transactionIdOperator, amount, groupId, userId, status } = payload;

    if (status !== 'SUCCESS') {
      console.warn(`⚠️ [Webhook ${provider}] Paiement échoué ou abandonné pour la transaction ${transactionIdOperator}`);
      return { success: false, reason: 'PAYMENT_FAILED_AT_OPERATOR' };
    }

    // A. Vérification de sécurité : Le montant payé correspond-il au montant officiel de la tontine ?
    const officialAmount = await this.getOfficialGroupAmount(groupId);
    if (amount < officialAmount) {
      console.error(`🚨 [Sécurité Webhook] Montant reçu (${amount}) inférieur au montant officiel de la tontine (${officialAmount})`);
      throw new AppError('Le montant payé ne correspond pas au montant fixé par la tontine.', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    // B. Vérification anti-doublon
    const existing = await Transaction.findOne({ numero_tx_operateur: transactionIdOperator.trim() });
    if (existing) {
      if (existing.statut === 'confirme') {
        return { success: true, message: 'Transaction déjà validée auparavant.' };
      }
      existing.statut = 'confirme';
      await existing.save();
      return { success: true, transaction: existing };
    }

    // C. Retrouver le membre
    const groupObjId = new mongoose.Types.ObjectId(groupId);
    let member = null;

    if (userId) {
      member = await GroupMember.findOne({ id_groupe: groupObjId, id_utilisateur: new mongoose.Types.ObjectId(userId) });
    }

    if (!member) {
      member = await GroupMember.findOne({ id_groupe: groupObjId });
    }

    if (!member) {
      throw new AppError('Membre introuvable pour ce groupe.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.MEMBER_NOT_FOUND);
    }

    // D. Création et validation automatique immédiate de la transaction
    const newTransaction = await Transaction.create({
      id_membre_groupe: member._id,
      type: 'depot',
      montant: officialAmount,
      moyen_paiement: provider === 'Wave' ? 'Wave' : 'MTN_Money',
      numero_tx_operateur: transactionIdOperator.trim(),
      statut: 'confirme', // Validation automatique par l'API
      synced_at: new Date()
    });

    // E. Remise à zéro des retards
    member.retards_consecutifs = 0;
    await member.save();

    // F. Notification Push et Socket.IO temps réel
    const user = await User.findById(member.id_utilisateur);
    if (user) {
      await Notification.create({
        id_utilisateur: user._id,
        id_groupe: groupObjId,
        type: 'validation',
        message: `Votre cotisation de ${officialAmount.toLocaleString('fr-FR')} FCFA (${provider}) a été validée automatiquement par le système.`
      });

      socketManager.broadcastPaymentValidated(groupId, {
        ...newTransaction.toJSON(),
        nom: user.nom,
        prenom: user.prenom
      });
      socketManager.broadcastNotification(user._id.toString(), {
        type: 'validation',
        message: `Votre paiement de ${officialAmount.toLocaleString('fr-FR')} FCFA a été validé avec succès en direct !`
      });
    }

    console.log(`✅ [Webhook ${provider}] Cotisation de ${officialAmount} FCFA validée automatiquement avec succès.`);
    return { success: true, transaction: newTransaction };
  }
}

export const paymentGatewayService = new PaymentGatewayService();
