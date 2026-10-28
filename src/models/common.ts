/**
 * Types utilitaires partagés par tous les modèles.
 *
 * Les modèles reflètent FIDÈLEMENT le schéma PostgreSQL (`docs/SCHEMA_DB.md`) :
 * - noms de champs en snake_case (comme les colonnes) ;
 * - nullabilité identique aux colonnes (`date_soumission: HorodatageISO | null`).
 *
 * Aucune logique métier ici : uniquement des types et des constantes de schéma.
 */

/** Colonne `uuid` (clé primaire générée par `gen_random_uuid()`). */
export type UUID = string;

/** Colonne `timestamptz` sérialisée en ISO 8601 (ex. « 2026-09-24T10:15:30.000Z »). */
export type HorodatageISO = string;

/** Colonne `date` (ex. « 1990-05-12 »). */
export type DateISO = string;

/** Colonne `integer` : montant en Ariary (grain 1 Ar, jamais de centimes). */
export type MontantAriary = number;

/** Colonne `integer` : taille d'un fichier en octets. */
export type TailleOctets = number;

/** Colonne `char(3)` : code devise ISO 4217. */
export type CodeDevise = string;

/** Devise unique de l'application (Ariary). */
export const CODE_DEVISE_MGA = 'MGA' as const;

/** Symbole d'affichage de la devise. */
export const SYMBOLE_DEVISE_AR = 'Ar' as const;

/** Limite imposée par le schéma : `CHECK (taille_octets <= 20971520)`. */
export const TAILLE_MAX_FICHIER_OCTETS = 20971520; // 20 Mo

/** Limite de taille en mégaoctets (affichage utilisateur). */
export const TAILLE_MAX_FICHIER_MO = 20;

/** Types MIME autorisés par bucket de stockage (cf. `SCHEMA_DB.md`). */
export const TYPES_MIME_AUTORISES = {
  pieces: ['image/jpeg', 'image/png', 'application/pdf'],
  oeuvres: ['audio/mpeg', 'audio/wav', 'application/pdf', 'image/jpeg', 'image/png'],
} as const;

/**
 * Règle métier 8 : l'attestation de diffusion d'une œuvre est un DOCUMENT —
 * PDF, JPEG ou PNG uniquement. L'audio (MP3 / WAV) reste réservé au fichier de
 * l'œuvre lui-même, jamais à son attestation.
 */
export const TYPES_MIME_ATTESTATION = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/** Buckets Supabase Storage déclarés dans le schéma. */
export const BUCKETS_STOCKAGE = ['pieces', 'oeuvres'] as const;
export type BucketStockage = (typeof BUCKETS_STOCKAGE)[number];

/** Types MIME autorisés (union des buckets). */
export type TypeMime = (typeof TYPES_MIME_AUTORISES)[BucketStockage][number];
