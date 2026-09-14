import cron from 'node-cron';
import { Tour, Cycle, Group, GroupMember, Transaction } from '../models';
import { sendPushToUser } from '../services/pushNotificationService';

/**
 * Automatismes de rappels de cotisation et de relances de distribution (RF-12, RF-17)
 * S'exécute chaque matin à 08h00
 */
export const startScheduledJobs = () => {
  cron.schedule('0 8 * * *', async () => {
    console.log('⏰ [CRON] Exécution des vérifications quotidiennes des échéances...');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    try {
      // 1. Rappels de cotisation : J-3, Jour J et J+2 (RF-17)
      const upcomingTours = await Tour.find({ statut: 'en_attente' });

      for (const tour of upcomingTours) {
        const cycle = await Cycle.findById(tour.id_cycle);
        if (!cycle) continue;

        const group = await Group.findById(cycle.id_groupe);
        if (!group) continue;

        const member = await GroupMember.findById(tour.id_membre_groupe);
        if (!member) continue;

        const tourDate = new Date(tour.date_prevue);
        const tourDay = new Date(tourDate.getFullYear(), tourDate.getMonth(), tourDate.getDate());
        const diffDays = Math.round((tourDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        const deposits = await Transaction.find({
          id_membre_groupe: member._id,
          statut: 'confirme',
          type: 'depot'
        });

        const totalCotise = deposits.reduce((acc, t) => acc + t.montant, 0);
        const isUpToDate = totalCotise >= cycle.montant_cotisation;

        if (!isUpToDate) {
          // Rappel J-3 (3 jours avant l'échéance)
          if (diffDays === 3) {
            await sendPushToUser(member.id_utilisateur.toString(), {
              title: `Rappel Cotisation — ${group.nom_groupe}`,
              body: `Votre tour de cotisation approche dans 3 jours (${cycle.montant_cotisation.toLocaleString('fr-FR')} FCFA).`
            });
          }

          // Rappel Jour J (le jour de l'échéance)
          if (diffDays === 0) {
            await sendPushToUser(member.id_utilisateur.toString(), {
              title: `Échéance aujourd'hui — ${group.nom_groupe}`,
              body: `N'oubliez pas d'effectuer votre versement Mobile Money et de le déclarer sur l'application.`
            });
          }

          // Relance J+2 (2 jours de retard)
          if (diffDays === -2) {
            await sendPushToUser(member.id_utilisateur.toString(), {
              title: `Retard de cotisation — ${group.nom_groupe}`,
              body: `Votre cotisation est en retard de 2 jours. Merci de régulariser pour éviter un signalement.`
            });
          }
        }

        // 2. Relance à l'administrateur en cas de retard de distribution (RF-12, J+1 après la date prévue)
        if (diffDays === -1 && tour.statut === 'en_attente') {
          await sendPushToUser(group.id_admin_principal.toString(), {
            title: `Rappel Distribution — ${group.nom_groupe}`,
            body: `Le tour n°${tour.ordre_passage} était prévu hier. Veuillez confirmer le versement de la cagnotte au bénéficiaire.`
          });
        }
      }
    } catch (error) {
      console.error('Erreur lors de l\'exécution du job cron de rappels :', error);
    }
  });

  console.log('✅ Service des tâches planifiées (Cron Rappels) démarré avec succès.');
};
