import { Cycle, Tour, Group, GroupMember, Transaction, Notification } from '../models';
import { AppError } from '../middlewares/errorHandler';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';
import { socketManager } from './socketManager';
import mongoose from 'mongoose';

const getIntervalDays = (periodicite: string): number => {
  switch (periodicite) {
    case '1semaine': return 7;
    case '2semaines': return 14;
    case '1mois': return 30;
    case '2mois': return 60;
    default: return 30;
  }
};

/**
 * Définir l'ordre de passage des membres pour un cycle (RF-09, RF-10)
 */
export const setTourOrderForCycle = async (
  cycleId: string,
  orders: { id_membre_groupe: string; ordre_passage: number }[]
) => {
  const cycleObjId = new mongoose.Types.ObjectId(cycleId);
  const cycle = await Cycle.findById(cycleObjId);

  if (!cycle) {
    throw new AppError('Cycle introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.CYCLE_NOT_FOUND);
  }

  const group = await Group.findById(cycle.id_groupe);
  const intervalDays = getIntervalDays(group?.periodicite || '1mois');
  const baseDate = new Date(cycle.date_debut);

  // Supprimer les anciens tours en attente pour ce cycle
  await Tour.deleteMany({ id_cycle: cycleObjId, statut: 'en_attente' });

  const createdTours = [];

  for (const item of orders) {
    const tourDate = new Date(baseDate);
    tourDate.setDate(tourDate.getDate() + (item.ordre_passage - 1) * intervalDays);

    const tour = await Tour.create({
      id_cycle: cycleObjId,
      id_membre_groupe: new mongoose.Types.ObjectId(item.id_membre_groupe),
      ordre_passage: item.ordre_passage,
      date_prevue: tourDate,
      statut: 'en_attente'
    });
    createdTours.push(tour);
  }

  return createdTours;
};

/**
 * Confirmer le versement de la cagnotte au bénéficiaire par l'administrateur (RF-11)
 */
export const confirmTourDistribution = async (
  tourId: string,
  adminUserId: string,
  montant: number,
  captureUrl?: string
) => {
  const tourObjId = new mongoose.Types.ObjectId(tourId);
  const tour = await Tour.findById(tourObjId);

  if (!tour) {
    throw new AppError('Tour introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.TOUR_NOT_FOUND);
  }

  if (tour.statut === 'distribue') {
    throw new AppError('Ce tour a déjà été marqué comme distribué.', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.TRANSACTION_ALREADY_PROCESSED);
  }

  const cycle = await Cycle.findById(tour.id_cycle);
  const member = await GroupMember.findById(tour.id_membre_groupe);

  // 1. Mettre à jour le statut du tour
  tour.statut = 'distribue';
  await tour.save();

  // 2. Créer la transaction de retrait (distribution de cagnotte)
  await Transaction.create({
    id_membre_groupe: tour.id_membre_groupe,
    id_tour: tour._id,
    type: 'retrait',
    montant,
    moyen_paiement: 'MTN_Money',
    numero_tx_operateur: `DISTRIB-${Date.now()}-${tour.ordre_passage}`,
    preuve_capture_url: captureUrl || null,
    statut: 'confirme',
    id_validateur: new mongoose.Types.ObjectId(adminUserId)
  });

  // 3. Notifier le bénéficiaire (RF-11)
  if (member && cycle) {
    await Notification.create({
      id_utilisateur: member.id_utilisateur,
      id_groupe: cycle.id_groupe,
      type: 'distribution',
      message: `Félicitations ! Votre cagnotte de ${montant.toLocaleString('fr-FR')} FCFA pour le tour n°${tour.ordre_passage} a été distribuée.`
    });

    // Diffusion temps réel Socket.IO
    socketManager.broadcastTourDistributed(cycle.id_groupe.toString(), tour.toJSON());
    socketManager.broadcastNotification(member.id_utilisateur.toString(), {
      type: 'distribution',
      message: `Félicitations ! Votre cagnotte de ${montant.toLocaleString('fr-FR')} FCFA a été distribuée.`
    });
  }

  return tour;
};

/**
 * Vérification d'éligibilité du bénéficiaire : cotisation 100% obligatoire (RF-13)
 * Si incomplète, saute le tour (skip) et reporte le crédit sur le cycle suivant.
 */
export const evaluateTourEligibility = async (tourId: string) => {
  const tourObjId = new mongoose.Types.ObjectId(tourId);
  const tour = await Tour.findById(tourObjId);

  if (!tour) throw new AppError('Tour introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.TOUR_NOT_FOUND);

  const cycle = await Cycle.findById(tour.id_cycle);
  const member = await GroupMember.findById(tour.id_membre_groupe);

  if (!cycle || !member) throw new AppError('Données de tour incomplètes.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.TOUR_NOT_FOUND);

  const deposits = await Transaction.find({
    id_membre_groupe: member._id,
    statut: 'confirme',
    type: 'depot'
  });

  const totalCotise = deposits.reduce((acc, t) => acc + t.montant, 0);
  const montantRequis = cycle.montant_cotisation;

  // Si le membre n'a pas cotisé 100%
  if (totalCotise < montantRequis) {
    tour.statut = 'saute';
    await tour.save();

    member.credit_reporte = totalCotise;
    await member.save();

    await Notification.create({
      id_utilisateur: member.id_utilisateur,
      id_groupe: cycle.id_groupe,
      type: 'rappel_cotisation',
      message: `Votre tour de cagnotte a été sauté pour cotisation incomplète (${totalCotise}/${montantRequis} FCFA). Vos versements sont reportés en crédit.`
    });

    return { eligible: false, message: 'Membre inéligible : tour sauté et solde reporté.' };
  }

  return { eligible: true, totalCotise };
};

/**
 * Réorganisation automatique et inversion de l'ordre à la fin d'un cycle (RF-14)
 */
export const checkAndCompleteCycle = async (cycleId: string, newAmount?: number) => {
  const cycleObjId = new mongoose.Types.ObjectId(cycleId);
  const cycle = await Cycle.findById(cycleObjId);

  if (!cycle) throw new AppError('Cycle introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.CYCLE_NOT_FOUND);

  const tours = await Tour.find({ id_cycle: cycleObjId }).sort({ ordre_passage: 1 });

  // Vérifier si tous les tours sont passés (distribué ou sauté)
  const remainingTours = tours.filter((t) => t.statut === 'en_attente');
  if (remainingTours.length > 0) {
    return { completed: false, remaining: remainingTours.length };
  }

  // 1. Clôturer le cycle actuel
  cycle.statut = 'termine';
  cycle.date_fin = new Date();
  await cycle.save();

  // 2. Créer le nouveau cycle
  const nextAmount = newAmount || cycle.montant_cotisation;
  const newCycle = await Cycle.create({
    id_groupe: cycle.id_groupe,
    numero_cycle: cycle.numero_cycle + 1,
    montant_cotisation: nextAmount,
    statut: 'en_cours'
  });

  // 3. Inversion de l'ordre de passage (1->N devient N->1) (RF-14)
  const reversedTours = [...tours].reverse();
  const group = await Group.findById(cycle.id_groupe);
  const intervalDays = getIntervalDays(group?.periodicite || '1mois');
  const baseDate = new Date();

  for (let i = 0; i < reversedTours.length; i++) {
    const tourDate = new Date(baseDate);
    tourDate.setDate(tourDate.getDate() + i * intervalDays);

    await Tour.create({
      id_cycle: newCycle._id,
      id_membre_groupe: reversedTours[i].id_membre_groupe,
      ordre_passage: i + 1,
      date_prevue: tourDate,
      statut: 'en_attente'
    });
  }

  // Diffusion temps réel Socket.IO
  socketManager.broadcastCycleCompleted(cycle.id_groupe.toString(), newCycle.toJSON());

  return { completed: true, newCycle };
};
