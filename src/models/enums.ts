/**
 * Types énumérés PostgreSQL (`docs/SCHEMA_DB.md`).
 *
 * Chaque ENUM est déclaré sous forme de constante `as const` : le tableau sert
 * de source unique et le type union en est dérivé. Aucune valeur n'est écrite
 * en dur ailleurs (ni dans les services, ni dans l'UI).
 *
 * ⚠️ Rappel métier : `REUSSI` (`StatutPaiement`) est la SEULE confirmation de
 * succès d'un paiement ; une validation (`VALIDEE`) ne fait pas d'un candidat
 * un membre.
 */

/* ---------------------------------------------------------------- Utilisateurs */

export const ROLES_UTILISATEUR = ['MEMBRE', 'AGENT', 'ADMINISTRATEUR'] as const;
export type RoleUtilisateur = (typeof ROLES_UTILISATEUR)[number];

export const STATUTS_UTILISATEUR = ['ACTIF', 'DESACTIVE', 'EN_ATTENTE_CHANGEMENT_MDP'] as const;
export type StatutUtilisateur = (typeof STATUTS_UTILISATEUR)[number];

/**
 * Statut d'une appartenance membre ↔ catégorie (`membre_categorie.statut`).
 *
 * - `ACTIVE`     : catégorie validée, le membre en bénéficie ;
 * - `EN_ATTENTE` : demande de catégorie supplémentaire envoyée depuis
 *                  l'application (règle métier 9), en attente de la décision
 *                  d'un agent OMDA ;
 * - `INACTIVE`   : catégorie retirée par l'OMDA ;
 * - `REJETEE`    : demande refusée par un agent OMDA ;
 * - `ANNULEE`    : demande retirée par le membre tant qu'elle était `EN_ATTENTE`.
 *
 * Aucune validation n'est faite localement : l'application ne fait JAMAIS passer
 * une demande à `ACTIVE` — seul le serveur (décision d'un agent OMDA) décide.
 * Une appartenance `ANNULEE` ou `REJETEE` reste réouvrable : le membre peut
 * redéposer une demande pour la même catégorie.
 */
export const STATUTS_ADHESION_CATEGORIE = [
  'ACTIVE',
  'EN_ATTENTE',
  'INACTIVE',
  'REJETEE',
  'ANNULEE',
] as const;
export type StatutAdhesionCategorie = (typeof STATUTS_ADHESION_CATEGORIE)[number];

/* ------------------------------------------------------------------- Demandes */

export const STATUTS_DEMANDE = [
  'BROUILLON',
  'ENVOYEE',
  'EN_COURS_DE_VERIFICATION',
  'VALIDEE',
  'REJETEE',
  'ADHESION_TERMINEE',
] as const;
export type StatutDemande = (typeof STATUTS_DEMANDE)[number];

export const TYPES_PIECE = [
  'PHOTO',
  'CIN',
  'ACTE_NAISSANCE',
  'CERTIFICAT_RESIDENCE',
  'AUTORISATION_PARENTALE',
  'AUTRE',
] as const;
export type TypePiece = (typeof TYPES_PIECE)[number];

/* -------------------------------------------------------------------- Œuvres */

export const STATUTS_OEUVRE = [
  'BROUILLON',
  'ENVOYEE',
  'EN_COURS_DE_VALIDATION',
  'VALIDEE',
  'REJETEE',
  'DEPOT_FINALISE',
] as const;
export type StatutOeuvre = (typeof STATUTS_OEUVRE)[number];

/**
 * Statuts pour lesquels le membre peut encore CORRIGER son œuvre : titre,
 * catégorie, description, année, fichier de l'œuvre et attestation de diffusion
 * (remplacement uniquement, jamais de suppression).
 *
 * Tant que l'OMDA n'a pas statué (`ENVOYEE` = en attente de prise en charge,
 * `EN_COURS_DE_VALIDATION` = examen en cours), une correction reste possible.
 * Dès `VALIDEE` (frais de dépôt à régler), `REJETEE` et `DEPOT_FINALISE`,
 * l'œuvre est figée : le membre dépose alors une NOUVELLE œuvre.
 */
export const STATUTS_OEUVRE_MODIFIABLES: readonly StatutOeuvre[] = [
  'BROUILLON',
  'ENVOYEE',
  'EN_COURS_DE_VALIDATION',
];

/* ------------------------------------------------------------------ Paiements */

export const TYPES_PAIEMENT = ['ADHESION', 'DEPOT_OEUVRE'] as const;
export type TypePaiement = (typeof TYPES_PAIEMENT)[number];

export const TYPES_OPERATION_TARIF = ['ADHESION', 'DEPOT_OEUVRE'] as const;
export type TypeOperationTarif = (typeof TYPES_OPERATION_TARIF)[number];

/** Mode unique de l'application : Mobile Money (MVola). */
export const MODES_PAIEMENT = ['MOBILE_MONEY'] as const;
export type ModePaiement = (typeof MODES_PAIEMENT)[number];

/** Opérateur unique — table `operateur_paiement` (MVola uniquement). */
export const OPERATEURS_PAIEMENT = ['MVOLA'] as const;
export type OperateurPaiement = (typeof OPERATEURS_PAIEMENT)[number];

export const STATUTS_PAIEMENT = [
  'INITIE',
  'EN_ATTENTE_CONFIRMATION',
  'REUSSI',
  'ECHEC_SOLDE_INSUFFISANT',
  'ECHEC_AUTRE',
  'REJETE',
] as const;
export type StatutPaiement = (typeof STATUTS_PAIEMENT)[number];


/* -------------------------------------------------------------- Notifications */

export const TYPES_NOTIFICATION = [
  'DEMANDE_ENVOYEE',
  'DEMANDE_VALIDEE',
  'DEMANDE_REJETEE',
  'PAIEMENT_DISPONIBLE',
  'PAIEMENT_REUSSI',
  'PAIEMENT_ECHEC',
  'OEUVRE_VALIDEE',
  'OEUVRE_REJETEE',
  'IDENTIFIANTS_ENVOYES',
  'GLOBALE',
] as const;
export type TypeNotification = (typeof TYPES_NOTIFICATION)[number];
