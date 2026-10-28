/**
 * Supabase Storage — téléversement et liens signés (étape 20).
 *
 * DEUX buckets seulement, ceux du schéma (`docs/SCHEMA_DB.md`) : `pieces`
 * (documents d'identité) et `oeuvres` (œuvres + attestations de diffusion).
 * Aucun autre bucket n'existe dans l'application.
 *
 * Ce que livre ce module :
 * - `uploadFile`   : envoi du fichier choisi sur le téléphone vers le bucket
 *   demandé, avec PROGRESSION réelle et ANNULATION (téléversement NATIF
 *   `expo-file-system/legacy` sur `POST /storage/v1/object/{bucket}/{chemin}`) ;
 *   les contrôles locaux (chemin, type MIME du bucket, 20 Mo, session) sont
 *   rendus AVANT tout envoi, avec des codes et messages stables ;
 * - `getSignedUrl` : lien TEMPORAIRE de consultation d'un document d'un bucket
 *   PRIVÉ — jamais construit par un écran (cf. `UrlFichierConsulte`) ;
 * - `removeFile`   : suppression d'un objet (remplacement d'un document, envoi
 *   à remplacer par le prochain téléversement).
 *
 * Hypothèses assumées :
 * - `supabase-js` (transport `fetch`) ne rapporte pas la progression d'un envoi
 *   dans React Native : l'envoi passe donc par le module NATIF d'Expo, sur la
 *   route REST utilisée par `supabase.storage.from(bucket).upload()`, avec le
 *   jeton de la session du membre (`authorization`) et la clé anonyme (`apikey`) ;
 * - le navigateur (web) n'est pas pris en charge : les sélecteurs de fichiers de
 *   l'application ne fournissent des URI locales que sur iOS et Android ;
 * - aucune erreur n'est jamais levée : tout passe par `Result`.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import {
  TAILLE_MAX_FICHIER_OCTETS,
  TYPES_MIME_AUTORISES,
  type BucketStockage,
} from '../../models';
import {
  CODES_ERREUR_MEMBRE,
  erreurMetier,
  erreurReseau,
  erreurServeur,
  ok,
  type FichierTeleverse,
  type OptionsTeleversement,
  type Result,
  type ResultErr,
  type TeleversementEntree,
  type UrlFichierConsulte,
} from '../contracts';
import {
  estSupabaseConfigure,
  getSupabaseClient,
  MESSAGE_SUPABASE_NON_CONFIGURE,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from './client';

/* -------------------------------------------------------------- Constantes */

/** Durée par défaut d'un lien de consultation signé : 1 heure. */
export const DUREE_LIEN_SIGNE_SECONDES = 3600;

/** Code d'annulation d'un envoi (identique à `HttpCandidateApi`). */
export const CODE_TELEVERSEMENT_ANNULE = 'TELEVERSEMENT_ANNULE';

/** Message affiché quand le membre annule l'envoi. */
export const MESSAGE_TELEVERSEMENT_ANNULE =
  'L’envoi a été annulé. Vous pouvez réessayer.';

/** Message affiché quand l'application tourne dans un navigateur (web). */
export const MESSAGE_TELEVERSEMENT_WEB =
  'L’envoi de fichiers n’est pas pris en charge dans le navigateur. Utilisez l’application sur votre téléphone.';

/** Options d'un envoi : progression, annulation, remplacement d'un fichier. */
export type OptionsEnvoiStockage = OptionsTeleversement & {
  /** Remplace le fichier déjà présent à ce chemin (sinon un conflit est refusé). */
  remplacer?: boolean;
};

/* ------------------------------------------------------------------ Helpers */

/** Détail technique d'une exception (journal seulement, jamais affiché brut). */
function texteDe(cause: unknown): string | undefined {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === 'string') {
    return cause;
  }
  return undefined;
}

/** Refus métier d'un envoi annulé par le membre (code stable). */
function refusAnnulation(): ResultErr {
  return erreurMetier(
    CODE_TELEVERSEMENT_ANNULE,
    MESSAGE_TELEVERSEMENT_ANNULE,
  );
}

/** Refus métier standard d'un document absent du Storage (message standard). */
function refusFichierIntrouvable(): ResultErr {
  return erreurMetier(
    CODES_ERREUR_MEMBRE.FICHIER_INTROUVABLE,
    'Ce document n’est pas disponible. Rechargez la fiche puis réessayez.',
  );
}

/** Refus métier standard sans session (code et message standard). */
function sessionRequise(): ResultErr {
  return erreurMetier(
    CODES_ERREUR_MEMBRE.NON_AUTHENTIFIE,
    'Vous devez être connecté pour accéder à cette information.',
  );
}

/**
 * Bucket d'un chemin de stockage : `pieces/...` ou `oeuvres/...` (les chemins
 * enregistrés en base commencent toujours par le nom du bucket), sinon `null`.
 */
export function bucketDepuisChemin(chemin_stockage: string): BucketStockage | null {
  const premier = chemin_stockage.trim().split('/')[0];
  return premier === 'pieces' || premier === 'oeuvres' ? premier : null;
}

/**
 * Chemin de stockage d'un membre : `<bucket>/<id utilisateur>/<reste>`.
 * Idempotent : un chemin déjà préfixé par l'identifiant n'est pas modifié.
 */
export function cheminDuMembre(
  bucket: BucketStockage,
  chemin_stockage: string,
  utilisateurId: string,
): string {
  const reste = cheminDansBucket(bucket, chemin_stockage).replace(/^\/+/, '');
  const dejaPrefixe = reste.startsWith(`${utilisateurId}/`);
  return `${bucket}/${dejaPrefixe ? reste : `${utilisateurId}/${reste}`}`;
}

/** Chemin de l'objet DANS le bucket (le bucket est déjà porté par l'URL). */
function cheminDansBucket(bucket: BucketStockage, chemin_stockage: string): string {
  const chemin = chemin_stockage.trim();
  const prefixe = `${bucket}/`;
  return chemin.startsWith(prefixe) ? chemin.slice(prefixe.length) : chemin;
}

/** URL REST d'un objet du Storage (segments encodés, séparateurs « / » gardés). */
function urlObjet(bucket: BucketStockage, chemin: string): string {
  const segments = chemin.split('/').map((segment) => encodeURIComponent(segment));
  return `${SUPABASE_URL}/storage/v1/object/${bucket}/${segments.join('/')}`;
}

/** Jeton d'accès et identifiant du membre connecté, ou refus typé. */
async function jetonAcces(): Promise<Result<{ jeton: string; utilisateurId: string }>> {
  try {
    const { data, error } = await getSupabaseClient().auth.getSession();
    if (error) {
      return erreurServeur({
        reference: error.code ?? undefined,
        message: 'La vérification de votre session a échoué. Réessayez dans un instant.',
      });
    }
    const jeton = data.session?.access_token;
    const utilisateurId = data.session?.user?.id;
    if (!jeton || !utilisateurId) {
      return sessionRequise();
    }
    return ok({ jeton, utilisateurId });
  } catch (cause) {
    return erreurReseau(texteDe(cause));
  }
}

/* -------------------------------------------------------------------- Envoi */

/** Contrôles locaux d'un envoi, rendus AVANT tout contact avec le serveur. */
function validerEntree(entree: TeleversementEntree): ResultErr | null {
  if (!entree.fichier_uri.trim() || !entree.chemin_stockage.trim()) {
    return erreurMetier(
      CODES_ERREUR_MEMBRE.FICHIER_INTROUVABLE,
      'Ce document n’est pas disponible. Choisissez à nouveau le fichier puis réessayez.',
    );
  }

  const mimesAutorises = TYPES_MIME_AUTORISES[entree.bucket] as readonly string[];
  if (!mimesAutorises.includes(entree.mime_type)) {
    return erreurMetier(
      CODES_ERREUR_MEMBRE.TYPE_FICHIER_NON_AUTORISE,
      'Ce format de fichier n’est pas accepté pour ce dépôt (JPEG, PNG ou PDF).',
    );
  }

  if (entree.taille_octets > TAILLE_MAX_FICHIER_OCTETS) {
    return erreurMetier(
      CODES_ERREUR_MEMBRE.FICHIER_TROP_VOLUMINEUX,
      'Le fichier dépasse la taille maximale de 20 Mo.',
    );
  }

  return null;
}

/** Message du corps d'erreur du Storage (`{ statusCode, error, message }`). */
function messageErreurStorage(corps: string): string {
  try {
    const analyse = JSON.parse(corps) as { message?: unknown };
    return typeof analyse.message === 'string' ? analyse.message : '';
  } catch {
    return '';
  }
}

/** Traduit un statut HTTP refusé par le Storage en `Result` typé. */
function classerStatutRefuse(statut: number, corps: string): ResultErr {
  const minuscule = messageErreurStorage(corps).toLowerCase();

  if (statut === 401 || statut === 403) {
    return sessionRequise();
  }
  if (
    statut === 413 ||
    minuscule.includes('maximum allowed size') ||
    minuscule.includes('too large')
  ) {
    return erreurMetier(
      CODES_ERREUR_MEMBRE.FICHIER_TROP_VOLUMINEUX,
      'Le fichier dépasse la taille maximale de 20 Mo.',
    );
  }
  if (statut === 400 && minuscule.includes('mime')) {
    return erreurMetier(
      CODES_ERREUR_MEMBRE.TYPE_FICHIER_NON_AUTORISE,
      'Ce format de fichier n’est pas accepté pour ce dépôt (JPEG, PNG ou PDF).',
    );
  }
  if (statut === 409) {
    return erreurServeur({
      statut_http: statut,
      message:
        'Un fichier porte déjà ce nom dans votre dossier. Renommez le fichier puis réessayez.',
    });
  }
  return erreurServeur({
    statut_http: statut,
    reference: messageErreurStorage(corps) || undefined,
    message: 'Le serveur n’a pas pu enregistrer votre fichier. Réessayez dans un instant.',
  });
}

/**
 * Envoi NATIF du fichier (progression 0 → 99 %, puis 100 % à la confirmation) :
 * `supabase-js` ne sait pas rapporter la progression d'un envoi dans React
 * Native, la route REST du Storage est donc appelée directement.
 */
async function envoyerFichier(
  entree: TeleversementEntree,
  jeton: string,
  options?: OptionsEnvoiStockage,
): Promise<Result<FichierTeleverse>> {
  const tache = FileSystem.createUploadTask(
    urlObjet(entree.bucket, cheminDansBucket(entree.bucket, entree.chemin_stockage)),
    entree.fichier_uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        authorization: `Bearer ${jeton}`,
        apikey: SUPABASE_ANON_KEY,
        'content-type': entree.mime_type,
        'cache-control': 'max-age=3600',
        'x-upsert': options?.remplacer ? 'true' : 'false',
      },
    },
    (progression) => {
      if (progression.totalBytesExpectedToSend <= 0) {
        return;
      }
      const pourcentage = Math.min(
        99,
        Math.round((progression.totalBytesSent / progression.totalBytesExpectedToSend) * 100),
      );
      options?.onProgression?.(pourcentage);
    },
  );

  const signal = options?.signal;
  const annuler = () => {
    void tache.cancelAsync();
  };
  if (signal?.aborted) {
    void tache.cancelAsync();
    return refusAnnulation();
  }
  signal?.addEventListener('abort', annuler, { once: true });

  try {
    const reponse = await tache.uploadAsync();
    if (!reponse || signal?.aborted) {
      return refusAnnulation();
    }
    if (reponse.status < 200 || reponse.status >= 300) {
      return classerStatutRefuse(reponse.status, reponse.body ?? '');
    }
    options?.onProgression?.(100);
    return ok({
      chemin_stockage: entree.chemin_stockage.trim(),
      mime_type: entree.mime_type,
      taille_octets: entree.taille_octets,
    });
  } catch (cause) {
    if (signal?.aborted) {
      return refusAnnulation();
    }
    return erreurReseau(texteDe(cause));
  } finally {
    signal?.removeEventListener('abort', annuler);
  }
}

/* ------------------------------------------------- Téléversement (publique) */

/**
 * Téléverse le fichier choisi sur le téléphone vers le bucket demandé.
 *
 * Refus rendus AVANT tout envoi (codes stables) : chemin ou URI vide ⇒
 * `FICHIER_INTROUVABLE`, format hors `TYPES_MIME_AUTORISES[bucket]` ⇒
 * `TYPE_FICHIER_NON_AUTORISE`, plus de 20 Mo ⇒ `FICHIER_TROP_VOLUMINEUX`,
 * absence de session ⇒ `NON_AUTHENTIFIE`. Une annulation (`options.signal`)
 * rend un refus métier `TELEVERSEMENT_ANNULE` (code stable).
 *
 * ⚠️ Formats de l'attestation de diffusion (PDF / JPEG / PNG, règle métier 8) :
 * contrôlés par les écrans et par les écritures d'œuvres ; ici c'est la règle du
 * BUCKET qui s'applique (`TYPES_MIME_AUTORISES`, qui autorise aussi l'audio dans
 * `oeuvres` pour le fichier de l'œuvre lui-même). Le `mime_type` renvoyé est
 * celui qui sera enregistré dans `attestation_diffusion.mime_type`.
 */
export async function uploadFile(
  entree: TeleversementEntree,
  options?: OptionsEnvoiStockage,
): Promise<Result<FichierTeleverse>> {
  const refus = validerEntree(entree);
  if (refus) {
    return refus;
  }
  if (Platform.OS === 'web') {
    return erreurServeur({ message: MESSAGE_TELEVERSEMENT_WEB });
  }
  if (!estSupabaseConfigure()) {
    return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
  }

  const acces = await jetonAcces();
  if (!acces.ok) {
    return acces;
  }
  // Les politiques Storage n'autorisent un membre qu'à écrire dans SON dossier `<bucket>/<id>/…`.
  // Le chemin effectivement utilisé est renvoyé dans le résultat : c'est lui que les écrans enregistrent.
  const entreeScopee: TeleversementEntree = {
    ...entree,
    chemin_stockage: cheminDuMembre(entree.bucket, entree.chemin_stockage, acces.valeur.utilisateurId),
  };
  return envoyerFichier(entreeScopee, acces.valeur.jeton, options);
}

/* ------------------------------------------------- Consultation et suppression */

/** Traduit une erreur de l'API Storage (`supabase-js`) en `Result` typé. */
function classerErreurStorage(error: unknown): ResultErr {
  const details = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  const statut = typeof details?.status === 'number' ? details.status : undefined;
  const reference = typeof details?.code === 'string' ? details.code : undefined;
  const message =
    (typeof details?.message === 'string' ? details.message : '') || (texteDe(error) ?? '');
  const minuscule = message.toLowerCase();

  if (
    statut === 401 ||
    statut === 403 ||
    minuscule.includes('jwt') ||
    minuscule.includes('permission')
  ) {
    return sessionRequise();
  }
  if (
    statut === 400 ||
    statut === 404 ||
    minuscule.includes('not found') ||
    minuscule.includes('nosuchkey')
  ) {
    return refusFichierIntrouvable();
  }
  if (minuscule.includes('fetch') || minuscule.includes('network') || minuscule.includes('timeout')) {
    return erreurReseau(message || undefined);
  }
  return erreurServeur({
    statut_http: statut,
    reference: reference ?? (message || undefined),
    message: 'Le serveur n’a pas pu répondre à votre demande. Réessayez dans un instant.',
  });
}

/**
 * Lien TEMPORAIRE de consultation d'un document d'un bucket PRIVÉ.
 *
 * L'URL est TOUJOURS signée par Supabase Storage : aucun écran ne construit de
 * lien depuis un chemin de stockage (`UrlFichierConsulte`). Un chemin vide rend
 * `FICHIER_INTROUVABLE`, un document absent aussi (le refus standard).
 */
export async function getSignedUrl(
  bucket: BucketStockage,
  chemin_stockage: string,
  expiresIn: number = DUREE_LIEN_SIGNE_SECONDES,
): Promise<Result<UrlFichierConsulte>> {
  const chemin = chemin_stockage.trim();
  if (!chemin) {
    return refusFichierIntrouvable();
  }
  if (!estSupabaseConfigure()) {
    return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
  }

  try {
    const { data, error } = await getSupabaseClient()
      .storage.from(bucket)
      .createSignedUrl(cheminDansBucket(bucket, chemin), expiresIn);
    if (error) {
      return classerErreurStorage(error);
    }
    if (!data?.signedUrl) {
      return erreurServeur({
        message: 'Le serveur n’a pas renvoyé de lien de consultation. Réessayez dans un instant.',
      });
    }
    return ok({ url: data.signedUrl, chemin_stockage: chemin });
  } catch (cause) {
    return erreurReseau(texteDe(cause));
  }
}

/**
 * Supprime un objet d'un bucket privé (fichier envoyé par erreur, remplacement
 * d'un document : le nouveau fichier est ensuite téléversé avec `remplacer`).
 *
 * Un objet déjà absent rend `FICHIER_INTROUVABLE` (aucune suppression silencieuse
 * d'un chemin inconnu).
 */
export async function removeFile(
  bucket: BucketStockage,
  chemin_stockage: string,
): Promise<Result<true>> {
  const chemin = chemin_stockage.trim();
  if (!chemin) {
    return refusFichierIntrouvable();
  }
  if (!estSupabaseConfigure()) {
    return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
  }

  try {
    const { data, error } = await getSupabaseClient()
      .storage.from(bucket)
      .remove([cheminDansBucket(bucket, chemin)]);
    if (error) {
      return classerErreurStorage(error);
    }
    if (!data || data.length === 0) {
      return refusFichierIntrouvable();
    }
    return ok(true);
  } catch (cause) {
    return erreurReseau(texteDe(cause));
  }
}
