import type { HorodatageISO, TailleOctets, TypeMime, UUID } from './common';
import type { StatutDemande, TypePiece } from './enums';

/**
 * Demande d'adhésion — table `demande_adhesion`.
 *
 * ⚠️ `jeton_suivi_hash` est le HACHAGE du code de suivi : il ne doit jamais
 * être transmis au mobile. Le candidat ne reçoit le code de suivi en clair
 * qu'une seule fois, au moment de l'envoi de sa demande (écran L).
 *
 * Règles portées par le schéma :
 * - `motif_rejet` obligatoire si `statut = 'REJETEE'` ;
 * - paiement possible uniquement si `statut = 'VALIDEE'`.
 */
export type DemandeAdhesion = {
  id: UUID;
  numero_dossier: string;
  jeton_suivi_hash: string;
  candidat_id: UUID;
  membre_id: UUID | null;
  categorie_id: UUID;
  statut: StatutDemande;
  motif_rejet: string | null;
  date_soumission: HorodatageISO | null;
  date_decision: HorodatageISO | null;
  agent_id: UUID | null;
  created_at: HorodatageISO;
  updated_at: HorodatageISO;
};

/**
 * Pièce justificative d'une demande — table `piece`.
 * Bucket de stockage `pieces`, 20 Mo maximum par fichier.
 */
export type Piece = {
  id: UUID;
  demande_adhesion_id: UUID;
  type: TypePiece;
  chemin_stockage: string;
  mime_type: TypeMime;
  taille_octets: TailleOctets;
  created_at: HorodatageISO;
};
