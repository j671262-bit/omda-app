import type { CodeDevise, DateISO, HorodatageISO, MontantAriary, UUID } from './common';
import type { OperateurPaiement, TypeOperationTarif } from './enums';

/** Référentiel des catégories d'adhésion — table `categorie`. */
export type Categorie = {
  id: UUID;
  /** Identifiant métier stable (unique). */
  code: string;
  libelle: string;
  description: string | null;
  actif: boolean;
  created_at: HorodatageISO;
  updated_at: HorodatageISO;
};

/**
 * Grille tarifaire — table `tarif`.
 * Un seul tarif actif par couple (type_operation, categorie_id) : index
 * `tarif_actif_unique`. Les montants viennent donc TOUJOURS d'ici (jamais de
 * montant codé en dur dans l'UI).
 */
export type Tarif = {
  id: UUID;
  type_operation: TypeOperationTarif;
  categorie_id: UUID | null;
  montant: MontantAriary;
  devise: CodeDevise;
  actif: boolean;
  date_debut: DateISO | null;
  date_fin: DateISO | null;
  created_at: HorodatageISO;
  updated_at: HorodatageISO;
};

/** Article de documentation — table `documentation`. */
export type Documentation = {
  id: UUID;
  slug: string;
  titre: string;
  contenu: string;
  ordre: number;
  publie: boolean;
  updated_at: HorodatageISO;
};

/**
 * Opérateurs Mobile Money — table `operateur_mobile_money` (addendum).
 * La liste affichée doit être filtrée sur `actif = TRUE` : un opérateur
 * désactivé côté serveur est absent de l'UI.
 */
export type OperateurMobileMoney = {
  code: OperateurPaiement;
  libelle: string;
  actif: boolean;
  ordre: number;
  updated_at: HorodatageISO;
};
