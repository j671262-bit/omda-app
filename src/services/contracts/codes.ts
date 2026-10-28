/**
 * Codes d'erreur métier communs à la couche data (contenus publics, paiements
 * du membre, notifications, téléversement).
 *
 * Les valeurs sont stables : les écrans s'appuient sur ces codes (jamais sur le
 * texte des messages) pour distinguer un refus métier d'une panne technique.
 */
export const CODES_ERREUR_DONNEES = {
  ARTICLE_INTROUVABLE: 'ARTICLE_INTROUVABLE',
  TARIF_INDISPONIBLE: 'TARIF_INDISPONIBLE',
  PAIEMENT_INTROUVABLE: 'PAIEMENT_INTROUVABLE',
  NOTIFICATION_INTROUVABLE: 'NOTIFICATION_INTROUVABLE',
  MODE_PAIEMENT_INVALIDE: 'MODE_PAIEMENT_INVALIDE',
  NUMERO_TELEPHONE_INVALIDE: 'NUMERO_TELEPHONE_INVALIDE',
  TELEVERSEMENT_ANNULE: 'TELEVERSEMENT_ANNULE',
} as const;

export type CodeErreurDonnees = (typeof CODES_ERREUR_DONNEES)[keyof typeof CODES_ERREUR_DONNEES];

/** Mention obligatoire accompagnant toute estimation de montant. */
export const MENTION_ESTIMATION = 'Estimation — le montant final est confirmé par le serveur.';
