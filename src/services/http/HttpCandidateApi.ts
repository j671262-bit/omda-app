/**
 * `CandidateApi` réel — API REST Express du parcours candidat (étape 19).
 *
 * Les 8 méthodes du contrat sont branchées sur l'API décrite par
 * `docs/API_CANDIDAT.md` : URL de base `EXPO_PUBLIC_API_BASE_URL`, préfixe
 * `/v1`, en-têtes `X-Numero-Dossier` / `X-Code-Suivi` / `Idempotency-Key`,
 * délai maximal de 15 s par requête JSON (120 s pour un téléversement) et
 * mapping intégral des réponses vers le type `Result` :
 * - transport absent / timeout          → `reseau` ;
 * - 5xx, corps illisible, contrat rompu → `serveur` ;
 * - 4xx portant l'enveloppe `{ code, message, details }` → `metier`.
 *
 * Garde-fous métier à la lecture (aucun écran ne peut afficher un succès ou un
 * montant non confirmés) : `REUSSI` exige `date_confirmation`, `REJETEE` exige
 * `motif_rejet`, `VALIDEE` exige `paiement_du`, seuls le mode `MOBILE_MONEY`
 * (MVola) et la devise `MGA` sont admis — aucun virement n'existe ici.
 * Contrôles PRÉ-ENVOI : type MIME du bucket et
 * 20 Mo avant chaque téléversement (§5.3) ; mode et opérateur MVola vérifiés
 * avant toute initiation de paiement (§5.7 / §9).
 *
 * Sans `EXPO_PUBLIC_API_BASE_URL`, chaque appel renvoie un `Result` `serveur`
 * « API non configurée » (garde en tête de `demander()` et de
 * `televerserFichier()`), sans exception ni appel réseau : il n'existe aucun
 * repli sur de fausses données.
 */
import {
  CODE_DEVISE_MGA,
  MODES_PAIEMENT,
  OPERATEURS_PAIEMENT,
  STATUTS_DEMANDE,
  STATUTS_PAIEMENT,
  TAILLE_MAX_FICHIER_OCTETS,
  TYPES_MIME_AUTORISES,
  TYPES_PAIEMENT,
  type CodeDevise,
  type HorodatageISO,
  type ModePaiement,
  type MontantAriary,
  type OperateurMobileMoney,
  type OperateurPaiement,
  type StatutDemande,
  type StatutPaiement,
  type TailleOctets,
  type TypeMime,
  type TypePaiement,
  type UUID,
} from '../../models';
import {
  erreurMetier,
  erreurReseau,
  erreurServeur,
  ok,
  CODES_ERREUR_CANDIDAT,
  type CandidateApi,
  type ConfirmationEnvoiDemande,
  type CreerDemandeEntree,
  type DemandeBrouillon,
  type EtatPaiementCandidat,
  type FichierTeleverse,
  type InitierPaiementEntree,
  type MettreAJourDemandeEntree,
  type ModePaiementDisponible,
  type MontantPaiementDu,
  type OptionsPaiementCandidat,
  type OptionsTeleversement,
  type Result,
  type ResultErr,
  type SoumettreDemandeEntree,
  type SuiviDemande,
  type SuiviDemandeEntree,
  type TeleversementEntree,
} from '../contracts';

/* --------------------------------------------------------------- Constantes */

/** URL de base de l'API Express candidat (`EXPO_PUBLIC_API_BASE_URL`). */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim();

/** Préfixe versionné de l'API (`docs/API_CANDIDAT.md` §1). */
const PREFIXE_API = '/v1';

/** Délai maximal d'une requête JSON, au-delà duquel l'erreur est `reseau`. */
export const DELAI_TIMEOUT_MS = 15000;

/** Délai maximal d'un téléversement multipart (fichiers de 20 Mo maximum). */
export const DELAI_TIMEOUT_TELEVERSEMENT_MS = 120000;

/** Message affiché quand `EXPO_PUBLIC_API_BASE_URL` est absente. */
export const MESSAGE_API_NON_CONFIGURE =
  'L’API OMDA n’est pas configurée (EXPO_PUBLIC_API_BASE_URL). Renseignez cette variable puis relancez l’application.';

/** Réponse inexploitable : JSON absent, vide ou de forme inattendue (§9). */
export const MESSAGE_REPONSE_INATTENDUE =
  'Le serveur a renvoyé une réponse incompatible avec l’application. Réessayez dans un instant.';

/** Code local d'annulation d'un envoi (identique à `CODES_ERREUR_DONNEES.TELEVERSEMENT_ANNULE`). */
const CODE_TELEVERSEMENT_ANNULE = 'TELEVERSEMENT_ANNULE';
const MESSAGE_TELEVERSEMENT_ANNULE = 'L’envoi a été annulé. Vous pouvez réessayer.';

/**
 * Refus local d'un mode autre que Mobile Money : même vocabulaire que
 * `CODES_ERREUR_DONNEES.MODE_PAIEMENT_INVALIDE` — repris en littéral dans cette couche.
 */
const CODE_MODE_PAIEMENT_INVALIDE = 'MODE_PAIEMENT_INVALIDE';

/* ------------------------------------------------- Helpers utilitaires */

/** Couple dossier conservé en mémoire (cf. `enTetesContexte`). */
type ContexteDossier = {
  numero_dossier: string;
  code_suivi: string;
};

/** Détail technique d'une exception (cause d'une erreur `reseau`/`serveur`). */
function texteDe(cause: unknown): string | undefined {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === 'string') {
    return cause;
  }
  return undefined;
}

/** Annulation d'un envoi par l'utilisateur (même code que `CODES_ERREUR_DONNEES`). */
function refusAnnulation(): ResultErr {
  return erreurMetier(CODE_TELEVERSEMENT_ANNULE, MESSAGE_TELEVERSEMENT_ANNULE);
}

/** URL complète d'un chemin de l'API (`base` sans barre finale + `/v1` + chemin). */
function urlDepuisChemin(chemin: string): string {
  return `${API_BASE_URL.replace(/\/+$/, '')}${PREFIXE_API}${chemin}`;
}

/** Refus `serveur` d'une réponse dont un champ est absent ou de type inattendu. */
function reponseInvalide(champ: string): ResultErr {
  return erreurServeur({
    message: `Réponse inattendue du serveur : le champ « ${champ} » est absent ou d’un type inattendu.`,
  });
}

/** Refus `serveur` d'une valeur présente mais contraire aux règles métier. */
function reponseIncoherente(champ: string, attente: string): ResultErr {
  return erreurServeur({
    message: `Réponse incohérente du serveur : le champ « ${champ} » ${attente}.`,
  });
}

/** Demande créée ou mise à jour (§5.1 / §5.2). */
function demandeBrouillon(donnees: Record<string, unknown>): DemandeBrouillon {
  return {
    demande_id: donnees.demande_id as UUID,
    numero_dossier: donnees.numero_dossier as string,
    code_suivi: donnees.code_suivi as string,
    statut: donnees.statut as StatutDemande,
    created_at: donnees.created_at as HorodatageISO,
  };
}

/** Montant dû retourné par le serveur (§5.5 / §5.6 — jamais calculé par l'app). */
function montantDuDepuis(donnees: Record<string, unknown>): MontantPaiementDu {
  return {
    type: donnees.type as TypePaiement,
    montant: donnees.montant as MontantAriary,
    devise: donnees.devise as CodeDevise,
  };
}

/** `Idempotency-Key` UUID v4 (§1) : WebCrypto si présent, sinon repli formaté. */
function genererCleIdempotence(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (caractere) => {
    const alea = (Math.random() * 16) | 0;
    const valeur = caractere === 'x' ? alea : (alea & 0x3) | 0x8;
    return valeur.toString(16);
  });
}

/* ------------------------------------------ Validation des réponses */

/** Type attendu d'un champ : primitive, forme, ou ENUM (tableau de valeurs). */
type TypeAttendu =
  | 'texte'
  | 'nombre'
  | 'booleen'
  | 'objet'
  | 'tableau'
  | 'texteOuNul'
  | 'nombreOuNul'
  | 'objetOuNul'
  | readonly string[];

type SchemaReponse = Record<string, TypeAttendu>;

function estDeType(valeur: unknown, attendu: TypeAttendu): boolean {
  if (Array.isArray(attendu)) {
    const valeurs = attendu as readonly string[];
    return typeof valeur === 'string' && valeurs.includes(valeur);
  }
  switch (attendu) {
    case 'texte':
      return typeof valeur === 'string' && valeur.trim() !== '';
    case 'nombre':
      return typeof valeur === 'number' && Number.isFinite(valeur);
    case 'booleen':
      return typeof valeur === 'boolean';
    case 'objet':
      return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
    case 'tableau':
      return Array.isArray(valeur);
    case 'texteOuNul':
      return valeur === undefined || valeur === null || typeof valeur === 'string';
    case 'nombreOuNul':
      return (
        valeur === undefined ||
        valeur === null ||
        (typeof valeur === 'number' && Number.isFinite(valeur))
      );
    case 'objetOuNul':
      return (
        valeur === undefined ||
        valeur === null ||
        (typeof valeur === 'object' && !Array.isArray(valeur))
      );
    default:
      return false;
  }
}

/**
 * Contrôle une réponse 2xx contre le contrat (`docs/API_CANDIDAT.md` §9) :
 * champ absent ou type incohérent ⇒ erreur `serveur` — jamais un écran affiché
 * sur des données inconnues.
 */
function validerReponse(
  corps: unknown,
  schema: SchemaReponse,
  chemin = '',
): Result<Record<string, unknown>> {
  if (typeof corps !== 'object' || corps === null || Array.isArray(corps)) {
    return reponseInvalide(chemin === '' ? 'réponse' : chemin);
  }
  const donnees = corps as Record<string, unknown>;
  for (const champ of Object.keys(schema)) {
    if (!estDeType(donnees[champ], schema[champ])) {
      return reponseInvalide(chemin === '' ? champ : `${chemin}.${champ}`);
    }
  }
  return ok(donnees);
}

/** Contrôle chaque élément d'une liste de ressources (erreur localisée). */
function validerListe(
  valeur: unknown,
  schema: SchemaReponse,
  chemin: string,
): Result<Array<Record<string, unknown>>> {
  if (!Array.isArray(valeur)) {
    return reponseInvalide(chemin);
  }
  const items: Array<Record<string, unknown>> = [];
  for (let index = 0; index < valeur.length; index += 1) {
    const validation = validerReponse(valeur[index], schema, `${chemin}[${index}]`);
    if (!validation.ok) {
      return validation;
    }
    items.push(validation.valeur);
  }
  return ok(items);
}

/* --------------------------------------------- Transport HTTP (fetch) */

type EnveloppeErreur = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  reference?: string;
};

/** Enveloppe d'erreur normalisée du serveur (§2), si elle est exploitable. */
function lireEnveloppeErreur(corps: unknown): EnveloppeErreur | null {
  if (typeof corps !== 'object' || corps === null || Array.isArray(corps)) {
    return null;
  }
  const donnees = corps as Record<string, unknown>;
  if (
    typeof donnees.code !== 'string' ||
    donnees.code.trim() === '' ||
    typeof donnees.message !== 'string' ||
    donnees.message.trim() === ''
  ) {
    return null;
  }
  const enveloppe: EnveloppeErreur = { code: donnees.code, message: donnees.message };
  if (
    typeof donnees.details === 'object' &&
    donnees.details !== null &&
    !Array.isArray(donnees.details)
  ) {
    enveloppe.details = donnees.details as Record<string, unknown>;
  }
  if (typeof donnees.reference === 'string' && donnees.reference.trim() !== '') {
    enveloppe.reference = donnees.reference;
  }
  return enveloppe;
}

/**
 * Mapping statut + corps → `Result` (§2) : 2xx ⇒ `ok`, 5xx ⇒ `serveur`
 * (`statut_http` + `reference`), 4xx avec enveloppe ⇒ `metier` (`code`,
 * `message`, `details`), 4xx sans enveloppe (contrat rompu) ⇒ `serveur`.
 */
function classerReponse(statut: number, texte: string): Result<unknown> {
  let corps: unknown;
  if (texte.trim() === '') {
    corps = undefined;
  } else {
    try {
      corps = JSON.parse(texte);
    } catch {
      corps = undefined;
    }
  }

  if (statut >= 200 && statut < 300) {
    if (typeof corps !== 'object' || corps === null || Array.isArray(corps)) {
      return erreurServeur({ statut_http: statut, message: MESSAGE_REPONSE_INATTENDUE });
    }
    return ok(corps);
  }

  const enveloppe = lireEnveloppeErreur(corps);
  if (statut >= 500) {
    return erreurServeur({
      statut_http: statut,
      reference: enveloppe?.reference ?? enveloppe?.code,
      message: enveloppe?.message,
    });
  }
  if (enveloppe) {
    return erreurMetier(enveloppe.code, enveloppe.message, enveloppe.details);
  }
  return erreurServeur({ statut_http: statut, message: MESSAGE_REPONSE_INATTENDUE });
}

type RequeteJson = {
  methode: 'GET' | 'POST' | 'PATCH';
  /** Chemin après `/v1` (ex. `/suivi/OMDA-2026-000123`). */
  chemin: string;
  corps?: unknown;
  enTetes?: Record<string, string>;
};

/**
 * Requête JSON avec délai maximal (`DELAI_TIMEOUT_MS`) et mapping d'erreurs :
 * transport absent / timeout ⇒ `reseau`, corps illisible ⇒ `serveur`.
 * Aucune exception ne remonte à l'UI (contrat `Result`).
 */
async function demander({ methode, chemin, corps, enTetes }: RequeteJson): Promise<Result<unknown>> {
  if (API_BASE_URL === '') {
    return erreurServeur({ message: MESSAGE_API_NON_CONFIGURE });
  }

  let corpsTexte: string | null = null;
  if (corps !== undefined) {
    try {
      corpsTexte = JSON.stringify(corps);
    } catch {
      return erreurServeur();
    }
  }

  const entetes: Record<string, string> = { Accept: 'application/json', ...(enTetes ?? {}) };
  if (corpsTexte !== null) {
    entetes['Content-Type'] = 'application/json';
  }

  const controleur = new AbortController();
  let echecParDelai = false;
  const minuteur = setTimeout(() => {
    echecParDelai = true;
    controleur.abort();
  }, DELAI_TIMEOUT_MS);

  let reponse: Response;
  try {
    reponse = await fetch(urlDepuisChemin(chemin), {
      method: methode,
      headers: entetes,
      body: corpsTexte ?? undefined,
      signal: controleur.signal,
    });
  } catch (cause) {
    return erreurReseau(echecParDelai ? `délai dépassé après ${DELAI_TIMEOUT_MS} ms` : texteDe(cause));
  } finally {
    clearTimeout(minuteur);
  }

  let texte = '';
  try {
    texte = await reponse.text();
  } catch (cause) {
    return erreurServeur({ statut_http: reponse.status, reference: texteDe(cause) });
  }
  return classerReponse(reponse.status, texte);
}

/* --------------------------------------------- Schémas des réponses */

/** Brouillon créé ou mis à jour (§5.1 / §5.2). */
const SCHEMA_BROUILLON: SchemaReponse = {
  demande_id: 'texte',
  numero_dossier: 'texte',
  code_suivi: 'texte',
  statut: STATUTS_DEMANDE,
  created_at: 'texte',
};

/** Confirmation d'envoi du dossier (§5.4) — délai indicatif informatif. */
const SCHEMA_CONFIRMATION_ENVOI: SchemaReponse = {
  numero_dossier: 'texte',
  code_suivi: 'texte',
  statut: STATUTS_DEMANDE,
  date_soumission: 'texte',
  delai_indicatif_heures: 'nombre',
};

/** Montant dû, toujours fourni par le serveur (§5.5 / §5.6). */
const SCHEMA_MONTANT_DU: SchemaReponse = {
  type: TYPES_PAIEMENT,
  montant: 'nombre',
  devise: [CODE_DEVISE_MGA],
};

const SCHEMA_ETAPE_SUIVI: SchemaReponse = {
  statut: STATUTS_DEMANDE,
  libelle: 'texte',
  realisee: 'booleen',
  date: 'texteOuNul',
};

/** Mode de paiement : seul `MOBILE_MONEY` (MVola) existe — aucun virement. */
const SCHEMA_MODE_PAIEMENT: SchemaReponse = {
  mode: MODES_PAIEMENT,
  libelle: 'texte',
  operateurs: 'tableau',
};

/** Opérateur Mobile Money : seul `MVOLA` existe dans le schéma. */
const SCHEMA_OPERATEUR: SchemaReponse = {
  code: OPERATEURS_PAIEMENT,
  libelle: 'texte',
  actif: 'booleen',
  ordre: 'nombre',
  updated_at: 'texte',
};

const SCHEMA_ETAT_PAIEMENT: SchemaReponse = {
  paiement_id: 'texte',
  reference_interne: 'texte',
  reference_externe: 'texteOuNul',
  type: TYPES_PAIEMENT,
  montant: 'nombre',
  devise: [CODE_DEVISE_MGA],
  mode: MODES_PAIEMENT,
  operateur: 'texteOuNul',
  statut: STATUTS_PAIEMENT,
  motif_echec: 'texteOuNul',
  date_initiation: 'texte',
  date_confirmation: 'texteOuNul',
  instruction: 'texteOuNul',
};

const SCHEMA_FICHIER_TELEVERSE: SchemaReponse = {
  chemin_stockage: 'texte',
  mime_type: 'texte',
  taille_octets: 'nombre',
};

/* ------------------------------------------- Implémentation HTTP */
export class HttpCandidateApi implements CandidateApi {
  /* ------------------------------------------------- Contexte du dossier */

  /**
   * Dossier en cours (numéro + code de suivi), retenu entre deux appels pour
   * les opérations qui ne les reçoivent pas : le polling de l'état d'un
   * paiement (§5.8) n'a que la référence interne alors que l'API exige
   * l'en-tête `X-Code-Suivi`.
   */
  private contexteDossier: ContexteDossier | null = null;

  /** En-têtes d'authentification candidat (§1) + mémorisation du dossier. */
  private enTetesDossier(numero_dossier: string, code_suivi: string): Record<string, string> {
    const contexte: ContexteDossier = {
      numero_dossier: numero_dossier.trim(),
      code_suivi: code_suivi.trim(),
    };
    this.contexteDossier = contexte;
    return {
      'X-Numero-Dossier': contexte.numero_dossier,
      'X-Code-Suivi': contexte.code_suivi,
    };
  }

  /** En-têtes du dossier en cours (vide tant qu'aucun dossier n'a été vu). */
  private enTetesContexte(): Record<string, string> {
    if (!this.contexteDossier) {
      return {};
    }
    return {
      'X-Numero-Dossier': this.contexteDossier.numero_dossier,
      'X-Code-Suivi': this.contexteDossier.code_suivi,
    };
  }

  /* --------------------------------- Création et mise à jour d'une demande */

  /** Crée un dossier à l'état `BROUILLON` (§5.1) — `AGE_INSUFFISANT` vient du serveur. */
  async creerDemande(entree: CreerDemandeEntree): Promise<Result<DemandeBrouillon>> {
    const reponse = await demander({ methode: 'POST', chemin: '/demandes', corps: entree });
    if (!reponse.ok) {
      return reponse;
    }
    const validation = validerReponse(reponse.valeur, SCHEMA_BROUILLON);
    if (!validation.ok) {
      return validation;
    }
    const donnees = validation.valeur;
    this.contexteDossier = {
      numero_dossier: donnees.numero_dossier as string,
      code_suivi: donnees.code_suivi as string,
    };
    return ok(demandeBrouillon(donnees));
  }

  /** Met à jour un brouillon (identité, catégorie) — §5.2, refus `409` si statut ≠ BROUILLON. */
  async mettreAJourDemande(
    numero_dossier: string,
    code_suivi: string,
    entree: MettreAJourDemandeEntree,
  ): Promise<Result<DemandeBrouillon>> {
    const reponse = await demander({
      methode: 'PATCH',
      chemin: `/demandes/${encodeURIComponent(numero_dossier.trim())}`,
      corps: entree,
      enTetes: this.enTetesDossier(numero_dossier, code_suivi),
    });
    if (!reponse.ok) {
      return reponse;
    }
    const validation = validerReponse(reponse.valeur, SCHEMA_BROUILLON);
    if (!validation.ok) {
      return validation;
    }
    this.contexteDossier = {
      numero_dossier: numero_dossier.trim(),
      code_suivi: code_suivi.trim(),
    };
    return ok(demandeBrouillon(validation.valeur));
  }

  /* ------------------------- Envoi du dossier et téléversement multipart */

  /** Envoie le dossier complet (§5.4) : `ENVOYEE`, délai indicatif, AUCUN paiement. */
  async soumettreDemande(entree: SoumettreDemandeEntree): Promise<Result<ConfirmationEnvoiDemande>> {
    const { numero_dossier, code_suivi, ...corps } = entree;
    const reponse = await demander({
      methode: 'POST',
      chemin: `/demandes/${encodeURIComponent(numero_dossier.trim())}/envoi`,
      corps,
      enTetes: {
        ...this.enTetesDossier(numero_dossier, code_suivi),
        'Idempotency-Key': genererCleIdempotence(),
      },
    });
    if (!reponse.ok) {
      return reponse;
    }
    const validation = validerReponse(reponse.valeur, SCHEMA_CONFIRMATION_ENVOI);
    if (!validation.ok) {
      return validation;
    }
    const donnees = validation.valeur;
    return ok({
      numero_dossier: donnees.numero_dossier as string,
      code_suivi: donnees.code_suivi as string,
      statut: donnees.statut as StatutDemande,
      date_soumission: donnees.date_soumission as HorodatageISO,
      delai_indicatif_heures: donnees.delai_indicatif_heures as number,
    });
  }

  /**
   * Téléverse un fichier (§5.3 : `POST /v1/fichiers` — dépôt PRÉALABLE à la
   * création du dossier). Progression réelle via `upload.onprogress`
   * (0 → 99 % puis 100 % à la confirmation), annulation par `AbortSignal`
   * ⇒ métier `TELEVERSEMENT_ANNULE`, délai maximal `DELAI_TIMEOUT_TELEVERSEMENT_MS`.
   * Contrôles pré-envoi (§5.3) : type MIME du bucket
   * (`TYPES_MIME_AUTORISES`) puis 20 Mo — l'attestation (PDF/JPEG/PNG) est
   * contrôlée par les écrans puis revalidée à l'envoi du dossier.
   */
  async televerserFichier(
    entree: TeleversementEntree,
    options?: OptionsTeleversement,
  ): Promise<Result<FichierTeleverse>> {
    if (API_BASE_URL === '') {
      return erreurServeur({ message: MESSAGE_API_NON_CONFIGURE });
    }
    const mimesAutorises = TYPES_MIME_AUTORISES[entree.bucket] as readonly string[];
    if (!mimesAutorises.includes(entree.mime_type)) {
      return erreurMetier(
        CODES_ERREUR_CANDIDAT.TYPE_FICHIER_NON_AUTORISE,
        'Ce format de fichier n’est pas accepté pour ce dépôt (JPEG, PNG ou PDF).',
      );
    }
    if (entree.taille_octets > TAILLE_MAX_FICHIER_OCTETS) {
      return erreurMetier(
        CODES_ERREUR_CANDIDAT.FICHIER_TROP_VOLUMINEUX,
        'Le fichier dépasse la taille maximale de 20 Mo.',
      );
    }
    if (options?.signal?.aborted) {
      return refusAnnulation();
    }

    return new Promise<Result<FichierTeleverse>>((resolve) => {
      const requete = new XMLHttpRequest();
      let termine = false;

      const annuler = () => requete.abort();
      const conclure = (resultat: Result<FichierTeleverse>) => {
        if (termine) {
          return;
        }
        termine = true;
        options?.signal?.removeEventListener('abort', annuler);
        resolve(resultat);
      };

      requete.upload.onprogress = (evenement) => {
        if (evenement.lengthComputable && evenement.total > 0) {
          const pourcentage = Math.min(99, Math.round((evenement.loaded / evenement.total) * 100));
          options?.onProgression?.(pourcentage);
        }
      };
      requete.onload = () => {
        const reponse = classerReponse(requete.status, requete.responseText);
        if (!reponse.ok) {
          conclure(reponse);
          return;
        }
        const validation = validerReponse(reponse.valeur, SCHEMA_FICHIER_TELEVERSE);
        if (!validation.ok) {
          conclure(validation);
          return;
        }
        options?.onProgression?.(100);
        const donnees = validation.valeur;
        conclure(
          ok({
            chemin_stockage: donnees.chemin_stockage as string,
            mime_type: donnees.mime_type as TypeMime,
            taille_octets: donnees.taille_octets as TailleOctets,
          }),
        );
      };
      requete.onerror = () =>
        conclure(erreurReseau('téléversement interrompu (aucune réponse du serveur)'));
      requete.ontimeout = () =>
        conclure(erreurReseau(`délai dépassé après ${DELAI_TIMEOUT_TELEVERSEMENT_MS} ms`));
      requete.onabort = () => conclure(refusAnnulation());

      try {
        requete.open('POST', urlDepuisChemin('/fichiers'));
        requete.timeout = DELAI_TIMEOUT_TELEVERSEMENT_MS;
        requete.setRequestHeader('Accept', 'application/json');
        for (const [nom, valeur] of Object.entries(this.enTetesContexte())) {
          requete.setRequestHeader(nom, valeur);
        }

        const formulaire = new FormData();
        formulaire.append('bucket', entree.bucket);
        formulaire.append('chemin_stockage', entree.chemin_stockage);
        formulaire.append(
          'fichier',
          { uri: entree.fichier_uri, name: entree.nom_fichier, type: entree.mime_type } as unknown as Blob,
          entree.nom_fichier,
        );

        options?.signal?.addEventListener('abort', annuler, { once: true });
        requete.send(formulaire);
      } catch (cause) {
        conclure(erreurServeur({ reference: texteDe(cause) }));
      }
    });
  }

  /* ------------------------------- Suivi et options de paiement (MVola) */

  /** Suivi public (§5.5) : statut, frise, motif de rejet obligatoire, montant dû. */
  async suivreDemande(entree: SuiviDemandeEntree): Promise<Result<SuiviDemande>> {
    const reponse = await demander({
      methode: 'GET',
      chemin: `/suivi/${encodeURIComponent(entree.numero_dossier.trim())}`,
      enTetes: this.enTetesDossier(entree.numero_dossier, entree.code_suivi),
    });
    if (!reponse.ok) {
      return reponse;
    }
    const validation = validerReponse(reponse.valeur, {
      numero_dossier: 'texte',
      statut: STATUTS_DEMANDE,
      derniere_mise_a_jour: 'texte',
      etapes: 'tableau',
      motif_rejet: 'texteOuNul',
      paiement_du: 'objetOuNul',
    });
    if (!validation.ok) {
      return validation;
    }
    const donnees = validation.valeur;
    const statut = donnees.statut as StatutDemande;

    const motifRejet = (donnees.motif_rejet as string | null) ?? null;
    if (statut === 'REJETEE' && (motifRejet === null || motifRejet.trim() === '')) {
      return reponseIncoherente('motif_rejet', 'doit être renseigné dès que le statut est REJETEE');
    }

    const etapes = validerListe(donnees.etapes, SCHEMA_ETAPE_SUIVI, 'etapes');
    if (!etapes.ok) {
      return etapes;
    }

    let paiementDu: MontantPaiementDu | null = null;
    if (donnees.paiement_du !== undefined && donnees.paiement_du !== null) {
      const validationMontant = validerReponse(
        donnees.paiement_du,
        SCHEMA_MONTANT_DU,
        'paiement_du',
      );
      if (!validationMontant.ok) {
        return validationMontant;
      }
      paiementDu = montantDuDepuis(validationMontant.valeur);
    }
    if (statut === 'VALIDEE' && paiementDu === null) {
      return reponseIncoherente('paiement_du', 'doit être renseigné dès que le statut est VALIDEE');
    }

    return ok({
      numero_dossier: donnees.numero_dossier as string,
      statut,
      derniere_mise_a_jour: donnees.derniere_mise_a_jour as HorodatageISO,
      etapes: etapes.valeur.map((etape) => ({
        statut: etape.statut as StatutDemande,
        libelle: etape.libelle as string,
        realisee: etape.realisee as boolean,
        date: (etape.date as HorodatageISO | null) ?? null,
      })),
      motif_rejet: motifRejet,
      paiement_du: paiementDu,
    });
  }

  /** Modes disponibles (§5.6) : `MOBILE_MONEY` (MVola) uniquement, aucun virement. */
  async obtenirOptionsPaiement(
    entree: SuiviDemandeEntree,
  ): Promise<Result<OptionsPaiementCandidat>> {
    const reponse = await demander({
      methode: 'GET',
      chemin: `/paiements/options/${encodeURIComponent(entree.numero_dossier.trim())}`,
      enTetes: this.enTetesDossier(entree.numero_dossier, entree.code_suivi),
    });
    if (!reponse.ok) {
      return reponse;
    }
    const validation = validerReponse(reponse.valeur, { paiement_du: 'objet', modes: 'tableau' });
    if (!validation.ok) {
      return validation;
    }
    const validationMontant = validerReponse(
      validation.valeur.paiement_du,
      SCHEMA_MONTANT_DU,
      'paiement_du',
    );
    if (!validationMontant.ok) {
      return validationMontant;
    }
    const modesBruts = validerListe(validation.valeur.modes, SCHEMA_MODE_PAIEMENT, 'modes');
    if (!modesBruts.ok) {
      return modesBruts;
    }

    const modes: ModePaiementDisponible[] = [];
    for (const mode of modesBruts.valeur) {
      const operateursBruts = validerListe(mode.operateurs, SCHEMA_OPERATEUR, 'modes.operateurs');
      if (!operateursBruts.ok) {
        return operateursBruts;
      }
      const operateurs: OperateurMobileMoney[] = [];
      for (const operateur of operateursBruts.valeur) {
        // Un opérateur désactivé n'est jamais exposé à l'écran (§5.6).
        if (operateur.actif !== true) {
          continue;
        }
        operateurs.push({
          code: operateur.code as OperateurPaiement,
          libelle: operateur.libelle as string,
          actif: true,
          ordre: operateur.ordre as number,
          updated_at: operateur.updated_at as HorodatageISO,
        });
      }
      modes.push({
        mode: mode.mode as ModePaiement,
        libelle: mode.libelle as string,
        operateurs,
      });
    }

    return ok({ paiement_du: montantDuDepuis(validationMontant.valeur), modes });
  }

  /* -------------------------- Paiement : initiation, état et polling */

  /**
   * Initie un paiement Mobile Money (§5.7) : `201` = initiation UNIQUEMENT.
   * MVola only (§9) : refus locaux pour tout mode ≠
   * `MOBILE_MONEY` ou opérateur absent/hors `OPERATEURS_PAIEMENT`, avant tout
   * appel réseau.
   */
  async initierPaiement(entree: InitierPaiementEntree): Promise<Result<EtatPaiementCandidat>> {
    if (!(MODES_PAIEMENT as readonly string[]).includes(entree.mode)) {
      return erreurMetier(
        CODE_MODE_PAIEMENT_INVALIDE,
        'Seul le paiement par Mobile Money (MVola) est proposé.',
      );
    }
    const operateurAdmis =
      entree.operateur !== undefined &&
      entree.operateur !== null &&
      (OPERATEURS_PAIEMENT as readonly string[]).includes(entree.operateur);
    if (!operateurAdmis) {
      return erreurMetier(
        CODES_ERREUR_CANDIDAT.OPERATEUR_INDISPONIBLE,
        'Cet opérateur Mobile Money est momentanément indisponible.',
      );
    }

    const reponse = await demander({
      methode: 'POST',
      chemin: '/paiements',
      corps: {
        numero_dossier: entree.numero_dossier.trim(),
        mode: entree.mode,
        operateur: entree.operateur ?? undefined,
        numero_telephone: entree.numero_telephone ?? undefined,
      },
      enTetes: {
        ...this.enTetesDossier(entree.numero_dossier, entree.code_suivi),
        'Idempotency-Key': genererCleIdempotence(),
      },
    });
    if (!reponse.ok) {
      return reponse;
    }
    return this.lireEtatPaiement(reponse.valeur);
  }

  /** Polling (§5.8) : la clé est la référence interne ; le contexte fournit `X-Code-Suivi`. */
  async obtenirEtatPaiement(reference_interne: string): Promise<Result<EtatPaiementCandidat>> {
    const reponse = await demander({
      methode: 'GET',
      chemin: `/paiements/${encodeURIComponent(reference_interne.trim())}`,
      enTetes: this.enTetesContexte(),
    });
    if (!reponse.ok) {
      return reponse;
    }
    return this.lireEtatPaiement(reponse.valeur);
  }

  /**
   * Lit un état de paiement (§5.7 / §5.8) et applique les règles impératives :
   * `REUSSI` exige `date_confirmation` (aucun succès sans confirmation
   * serveur), `ECHEC_*` / `REJETE` exige un `motif_echec`, `operateur` doit
   * appartenir à `OPERATEURS_PAIEMENT` (MVola seul).
   */
  private lireEtatPaiement(corps: unknown): Result<EtatPaiementCandidat> {
    const validation = validerReponse(corps, SCHEMA_ETAT_PAIEMENT);
    if (!validation.ok) {
      return validation;
    }
    const donnees = validation.valeur;

    const operateur = donnees.operateur;
    if (
      operateur !== undefined &&
      operateur !== null &&
      !(OPERATEURS_PAIEMENT as readonly string[]).includes(operateur as string)
    ) {
      return reponseInvalide('operateur');
    }

    const statut = donnees.statut as StatutPaiement;
    const dateConfirmation = (donnees.date_confirmation as HorodatageISO | null) ?? null;
    if (statut === 'REUSSI' && dateConfirmation === null) {
      return reponseIncoherente(
        'date_confirmation',
        'est exigée dès que le statut est REUSSI (confirmation serveur)',
      );
    }
    const motifEchec = (donnees.motif_echec as string | null) ?? null;
    const echec = statut === 'REJETE' || statut.startsWith('ECHEC');
    if (echec && (motifEchec === null || motifEchec.trim() === '')) {
      return reponseIncoherente('motif_echec', `doit être renseigné pour le statut ${statut}`);
    }

    return ok({
      paiement_id: donnees.paiement_id as UUID,
      reference_interne: donnees.reference_interne as string,
      reference_externe: (donnees.reference_externe as string | null) ?? null,
      type: donnees.type as TypePaiement,
      montant: donnees.montant as MontantAriary,
      devise: donnees.devise as CodeDevise,
      mode: donnees.mode as ModePaiement,
      operateur: (operateur as OperateurPaiement | null) ?? null,
      statut,
      motif_echec: motifEchec,
      date_initiation: donnees.date_initiation as HorodatageISO,
      date_confirmation: dateConfirmation,
      instruction: (donnees.instruction as string | null) ?? null,
    });
  }
}
