import type { DateISO, HorodatageISO, UUID } from './common';
import type {
  RoleUtilisateur,
  StatutAdhesionCategorie,
  StatutUtilisateur,
} from './enums';

/**
 * Compte applicatif — table `utilisateur`.
 *
 * ⚠️ La colonne `mot_de_passe_hash` est supprimée par le schéma final
 * (`ALTER TABLE ... DROP COLUMN IF EXISTS mot_de_passe_hash`) : l'authentification
 * est déléguée à Supabase Auth (`auth.users`, lié par `id`).
 */
export type Utilisateur = {
  id: UUID;
  email: string;
  telephone: string | null;
  role: RoleUtilisateur;
  statut: StatutUtilisateur;
  /** Règle métier 10 : changement de mot de passe imposé à la première connexion. */
  doit_changer_mot_de_passe: boolean;
  derniere_connexion_at: HorodatageISO | null;
  created_at: HorodatageISO;
  updated_at: HorodatageISO;
};

/**
 * Personne ayant déposé une demande d'adhésion — table `candidat`.
 * Un candidat n'a pas forcément de compte (`utilisateur_id` peut être NULL) :
 * le suivi public se fait par numéro de dossier + code de suivi.
 * Contrainte : `date_naissance <= CURRENT_DATE - 15 years` (refus des moins de 15 ans).
 */
export type Candidat = {
  id: UUID;
  nom: string;
  prenom: string;
  cin: string;
  date_naissance: DateISO;
  telephone: string;
  email: string;
  adresse: string;
  utilisateur_id: UUID | null;
  created_at: HorodatageISO;
  updated_at: HorodatageISO;
};

/**
 * Adhérent — table `membre`.
 * Créé uniquement après une adhésion finalisée (validation + paiement confirmé).
 */
export type Membre = {
  id: UUID;
  utilisateur_id: UUID;
  candidat_id: UUID;
  numero_adherent: string;
  statut: StatutUtilisateur;
  created_at: HorodatageISO;
  updated_at: HorodatageISO;
};

/**
 * Catégories d'un membre — table `membre_categorie`.
 * Un membre peut cumuler une catégorie principale et des catégories
 * supplémentaires (`UNIQUE (membre_id, categorie_id)`).
 */
export type MembreCategorie = {
  id: UUID;
  membre_id: UUID;
  categorie_id: UUID;
  demande_adhesion_id: UUID | null;
  statut: StatutAdhesionCategorie;
  date_activation: HorodatageISO;
};
