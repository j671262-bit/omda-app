import type { BucketStockage, TailleOctets, TypeMime } from '../../models';

/**
 * Types communs de téléversement vers les buckets privés Supabase Storage.
 *
 * Partagés par les deux contrats qui téléversent des fichiers :
 * - parcours candidat (`CandidateApi`, via l'API REST) ;
 * - espace membre (`MemberRepository`, via Supabase Storage).
 *
 * Limites imposées par le schéma : 20 Mo maximum par fichier et types MIME
 * restreints selon le bucket (`TYPES_MIME_AUTORISES`).
 */

/** Référence vers un fichier DÉJÀ téléversé (aucun binaire dans l'objet). */
export type FichierDepose = {
  chemin_stockage: string;
  mime_type: TypeMime;
  taille_octets: TailleOctets;
};

export type TeleversementEntree = {
  bucket: BucketStockage;
  /** Chemin cible dans le bucket (fourni par le serveur ou par l'appelant). */
  chemin_stockage: string;
  /** URI locale du fichier sélectionné (expo-image-picker / expo-document-picker). */
  fichier_uri: string;
  nom_fichier: string;
  mime_type: TypeMime;
  taille_octets: TailleOctets;
};

export type OptionsTeleversement = {
  /** Progression 0 → 100 (alimente `UploadTile`). */
  onProgression?: (pourcentage: number) => void;
  /** Permet d'annuler un envoi en cours (bouton « Annuler »). */
  signal?: AbortSignal;
};

export type FichierTeleverse = {
  chemin_stockage: string;
  mime_type: TypeMime;
  taille_octets: TailleOctets;
};
