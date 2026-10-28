import type {
  CodeDevise,
  DateISO,
  HorodatageISO,
  ModePaiement,
  MontantAriary,
  OperateurMobileMoney,
  OperateurPaiement,
  StatutDemande,
  StatutPaiement,
  TypePaiement,
  TypePiece,
  UUID,
} from '../../models';
import type { Result } from './result';
import type {
  FichierDepose,
  FichierTeleverse,
  OptionsTeleversement,
  TeleversementEntree,
} from './televersement';

/**
 * Contrat de l'API REST Express consommée par le CANDIDAT (utilisateur sans compte).
 *
 * Le candidat n'accède jamais directement à la base : tout passe par ces
 * opérations. Le contrat est implémenté par `HttpCandidateApi`, branché sur l'API
 * via `EXPO_PUBLIC_API_BASE_URL`
 * (cf. `docs/API_CANDIDAT.md` pour la correspondance HTTP).
 */

/* ------------------------------------------------------- Identité et dossier */

/** Identité saisie à l'étape 1 du parcours d'adhésion. */
export type IdentiteCandidatEntree = {
  nom: string;
  prenom: string;
  /** Format `AAAA-MM-JJ` ; le serveur refuse les moins de 15 ans. */
  date_naissance: DateISO;
  cin: string;
  /** Numéro au format international (+261…). */
  telephone: string;
  email: string;
  adresse: string;
};

/** Pièce du dossier, typée selon `type_piece`. */
export type PieceEntree = FichierDepose & {
  type: TypePiece;
};

/**
 * Œuvre du dossier d'adhésion.
 * Règle métier 8 : au moins 2 œuvres et 1 attestation de diffusion par œuvre.
 */
export type OeuvreAdhesionEntree = {
  titre: string;
  categorie_id: UUID;
  description?: string | null;
  annee?: number | null;
  fichier: FichierDepose;
  attestations: FichierDepose[];
};

export type CreerDemandeEntree = {
  identite: IdentiteCandidatEntree;
  categorie_id: UUID;
};

/** Demande à l'état `BROUILLON` (reprise possible via numéro + code). */
export type DemandeBrouillon = {
  demande_id: UUID;
  numero_dossier: string;
  /** Code de suivi en clair (communiqué au candidat lors de la création). */
  code_suivi: string;
  statut: StatutDemande;
  created_at: HorodatageISO;
};

export type MettreAJourDemandeEntree = {
  identite?: Partial<IdentiteCandidatEntree>;
  categorie_id?: UUID;
};

/** Envoi du dossier complet : aucun paiement n'est demandé à ce stade. */
export type SoumettreDemandeEntree = {
  numero_dossier: string;
  code_suivi: string;
  categorie_id: UUID;
  pieces: PieceEntree[];
  oeuvres: OeuvreAdhesionEntree[];
};

/** Écran L : informations à conserver par le candidat. */
export type ConfirmationEnvoiDemande = {
  numero_dossier: string;
  code_suivi: string;
  statut: StatutDemande;
  date_soumission: HorodatageISO;
  /** Délai indicatif communiqué au candidat (72 heures). */
  delai_indicatif_heures: number;
};

/* -------------------------------------------------------------------- Suivi */

export type SuiviDemandeEntree = {
  numero_dossier: string;
  code_suivi: string;
};

/** Étape de la frise de suivi (calculée par le serveur). */
export type EtapeSuivi = {
  statut: StatutDemande;
  libelle: string;
  realisee: boolean;
  date: HorodatageISO | null;
};

/** Montant dû, fourni par le serveur (jamais calculé dans l'UI). */
export type MontantPaiementDu = {
  type: TypePaiement;
  montant: MontantAriary;
  devise: CodeDevise;
};

export type SuiviDemande = {
  numero_dossier: string;
  statut: StatutDemande;
  derniere_mise_a_jour: HorodatageISO;
  etapes: EtapeSuivi[];
  /** Obligatoire si `statut = 'REJETEE'` (motif communiqué au candidat). */
  motif_rejet: string | null;
  /** Renseigné uniquement lorsque le paiement est possible (`statut = 'VALIDEE'`). */
  paiement_du: MontantPaiementDu | null;
};

/* ----------------------------------------------------------------- Paiement */

export type OptionsPaiementCandidat = {
  paiement_du: MontantPaiementDu;
  /**
   * Modes proposés par le serveur : le seul mode de l'application est
   * `MOBILE_MONEY` (MVola).
   */
  modes: ModePaiementDisponible[];
};

export type ModePaiementDisponible = {
  mode: ModePaiement;
  libelle: string;
  /** Opérateurs ACTIFS uniquement : un opérateur désactivé est absent. */
  operateurs: OperateurMobileMoney[];
};

export type InitierPaiementEntree = {
  numero_dossier: string;
  code_suivi: string;
  mode: ModePaiement;
  /** Obligatoire si `mode = 'MOBILE_MONEY'`. */
  operateur?: OperateurPaiement | null;
  /** Numéro au format +261 (Mobile Money). */
  numero_telephone?: string | null;
};

/**
 * État d'un paiement vu par le candidat.
 * ⚠️ `statut = 'REUSSI'` est la seule confirmation de succès : elle provient
 * exclusivement du serveur (polling via `obtenirEtatPaiement`).
 */
export type EtatPaiementCandidat = {
  paiement_id: UUID;
  reference_interne: string;
  reference_externe: string | null;
  type: TypePaiement;
  montant: MontantAriary;
  devise: CodeDevise;
  mode: ModePaiement;
  operateur: OperateurPaiement | null;
  statut: StatutPaiement;
  motif_echec: string | null;
  date_initiation: HorodatageISO;
  date_confirmation: HorodatageISO | null;
  /** Instruction à afficher (ex. « Validez la demande sur votre téléphone »). */
  instruction: string | null;
};

/* -------------------------------------------------------------- Téléversement */
/* Types communs : cf. `./televersement` (`TeleversementEntree`, `FichierDepose`, …). */

/* ----------------------------------------------------------------- Contrat */

export interface CandidateApi {
  /** Crée un dossier à l'état `BROUILLON` (reprise possible via numéro + code). */
  creerDemande(entree: CreerDemandeEntree): Promise<Result<DemandeBrouillon>>;

  /** Met à jour un brouillon (identité, catégorie). */
  mettreAJourDemande(
    numero_dossier: string,
    code_suivi: string,
    entree: MettreAJourDemandeEntree,
  ): Promise<Result<DemandeBrouillon>>;

  /** Envoie le dossier complet : statut `ENVOYEE`, délai indicatif 72 h, aucun paiement. */
  soumettreDemande(entree: SoumettreDemandeEntree): Promise<Result<ConfirmationEnvoiDemande>>;

  /** Téléverse un fichier (pièce, œuvre, attestation) avec progression. */
  televerserFichier(
    entree: TeleversementEntree,
    options?: OptionsTeleversement,
  ): Promise<Result<FichierTeleverse>>;

  /** Suivi public : numéro de dossier + code de suivi. */
  suivreDemande(entree: SuiviDemandeEntree): Promise<Result<SuiviDemande>>;

  /** Modes et moyens réellement disponibles pour ce dossier (liste dynamique). */
  obtenirOptionsPaiement(entree: SuiviDemandeEntree): Promise<Result<OptionsPaiementCandidat>>;

  /** Initie un paiement (aucun succès annoncé avant confirmation serveur). */
  initierPaiement(entree: InitierPaiementEntree): Promise<Result<EtatPaiementCandidat>>;

  /** Polling du statut : `REUSSI` n'est renvoyé que si le serveur l'a confirmé. */
  obtenirEtatPaiement(reference_interne: string): Promise<Result<EtatPaiementCandidat>>;
}

/* -------------------------------------------------------- Codes d'erreur métier */

/** Codes stables renvoyés par l'API candidat dans `ErreurMetier.code`. */
export const CODES_ERREUR_CANDIDAT = {
  DEMANDE_INTROUVABLE: 'DEMANDE_INTROUVABLE',
  CODE_SUIVI_INVALIDE: 'CODE_SUIVI_INVALIDE',
  DEMANDE_NON_VALIDEE: 'DEMANDE_NON_VALIDEE',
  DOSSIER_INCOMPLET: 'DOSSIER_INCOMPLET',
  AGE_INSUFFISANT: 'AGE_INSUFFISANT',
  AUTORISATION_PARENTALE_REQUISE: 'AUTORISATION_PARENTALE_REQUISE',
  OPERATEUR_INDISPONIBLE: 'OPERATEUR_INDISPONIBLE',
  PAIEMENT_DEJA_REUSSI: 'PAIEMENT_DEJA_REUSSI',
  FICHIER_TROP_VOLUMINEUX: 'FICHIER_TROP_VOLUMINEUX',
  TYPE_FICHIER_NON_AUTORISE: 'TYPE_FICHIER_NON_AUTORISE',
} as const;

export type CodeErreurCandidat =
  (typeof CODES_ERREUR_CANDIDAT)[keyof typeof CODES_ERREUR_CANDIDAT];

