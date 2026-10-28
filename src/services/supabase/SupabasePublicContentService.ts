/**
 * `PublicContentService` réel (Supabase, lecture seule).
 *
 * Tables lues (`docs/SCHEMA_DB.md`, migration `0004`) : `documentation`,
 * `categorie`, `tarif`, `operateur_mobile_money`. Aucune valeur n'est codée en
 * dur : un élément désactivé (`actif = false`, `publie = false`) ou un tarif hors
 * de sa période de validité est ABSENT des résultats, jamais affiché puis grisé.
 *
 * Ces lectures sont publiques (rôle `anon`) : elles ne dépendent d'aucune
 * session. Aucune exception ne remonte à l'UI, tout est rendu en `Result`.
 */
import type { PostgrestError } from '@supabase/supabase-js';

import type {
  Categorie,
  Documentation,
  OperateurMobileMoney,
  Tarif,
  TypeOperationTarif,
  UUID,
} from '../../models';
import {
  CODES_ERREUR_DONNEES,
  erreurMetier,
  erreurReseau,
  erreurServeur,
  MENTION_ESTIMATION,
  ok,
  type EstimationMontant,
  type EstimationMontantEntree,
  type ListerTarifsEntree,
  type PublicContentService,
  type Result,
  type ResultErr,
} from '../contracts';
import { estSupabaseConfigure, getSupabaseClient, MESSAGE_SUPABASE_NON_CONFIGURE } from './client';

/* --------------------------------------------------------------- Helpers */

function texteDe(cause: unknown): string | undefined {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === 'string') {
    return cause;
  }
  return undefined;
}

/** Erreur de requête PostgREST → `reseau` (transport) ou `serveur` (le reste). */
function classerErreurPublique(error: PostgrestError): ResultErr {
  const message = (error.message ?? '').toLowerCase();
  if (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('failed')
  ) {
    return erreurReseau(error.message || undefined);
  }
  return erreurServeur({ reference: error.code || undefined });
}

/** Date du jour au format `AAAA-MM-JJ` (fuseau local de l'appareil). */
function dateDuJour(): string {
  const maintenant = new Date();
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  const jour = String(maintenant.getDate()).padStart(2, '0');
  return `${maintenant.getFullYear()}-${mois}-${jour}`;
}

/** Un tarif est applicable aujourd'hui : actif et dans sa période de validité. */
function tarifEnVigueur(tarif: Tarif, aujourdHui: string): boolean {
  if (!tarif.actif) {
    return false;
  }
  if (tarif.date_debut && tarif.date_debut > aujourdHui) {
    return false;
  }
  if (tarif.date_fin && tarif.date_fin < aujourdHui) {
    return false;
  }
  return true;
}

/**
 * Tarif applicable à une opération : celui de la catégorie si elle en a un,
 * sinon le tarif général (`categorie_id` nul) — uniquement lorsqu'une catégorie
 * est précisée. `null` = aucun tarif disponible.
 */
function choisirTarif(
  tarifs: Tarif[],
  categorieId: UUID | null,
  aujourdHui: string,
): Tarif | null {
  const candidats = tarifs.filter((tarif) => tarifEnVigueur(tarif, aujourdHui));
  const specifique = candidats.find((tarif) => tarif.categorie_id === categorieId) ?? null;
  if (specifique) {
    return specifique;
  }
  if (categorieId === null) {
    return null;
  }
  return candidats.find((tarif) => tarif.categorie_id === null) ?? null;
}

/**
 * Tarif en vigueur d'une opération (réutilisé par le dépôt membre pour le
 * montant d'un paiement). `ok(null)` = aucun tarif ; la décision métier
 * (`TARIF_INDISPONIBLE`) appartient à l'appelant.
 */
export async function rechercherTarifApplique(
  typeOperation: TypeOperationTarif,
  categorieId: UUID | null,
): Promise<Result<Tarif | null>> {
  if (!estSupabaseConfigure()) {
    return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
  }
  try {
    const reponse = await getSupabaseClient()
      .from('tarif')
      .select('*')
      .eq('type_operation', typeOperation)
      .eq('actif', true);
    if (reponse.error) {
      return classerErreurPublique(reponse.error);
    }
    return ok(choisirTarif((reponse.data ?? []) as Tarif[], categorieId, dateDuJour()));
  } catch (cause) {
    return erreurReseau(texteDe(cause));
  }
}

/** Un opérateur Mobile Money est-il actif au référentiel ? */
export async function operateurMobileMoneyActif(code: string): Promise<Result<boolean>> {
  if (!estSupabaseConfigure()) {
    return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
  }
  try {
    const reponse = await getSupabaseClient()
      .from('operateur_mobile_money')
      .select('code')
      .eq('code', code)
      .eq('actif', true)
      .maybeSingle();
    if (reponse.error) {
      return classerErreurPublique(reponse.error);
    }
    return ok(reponse.data !== null);
  } catch (cause) {
    return erreurReseau(texteDe(cause));
  }
}

/* --------------------------------------------------------------- Service */

export class SupabasePublicContentService implements PublicContentService {
  /** Articles publiés, triés par `ordre`. */
  async listerDocumentation(): Promise<Result<Documentation[]>> {
    if (!estSupabaseConfigure()) {
      return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
    }
    try {
      const reponse = await getSupabaseClient()
        .from('documentation')
        .select('*')
        .eq('publie', true)
        .order('ordre', { ascending: true });
      if (reponse.error) {
        return classerErreurPublique(reponse.error);
      }
      return ok((reponse.data ?? []) as Documentation[]);
    } catch (cause) {
      return erreurReseau(texteDe(cause));
    }
  }

  /** Détail d'un article publié ; code `ARTICLE_INTROUVABLE` sinon. */
  async obtenirArticle(slug: string): Promise<Result<Documentation>> {
    if (!estSupabaseConfigure()) {
      return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
    }
    try {
      const reponse = await getSupabaseClient()
        .from('documentation')
        .select('*')
        .eq('slug', slug.trim().toLowerCase())
        .eq('publie', true)
        .maybeSingle();
      if (reponse.error) {
        return classerErreurPublique(reponse.error);
      }
      if (!reponse.data) {
        return erreurMetier(
          CODES_ERREUR_DONNEES.ARTICLE_INTROUVABLE,
          'Cet article n’est pas disponible. Revenez à la liste de la documentation.',
        );
      }
      return ok(reponse.data as Documentation);
    } catch (cause) {
      return erreurReseau(texteDe(cause));
    }
  }

  /** Catégories actives uniquement, triées par libellé. */
  async listerCategories(): Promise<Result<Categorie[]>> {
    if (!estSupabaseConfigure()) {
      return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
    }
    try {
      const reponse = await getSupabaseClient()
        .from('categorie')
        .select('*')
        .eq('actif', true)
        .order('libelle', { ascending: true });
      if (reponse.error) {
        return classerErreurPublique(reponse.error);
      }
      return ok((reponse.data ?? []) as Categorie[]);
    } catch (cause) {
      return erreurReseau(texteDe(cause));
    }
  }

  /** Grille tarifaire en vigueur, filtrable par opération et par catégorie. */
  async listerTarifs(entree?: ListerTarifsEntree): Promise<Result<Tarif[]>> {
    if (!estSupabaseConfigure()) {
      return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
    }
    try {
      let requete = getSupabaseClient().from('tarif').select('*').eq('actif', true);
      if (entree?.type_operation) {
        requete = requete.eq('type_operation', entree.type_operation);
      }
      if (entree?.categorie_id !== undefined) {
        requete =
          entree.categorie_id === null
            ? requete.is('categorie_id', null)
            : requete.eq('categorie_id', entree.categorie_id);
      }
      const reponse = await requete;
      if (reponse.error) {
        return classerErreurPublique(reponse.error);
      }
      const aujourdHui = dateDuJour();
      return ok(((reponse.data ?? []) as Tarif[]).filter((tarif) => tarifEnVigueur(tarif, aujourdHui)));
    } catch (cause) {
      return erreurReseau(texteDe(cause));
    }
  }

  /**
   * Estimation dynamique : montant issu de la grille tarifaire, jamais calculé
   * ni codé en dur. `estimation = true` + mention obligatoire.
   */
  async estimerMontant(entree: EstimationMontantEntree): Promise<Result<EstimationMontant>> {
    const categorieId = entree.categorie_id ?? null;
    const recherche = await rechercherTarifApplique(entree.type_operation, categorieId);
    if (!recherche.ok) {
      return recherche;
    }
    const tarif = recherche.valeur;
    if (!tarif) {
      return erreurMetier(
        CODES_ERREUR_DONNEES.TARIF_INDISPONIBLE,
        'Aucun tarif n’est disponible pour cette opération. Veuillez réessayer plus tard.',
      );
    }
    return ok({
      type_operation: entree.type_operation,
      categorie_id: categorieId,
      montant: tarif.montant,
      devise: tarif.devise,
      estimation: true,
      mention: MENTION_ESTIMATION,
      valide_jusqu_au: tarif.date_fin,
    });
  }

  /** Opérateurs Mobile Money actifs, triés par `ordre`. */
  async listerOperateursMobileMoney(): Promise<Result<OperateurMobileMoney[]>> {
    if (!estSupabaseConfigure()) {
      return erreurServeur({ message: MESSAGE_SUPABASE_NON_CONFIGURE });
    }
    try {
      const reponse = await getSupabaseClient()
        .from('operateur_mobile_money')
        .select('*')
        .eq('actif', true)
        .order('ordre', { ascending: true });
      if (reponse.error) {
        return classerErreurPublique(reponse.error);
      }
      return ok((reponse.data ?? []) as OperateurMobileMoney[]);
    } catch (cause) {
      return erreurReseau(texteDe(cause));
    }
  }
}
