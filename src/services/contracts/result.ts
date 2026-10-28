/**
 * Type `Result` standard de la couche data.
 *
 * Toutes les opérations des services et repositories renvoient un `Result` :
 * aucune exception ne remonte à l'UI, qui distingue trois familles d'erreurs :
 * - `reseau`  : appareil hors ligne, DNS, timeout → « Vérifiez votre connexion puis réessayez. »
 * - `serveur` : 5xx, réponse inattendue/invalide → « Service momentanément indisponible. »
 * - `metier`  : refus explicite du serveur avec un code + message (ex. `DEMANDE_NON_VALIDEE`).
 */

export type Result<T> = ResultOk<T> | ResultErr;

export type ResultOk<T> = {
  ok: true;
  valeur: T;
};

export type ResultErr = {
  ok: false;
  erreur: ErreurApp;
};

export type TypeErreur = 'reseau' | 'serveur' | 'metier';

/** Panne de transport : aucune réponse exploitable du serveur. */
export type ErreurReseau = {
  type: 'reseau';
  message: string;
  /** Détail technique facultatif (ex. « délai dépassé après 15 s »). */
  cause?: string;
};

/** Réponse serveur en erreur ou inexploitable (5xx, JSON invalide, contrat rompu). */
export type ErreurServeur = {
  type: 'serveur';
  message: string;
  statut_http?: number;
  /** Identifiant de corrélation renvoyé par le serveur (utile au support). */
  reference?: string;
};

/**
 * Refus métier : le serveur a compris la demande mais la refuse.
 * `code` est stable et destiné au code (jamais affiché tel quel à l'utilisateur),
 * `message` est rédigé en français (vouvoiement) et affichable.
 */
export type ErreurMetier = {
  type: 'metier';
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type ErreurApp = ErreurReseau | ErreurServeur | ErreurMetier;

/** Messages par défaut des erreurs techniques (vouvoiement). */
export const MESSAGES_ERREUR_TECHNIQUE = {
  reseau: 'Impossible de joindre le serveur. Vérifiez votre connexion internet puis réessayez.',
  serveur: 'Le service est momentanément indisponible. Veuillez réessayer dans un instant.',
} as const;

/* ------------------------------------------------------------ Constructeurs */

export function ok<T>(valeur: T): ResultOk<T> {
  return { ok: true, valeur };
}

export function erreurReseau(cause?: string, message = MESSAGES_ERREUR_TECHNIQUE.reseau): ResultErr {
  return { ok: false, erreur: { type: 'reseau', message, cause } };
}

export function erreurServeur(
  options: { statut_http?: number; reference?: string; message?: string } = {},
): ResultErr {
  return {
    ok: false,
    erreur: {
      type: 'serveur',
      message: options.message ?? MESSAGES_ERREUR_TECHNIQUE.serveur,
      statut_http: options.statut_http,
      reference: options.reference,
    },
  };
}

export function erreurMetier(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ResultErr {
  return { ok: false, erreur: { type: 'metier', code, message, details } };
}

/* ------------------------------------------------------------------ Gardes */

export function estOk<T>(resultat: Result<T>): resultat is ResultOk<T> {
  return resultat.ok;
}

export function estErreur<T>(resultat: Result<T>): resultat is ResultErr {
  return !resultat.ok;
}

/** Vrai si l'erreur est un refus métier portant ce code précis. */
export function estErreurMetier(resultat: ResultErr, code: string): boolean {
  return resultat.erreur.type === 'metier' && resultat.erreur.code === code;
}
