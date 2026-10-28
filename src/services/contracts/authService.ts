import type { Membre, Utilisateur, UUID } from '../../models';
import type { Result } from './result';

/**
 * Contrat d'authentification du MEMBRE (Supabase Auth).
 *
 * Seuls les comptes `role = 'MEMBRE'` utilisent l'application mobile
 * (l'agent et l'administrateur travaillent hors mobile).
 *
 * Règle métier 10 : si `doit_changer_mot_de_passe = true`, l'application doit
 * forcer l'écran de changement de mot de passe avant tout autre accès.
 */
export interface AuthService {
  /** Connexion par e-mail + mot de passe. */
  connecter(entree: ConnexionEntree): Promise<Result<SessionMembre>>;

  /** Déconnexion (retour au parcours public, sans menu). */
  deconnecter(): Promise<Result<void>>;

  /** Session en cours (restaurée au démarrage), `null` si non connecté. */
  obtenirSession(): Promise<Result<SessionMembre | null>>;

  /**
   * Demande de réinitialisation : la réponse ne doit JAMAIS révéler si le
   * compte existe (message identique dans tous les cas).
   */
  demanderReinitialisationMotDePasse(entree: { email: string }): Promise<Result<void>>;

  /**
   * Changement de mot de passe (obligatoire à la première connexion).
   * Le nouveau mot de passe doit respecter la politique renvoyée par
   * `REGLES_MOT_DE_PASSE`.
   */
  changerMotDePasse(entree: ChangerMotDePasseEntree): Promise<Result<SessionMembre>>;

  /**
   * Écoute les changements de session (expiration, déconnexion distante,
   * rafraîchissement de jeton). Renvoie la fonction de désabonnement.
   */
  ecouterSession(rappel: (session: SessionMembre | null) => void): () => void;
}

export type ConnexionEntree = {
  email: string;
  mot_de_passe: string;
};

export type ChangerMotDePasseEntree = {
  mot_de_passe_actuel: string;
  nouveau_mot_de_passe: string;
  confirmation_mot_de_passe: string;
};

/** Session applicative d'un membre connecté. */
export type SessionMembre = {
  utilisateur: Utilisateur;
  /** Profil adhérent (`null` tant que l'adhésion n'est pas finalisée). */
  membre: Membre | null;
  /** Raccourci de `utilisateur.doit_changer_mot_de_passe`. */
  doit_changer_mot_de_passe: boolean;
  jeton_acces: string;
  expire_at: string;
};

/** Politique de mot de passe affichée à l'utilisateur. */
export const REGLES_MOT_DE_PASSE = {
  longueur_min: 8,
  longueur_max: 72,
  exige_minuscule: true,
  exige_majuscule: true,
  exige_chiffre: true,
  exige_symbole: false,
} as const;

/** Codes stables des refus métier de l'authentification (messages distincts dans l'UI). */
export const CODES_ERREUR_AUTH = {
  IDENTIFIANTS_INVALIDES: 'IDENTIFIANTS_INVALIDES',
  COMPTE_DESACTIVE: 'COMPTE_DESACTIVE',
  EMAIL_NON_CONFIRME: 'EMAIL_NON_CONFIRME',
  TROP_DE_TENTATIVES: 'TROP_DE_TENTATIVES',
  SESSION_EXPIREE: 'SESSION_EXPIREE',
  MOT_DE_PASSE_FAIBLE: 'MOT_DE_PASSE_FAIBLE',
  MOT_DE_PASSE_IDENTIQUE: 'MOT_DE_PASSE_IDENTIQUE',
  CONFIRMATION_DIFFERENTE: 'CONFIRMATION_DIFFERENTE',
} as const;

export type CodeErreurAuth = (typeof CODES_ERREUR_AUTH)[keyof typeof CODES_ERREUR_AUTH];

/** Identifiant de membre (rappel de type pour les implémentations). */
export type MembreId = UUID;
