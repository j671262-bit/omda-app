import { TYPES_MIME_AUTORISES } from '../models';

/**
 * Aides d'affichage des documents DÉJÀ STOCKÉS (œuvre, attestation de diffusion) :
 * nature audio du fichier, taille lisible, chronomètre d'écoute.
 *
 * ⚠️ Aucun lien n'est fabriqué ici et aucun fichier n'est OUVERT depuis ce
 * module : un document déposé s'écoute DANS l'application (`AudioPreview`) et le
 * lien temporaire vient TOUJOURS du service
 * (`MemberRepository.obtenirUrlFichier`).
 */

/** Types MIME audio du bucket `oeuvres` (dérivés du schéma, jamais recopiés). */
const TYPES_MIME_AUDIO: readonly string[] = TYPES_MIME_AUTORISES.oeuvres.filter((mime) =>
  mime.startsWith('audio/'),
);

/** Une œuvre est-elle un fichier audio (donc écoutable dans l'application) ? */
export function estFichierAudio(mimeType: string | null | undefined): boolean {
  if (!mimeType) {
    return false;
  }
  return TYPES_MIME_AUDIO.includes(mimeType);
}

/** Taille lisible par l'utilisateur (Mo, une décimale), format des écrans de dépôt. */
export function formaterTailleFichier(octets: number): string {
  return `${(octets / 1048576).toFixed(1)} Mo`;
}

/** Chronomètre d'écoute au format `m:ss` (ou `h:mm:ss` au-delà d'une heure). */
export function formaterDuree(secondes: number): string {
  if (!Number.isFinite(secondes) || secondes <= 0) {
    return '0:00';
  }

  const total = Math.floor(secondes);
  const heures = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secondesTexte = String(total % 60).padStart(2, '0');

  if (heures > 0) {
    return `${heures}:${String(minutes).padStart(2, '0')}:${secondesTexte}`;
  }

  return `${minutes}:${secondesTexte}`;
}


