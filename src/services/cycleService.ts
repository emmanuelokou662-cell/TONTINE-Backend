import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/errorHandler';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';

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
  const cycle = await prisma.cycle.findUnique({
    where: { id_cycle: cycleId },
    include: { groupe: true }
  });

  if (!cycle) {
    throw new AppError('Cycle introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.CYCLE_NOT_FOUND);
  }

  const intervalDays = getIntervalDays(cycle.groupe.periodicite);
  const baseDate = new Date(cycle.date_debut);

  return prisma.$transaction(async (tx) => {
    // Supprimer les anciens tours en attente pour ce cycle
    await tx.tour.deleteMany({
      where: { id_cycle: cycleId, statut: 'en_attente' }
    });

    const createdTours = [];

    for (const item of orders) {
      const tourDate = new Date(baseDate);
      tourDate.setDate(tourDate.getDate() + (item.ordre_passage - 1) * intervalDays);

      const tour = await tx.tour.create({
        data: {
          id_cycle: cycleId,
          id_membre_groupe: item.id_membre_groupe,
          ordre_passage: item.ordre_passage,
          date_prevue: tourDate,
          statut: 'en_attente'
        }
      });
      createdTours.push(tour);
    }

    return createdTours;
  });
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
  const tour = await prisma.tour.findUnique({
    where: { id_tour: tourId },
    include: {
      cycle: { include: { groupe: true } },
      membre_groupe: { include: { utilisateur: true } }
    }
  });

  if (!tour) {
    throw new AppError('Tour introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.TOUR_NOT_FOUND);
  }

  if (tour.statut === 'distribue') {
    throw new AppError('Ce tour a déjà été marqué comme distribué.', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.TRANSACTION_ALREADY_PROCESSED);
  }

  return prisma.$transaction(async (tx) => {
    // 1. Mettre à jour le statut du tour
    const updatedTour = await tx.tour.update({
      where: { id_tour: tourId },
      data: { statut: 'distribue' }
    });

    // 2. Créer la transaction de retrait (distribution de cagnotte)
    await tx.transaction.create({
      data: {
        id_membre_groupe: tour.id_membre_groupe,
        id_tour: tourId,
        type: 'retrait',
        montant,
        moyen_paiement: 'MTN_Money', // Standard opérateur
        numero_tx_operateur: `DISTRIB-${Date.now()}-${tour.ordre_passage}`,
        preuve_capture_url: captureUrl,
        statut: 'confirme',
        id_validateur: adminUserId
      }
    });

    // 3. Notifier le bénéficiaire (RF-11)
    await tx.notification.create({
      data: {
        id_utilisateur: tour.membre_groupe.id_utilisateur,
        id_groupe: tour.cycle.id_groupe,
        type: 'distribution',
        message: `Félicitations ! Votre cagnotte de ${montant.toLocaleString('fr-FR')} FCFA pour le tour n°${tour.ordre_passage} a été distribuée.`
      }
    });

    return updatedTour;
  });
};

/**
 * Vérification d'éligibilité du bénéficiaire : cotisation 100% obligatoire (RF-13)
 * Si incomplète, saute le tour (skip) et reporte le crédit sur le cycle suivant.
 */
export const evaluateTourEligibility = async (tourId: string) => {
  const tour = await prisma.tour.findUnique({
    where: { id_tour: tourId },
    include: {
      cycle: true,
      membre_groupe: {
        include: {
          utilisateur: true,
          transactions: {
            where: {
              statut: 'confirme',
              type: 'depot'
            }
          }
        }
      }
    }
  });

  if (!tour) throw new AppError('Tour introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.TOUR_NOT_FOUND);

  const totalCotise = tour.membre_groupe.transactions.reduce((acc, t) => acc + t.montant, 0);
  const montantRequis = tour.cycle.montant_cotisation;

  // Si le membre n'a pas cotisé 100%
  if (totalCotise < montantRequis) {
    await prisma.$transaction([
      prisma.tour.update({
        where: { id_tour: tourId },
        data: { statut: 'saute' }
      }),
      prisma.membreGroupe.update({
        where: { id: tour.id_membre_groupe },
        data: { credit_reporte: totalCotise }
      }),
      prisma.notification.create({
        data: {
          id_utilisateur: tour.membre_groupe.id_utilisateur,
          id_groupe: tour.cycle.id_groupe,
          type: 'rappel_cotisation',
          message: `Votre tour de cagnotte a été sauté pour cotisation incomplète (${totalCotise}/${montantRequis} FCFA). Vos versements sont reportés en crédit.`
        }
      })
    ]);
    return { eligible: false, message: 'Membre inéligible : tour sauté et solde reporté.' };
  }

  return { eligible: true, totalCotise };
};

/**
 * Réorganisation automatique et inversion de l'ordre à la fin d'un cycle (RF-14)
 */
export const checkAndCompleteCycle = async (cycleId: string, newAmount?: number) => {
  const cycle = await prisma.cycle.findUnique({
    where: { id_cycle: cycleId },
    include: {
      tours: { orderBy: { ordre_passage: 'asc' } },
      groupe: true
    }
  });

  if (!cycle) throw new AppError('Cycle introuvable.', HTTP_STATUS.NOT_FOUND, ERROR_CODES.CYCLE_NOT_FOUND);

  // Vérifier si tous les tours sont passés (distribué ou sauté)
  const remainingTours = cycle.tours.filter((t) => t.statut === 'en_attente');
  if (remainingTours.length > 0) {
    return { completed: false, remaining: remainingTours.length };
  }

  return prisma.$transaction(async (tx) => {
    // 1. Clôturer le cycle actuel
    await tx.cycle.update({
      where: { id_cycle: cycleId },
      data: { statut: 'termine', date_fin: new Date() }
    });

    // 2. Créer le nouveau cycle
    const nextAmount = newAmount || cycle.montant_cotisation;
    const newCycle = await tx.cycle.create({
      data: {
        id_groupe: cycle.id_groupe,
        numero_cycle: cycle.numero_cycle + 1,
        montant_cotisation: nextAmount,
        statut: 'en_cours'
      }
    });

    // 3. Inversion de l'ordre de passage (1->N devient N->1) (RF-14)
    const reversedTours = [...cycle.tours].reverse();
    const intervalDays = getIntervalDays(cycle.groupe.periodicite);
    const baseDate = new Date();

    for (let i = 0; i < reversedTours.length; i++) {
      const tourDate = new Date(baseDate);
      tourDate.setDate(tourDate.getDate() + i * intervalDays);

      await tx.tour.create({
        data: {
          id_cycle: newCycle.id_cycle,
          id_membre_groupe: reversedTours[i].id_membre_groupe,
          ordre_passage: i + 1,
          date_prevue: tourDate,
          statut: 'en_attente'
        }
      });
    }

    return { completed: true, newCycle };
  });
};
