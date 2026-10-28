import type {
  AttestationDiffusion,
  Categorie,
  Membre,
  MembreCategorie,
  ModePaiement,
  Notification,
  Oeuvre,
  OperateurPaiement,
  Paiement,
  StatutOeuvre,
  StatutUtilisateur,
  TypeNotification,
  UUID,
  Utilisateur,
} from '../../models';
import type { Result } from './result';
import type {
  FichierDepose,
  FichierTeleverse,
  OptionsTeleversement,
  TeleversementEntree,
} from './televersement';

/**
 * Contrat d'accès aux données du MEMBRE connecté (Supabase : Auth + DB + Storage).
 *
 * Implémentation : `SupabaseMemberRepository`.
 *
 * Le membre ne peut agir que sur ses propres données : les règles RLS du
 * schéma font foi (aucun filtre de sécurité n'est délégué à l'UI).
 */
export interface MemberRepository {
  /* ------------------------------------------------------------ Profil (U) */

  /** Profil complet : utilisateur + membre + catégories actives. */
  obtenirProfil(): Promise<Result<ProfilMembre>>;

  /**
   * Catégories du membre connecté et statut de chaque appartenance
   * (`membre_categorie`), statuts `ACTIVE` / `EN_ATTENTE` / `INACTIVE`.
   * Permet notamment d'exclure les catégories déjà présentes du formulaire
   * « Demander une catégorie supplémentaire ».
   */
  listerCategoriesMembre(): Promise<Result<CategoriesMembre>>;

  /**
   * Demande l'ajout d'une catégorie supplémentaire SANS œuvres (règle métier 9).
   * L'appartenance est créée — ou rouverte après une annulation ou un refus —
   * au statut `EN_ATTENTE` : seul un agent OMDA décidera de son activation ;
   * aucune validation n'est faite localement.
   *
   * ⚠️ Le parcours de l'application passe par
   * `demanderCategorieSupplementaireAvecOeuvres` (au moins 2 œuvres, chacune
   * avec son attestation de diffusion) : cette variante simple reste offerte
   * pour les demandes sans œuvre.
   */
  demanderCategorieSupplementaire(categorie_id: UUID): Promise<Result<MembreCategorie>>;

  /**
   * Demande d'ajout d'une catégorie supplémentaire AVEC les œuvres qui
   * l'accompagnent (règle métier 9 étendue) : au moins 2 œuvres, chacune
   * accompagnée d'une attestation de diffusion.
   *
   * Effet : appartenance créée (ou rouverte) au statut `EN_ATTENTE` et œuvres
   * enregistrées côté serveur — aucun paiement, aucune activation locale.
   */
  demanderCategorieSupplementaireAvecOeuvres(
    entree: DemandeCategorieOeuvresEntree,
  ): Promise<Result<MembreCategorie>>;

  /**
   * Annule une demande de catégorie encore `EN_ATTENTE` : l'appartenance passe
   * au statut `ANNULEE` (jamais supprimée) et les œuvres jointes sont oubliées.
   * Refusée dès que la demande a été traitée par l'OMDA (`DEMANDE_NON_ANNUABLE`).
   */
  annulerDemandeCategorie(membre_categorie_id: UUID): Promise<Result<MembreCategorie>>;

  /** Met à jour les informations modifiables par le membre. */
  mettreAJourProfil(entree: MiseAJourProfilEntree): Promise<Result<ProfilMembre>>;

  /* --------------------------------------------------- Accueil membre (P) */

  /** Données de la page d'accueil : salutation, compteurs et notifications. */
  obtenirTableauDeBord(): Promise<Result<TableauDeBordMembre>>;

  /* --------------------------------------------------------- Œuvres (Q, R, S) */

  /** Liste des œuvres du membre (filtrable par statut), vide si aucune. */
  listerOeuvres(entree?: ListerOeuvresEntree): Promise<Result<Oeuvre[]>>;

  /**
   * Détail d'une œuvre (statuts, motif de rejet éventuel).
   */
  obtenirOeuvre(oeuvre_id: UUID): Promise<Result<Oeuvre>>;

  /**
   * Attestations de diffusion d'une œuvre (au moins une, règle métier 8).
   * Elles restent REMPLAÇABLES tant que l'œuvre figure dans
   * `STATUTS_OEUVRE_MODIFIABLES` : une œuvre conserve toujours son attestation
   * (aucune suppression possible), l'interface ne propose que le remplacement.
   */
  listerAttestationsOeuvre(oeuvre_id: UUID): Promise<Result<AttestationDiffusion[]>>;

  /**
   * Lien TEMPORAIRE de consultation d'un document déjà stocké : écoute dans
   * l'application (œuvre audio uniquement).
   *
   * ⚠️ `chemin_stockage` est un chemin dans un bucket PRIVÉ, jamais un lien :
   * seul le service sait le transformer en ressource accessible (URL signée côté
   * serveur ; URL signée du Storage). Aucun écran ne
   * construit ce lien lui-même.
   */
  obtenirUrlFichier(chemin_stockage: string): Promise<Result<UrlFichierConsulte>>;

  /** Crée un brouillon d'œuvre (aucun envoi, aucun paiement). */
  creerOeuvre(entree: CreerOeuvreEntree): Promise<Result<Oeuvre>>;

  /**
   * Corrige une œuvre encore modifiable (`STATUTS_OEUVRE_MODIFIABLES` :
   * `BROUILLON`, `ENVOYEE`, `EN_COURS_DE_VALIDATION`).
   *
   * Chaque champ ABSENT est conservé tel quel ; `fichier` et `attestation`
   * REMPLACENT le document déjà enregistré (jamais de suppression : le
   * remplacement est la seule façon de changer un document). Le statut, la date
   * de soumission et le motif de rejet ne sont JAMAIS touchés par cette
   * opération, qui ne déclenche aucun paiement.
   */
  mettreAJourOeuvre(oeuvre_id: UUID, entree: MettreAJourOeuvreEntree): Promise<Result<Oeuvre>>;

  /**
   * Envoie l'œuvre (statut `ENVOYEE`) avec son fichier et au moins une
   * attestation de diffusion. ⚠️ Aucun paiement n'est déclenché à l'envoi.
   */
  soumettreOeuvre(entree: SoumettreOeuvreEntree): Promise<Result<Oeuvre>>;

  /** Téléverse un fichier (bucket `oeuvres` ou `pieces`), avec progression. */
  televerserFichier(
    entree: TeleversementEntree,
    options?: OptionsTeleversement,
  ): Promise<Result<FichierTeleverse>>;

  /* --------------------------------------------------------- Paiements (S, T) */

  /**
   * Initie un paiement de dépôt d'œuvre `VALIDEE`.
   * ⚠️ Aucun succès n'est déduit localement : seul `statut = 'REUSSI'`
   * renvoyé par le serveur confirme le paiement.
   */
  initierPaiement(entree: InitierPaiementMembreEntree): Promise<Result<Paiement>>;

  /** État d'un paiement (polling côté membre). */
  obtenirPaiement(paiement_id: UUID): Promise<Result<Paiement>>;

  /* ----------------------------------------------------- Notifications (V) */

  /** Notifications du membre, les plus récentes d'abord. */
  listerNotifications(entree?: ListerNotificationsEntree): Promise<Result<Notification[]>>;

  /** Marque une notification comme lue. */
  marquerNotificationLue(notification_id: UUID): Promise<Result<Notification>>;

  /** Marque toutes les notifications comme lues (nombre mis à jour). */
  marquerToutesNotificationsLues(): Promise<Result<number>>;
}

/* ---------------------------------------------------------------------- DTO */

/** Profil du membre connecté (écran Profil). */
export type ProfilMembre = {
  utilisateur: Utilisateur;
  membre: Membre;
  /** Catégories du membre (principale + supplémentaires). */
  categories: Categorie[];
  membre_categories: MembreCategorie[];
};

/**
 * Catégories d'un membre et statut de chaque appartenance (`membre_categorie`).
 * Renvoyé par `listerCategoriesMembre()` : l'écran « Demander une catégorie »
 * en déduit les catégories déjà présentes dans le profil à exclure du choix.
 */
export type CategoriesMembre = {
  categories: Categorie[];
  membre_categories: MembreCategorie[];
};

/**
 * Œuvre jointe à une demande de catégorie supplémentaire (règle métier 9) :
 * un titre, le fichier de l'œuvre déjà téléversé (bucket `oeuvres`) et son
 * attestation de diffusion — une par œuvre, comme pour l'adhésion (règle
 * métier 8).
 */
export type OeuvreDemandeCategorieEntree = {
  titre: string;
  fichier: FichierDepose;
  attestation: FichierDepose;
};

/**
 * Payload de `demanderCategorieSupplementaireAvecOeuvres` : la catégorie visée
 * et AU MOINS 2 œuvres complètes (titre + fichier + attestation de diffusion).
 */
export type DemandeCategorieOeuvresEntree = {
  categorie_id: UUID;
  oeuvres: OeuvreDemandeCategorieEntree[];
};

/**
 * Champs modifiables par le membre.
 * Nom, prénom, CIN et date de naissance proviennent du dossier candidat :
 * ils restent en LECTURE SEULE dans l'application.
 */
export type MiseAJourProfilEntree = {
  telephone?: string | null;
};

/** Données de l'accueil membre (écran P). */
export type TableauDeBordMembre = {
  prenom: string;
  numero_adherent: string;
  statut_compte: StatutUtilisateur;
  nombre_oeuvres: number;
  notifications_non_lues: number;
};

export type ListerOeuvresEntree = {
  statut?: StatutOeuvre;
};

export type CreerOeuvreEntree = {
  titre: string;
  categorie_id: UUID;
  description?: string | null;
  annee?: number | null;
};

/**
 * Champs corrigés d'une œuvre (écran « Modifier l'œuvre »).
 * Tout champ absent est CONSERVÉ : l'appelant n'envoie que ce qui a changé.
 */
export type MettreAJourOeuvreEntree = {
  titre?: string;
  categorie_id?: UUID;
  description?: string | null;
  annee?: number | null;
  /**
   * Remplace le fichier de l'œuvre (`chemin_fichier`, `mime_type`,
   * `taille_octets`). Absent = le fichier actuel reste en place.
   */
  fichier?: FichierDepose;
  /**
   * Remplace l'attestation de diffusion (règle métier 8 : au moins une
   * attestation par œuvre, jamais supprimable). Absent = l'attestation
   * enregistrée est conservée.
   */
  attestation?: FichierDepose;
};

export type SoumettreOeuvreEntree = {
  oeuvre_id: UUID;
  fichier: FichierDepose;
  /** Au moins une attestation de diffusion (règle métier 8). */
  attestations: FichierDepose[];
};

/**
 * Lien temporaire de consultation d'un document stocké (écoute dans
 * l'application). Le chemin de stockage est un chemin de bucket privé : il ne
 * suffit pas à rendre le document consultable, d'où ce passage obligatoire par
 * le service.
 */
export type UrlFichierConsulte = {
  /** Lien à confier au lecteur audio intégré. */
  url: string;
  /** Chemin de stockage d'origine (ressource consultée). */
  chemin_stockage: string;
};

/**
 * Paiement initié par un membre : dépôt d'œuvre validée.
 * Le montant est recalculé côté service à partir du tarif officiel.
 */
export type InitierPaiementMembreEntree = {
  type: 'DEPOT_OEUVRE';
  mode: ModePaiement;
  operateur?: OperateurPaiement | null;
  /** Obligatoire si `mode = 'MOBILE_MONEY'`. */
  numero_telephone?: string | null;
  /** Obligatoire si `type = 'DEPOT_OEUVRE'` (œuvre au statut `VALIDEE`). */
  oeuvre_id?: UUID | null;
};

export type ListerNotificationsEntree = {
  non_lues_uniquement?: boolean;
  type?: TypeNotification;
};

/* -------------------------------------------------------- Codes d'erreur métier */

/** Codes stables des refus métier côté membre (`ErreurMetier.code`). */
export const CODES_ERREUR_MEMBRE = {
  NON_AUTHENTIFIE: 'NON_AUTHENTIFIE',
  OEUVRE_INTROUVABLE: 'OEUVRE_INTROUVABLE',
  OEUVRE_NON_VALIDEE: 'OEUVRE_NON_VALIDEE',
  OPERATEUR_INDISPONIBLE: 'OPERATEUR_INDISPONIBLE',
  FICHIER_TROP_VOLUMINEUX: 'FICHIER_TROP_VOLUMINEUX',
  TYPE_FICHIER_NON_AUTORISE: 'TYPE_FICHIER_NON_AUTORISE',
  FICHIER_INTROUVABLE: 'FICHIER_INTROUVABLE',
  CATEGORIE_INDISPONIBLE: 'CATEGORIE_INDISPONIBLE',
  CATEGORIE_DEJA_ENREGISTREE: 'CATEGORIE_DEJA_ENREGISTREE',
  CATEGORIE_DEJA_DEMANDEE: 'CATEGORIE_DEJA_DEMANDEE',
  DEMANDE_CATEGORIE_INTROUVABLE: 'DEMANDE_CATEGORIE_INTROUVABLE',
  DEMANDE_NON_ANNUABLE: 'DEMANDE_NON_ANNUABLE',
  OEUVRE_MINIMUM_REQUIS: 'OEUVRE_MINIMUM_REQUIS',
  OEUVRE_INCOMPLETE: 'OEUVRE_INCOMPLETE',
  ATTESTATION_MANQUANTE: 'ATTESTATION_MANQUANTE',
} as const;

export type CodeErreurMembre = (typeof CODES_ERREUR_MEMBRE)[keyof typeof CODES_ERREUR_MEMBRE];
