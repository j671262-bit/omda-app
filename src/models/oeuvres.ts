import type { HorodatageISO, TailleOctets, TypeMime, UUID } from './common';
import type { StatutOeuvre } from './enums';

/**
 * Œuvre déposée — table `oeuvre`.
 *
 * Règles métier portées par le schéma :
 * - une œuvre appartient soit à une demande d'adhésion, soit à un membre
 *   (`oeuvre_contexte_chk`) ;
 * - `motif_rejet` obligatoire si `statut = 'REJETEE'` ;
 * - l'envoi (`ENVOYEE`) ne déclenche AUCUN paiement : le paiement n'est
 *   proposé qu'après `VALIDEE`, puis `DEPOT_FINALISE` après confirmation.
 */
export type Oeuvre = {
  id: UUID;
  membre_id: UUID | null;
  demande_adhesion_id: UUID | null;
  categorie_id: UUID;
  titre: string;
  description: string | null;
  annee: number | null;
  statut: StatutOeuvre;
  motif_rejet: string | null;
  chemin_fichier: string | null;
  mime_type: TypeMime | null;
  taille_octets: TailleOctets | null;
  date_soumission: HorodatageISO | null;
  date_decision: HorodatageISO | null;
  agent_id: UUID | null;
  created_at: HorodatageISO;
  updated_at: HorodatageISO;
};

/** Attestation de diffusion liée à une œuvre — table `attestation_diffusion`. 
 * Obligatoire selon la règle métier 3 (cas A et B pour le parcours candidat,
 * non obligatoire pour le cas C : dépôt dans une catégorie déjà détenue).
 * Distincte de la fiche de déclaration (règle 4).
 */
export type AttestationDiffusion = {
  id: UUID;
  oeuvre_id: UUID;
  chemin_stockage: string;
  mime_type: TypeMime;
  taille_octets: TailleOctets;
  created_at: HorodatageISO;
};

/** Fiche de déclaration d'œuvre liée à une œuvre — table `fiche_declaration`.
 * Obligatoire pour chaque œuvre (règle métier 2).
 * Le modèle dépend de la catégorie de l'œuvre.
 * Distincte de l'attestation de diffusion (règle 4).
 */
export type FicheDeclaration = {
  id: UUID;
  oeuvre_id: UUID;
  chemin_stockage: string;
  mime_type: TypeMime;
  taille_octets: TailleOctets;
  created_at: HorodatageISO;
};
