/**
 * Validation des fichiers téléversés : contrôle LOCAL effectué avant tout
 * envoi vers le service (les mêmes règles sont revalidées côté « serveur »).
 *
 * Règle métier 8 : une attestation de diffusion est un DOCUMENT (PDF, JPEG ou
 * PNG). Un fichier audio est explicitement refusé pour une attestation, alors
 * qu'il reste accepté comme fichier de l'œuvre (bucket `oeuvres`).
 */

import { TAILLE_MAX_FICHIER_MO, TYPES_MIME_ATTESTATION } from '../models';

/** Formats autorisés pour une attestation de diffusion (jamais d'audio). */
export const TYPES_MIME_ATTESTATION_AUTORISES: readonly string[] = TYPES_MIME_ATTESTATION;

/** Libellé utilisateur des formats d'attestation acceptés. */
export const LIBELLE_FORMATS_ATTESTATION = 'PDF, JPEG, PNG';

/** Aide affichée sous le champ « Attestation de diffusion ». */
export const AIDE_ATTESTATION_FORMATS = `Formats : ${LIBELLE_FORMATS_ATTESTATION} — ${TAILLE_MAX_FICHIER_MO} Mo max.`;

/** Message exact affiché lorsque le format choisi n'est pas supporté. */
export const MESSAGE_ATTESTATION_FORMAT_INVALIDE =
  'Format non supporté. Formats autorisés : PDF, JPEG, PNG.';

/**
 * Un type MIME est-il autorisé pour une attestation de diffusion ?
 *
 * `image/jpg` est toléré comme alias de `image/jpeg` (certains téléphones
 * renvoient cet ancien libellé), tout comme `deduireMime` le normalise déjà.
 */
export function isAllowedAttestationMime(mime: string | null | undefined): boolean {
  const propre = (mime ?? '').trim().toLowerCase();
  const normalise = propre === 'image/jpg' ? 'image/jpeg' : propre;
  return TYPES_MIME_ATTESTATION_AUTORISES.includes(normalise);
}
