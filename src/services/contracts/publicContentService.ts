import type {
  Categorie,
  Documentation,
  MontantAriary,
  OperateurMobileMoney,
  Tarif,
  TypeOperationTarif,
  UUID,
} from '../../models';
import type { Result } from './result';

/**
 * Contrat des contenus PUBLICS (visiteur sans compte).
 *
 * Toutes les valeurs affichées (catégories, tarifs, opérateurs Mobile Money,
 * articles) proviennent d'ici : rien n'est codé en dur dans l'UI.
 * Implémentation : `SupabasePublicContentService` (lecture Supabase).
 */
export interface PublicContentService {
  /** Articles de documentation publiés, triés par `ordre`. */
  listerDocumentation(): Promise<Result<Documentation[]>>;

  /** Détail d'un article par son `slug`. */
  obtenirArticle(slug: string): Promise<Result<Documentation>>;

  /** Catégories ACTIVES proposables à l'adhésion. */
  listerCategories(): Promise<Result<Categorie[]>>;

  /** Grille tarifaire courante (actifs uniquement, filtrable par opération). */
  listerTarifs(entree?: ListerTarifsEntree): Promise<Result<Tarif[]>>;

  /** Estimation dynamique du montant (écran Tarifs / simulateur). */
  estimerMontant(entree: EstimationMontantEntree): Promise<Result<EstimationMontant>>;

  /** Opérateurs Mobile Money ACTIFS (un opérateur désactivé est absent). */
  listerOperateursMobileMoney(): Promise<Result<OperateurMobileMoney[]>>;
}

export type ListerTarifsEntree = {
  type_operation?: TypeOperationTarif;
  categorie_id?: UUID | null;
};

export type EstimationMontantEntree = {
  type_operation: TypeOperationTarif;
  /** Obligatoire lorsque le tarif dépend de la catégorie. */
  categorie_id?: UUID | null;
};

/**
 * Résultat du simulateur.
 * ⚠️ `estimation = true` : le montant définitif est confirmé par le serveur
 * au moment du paiement (mention obligatoire dans l'UI).
 */
export type EstimationMontant = {
  type_operation: TypeOperationTarif;
  categorie_id: UUID | null;
  montant: MontantAriary;
  devise: string;
  estimation: boolean;
  mention: string;
  /** Date de validité du tarif appliqué, si connue. */
  valide_jusqu_au: string | null;
};
