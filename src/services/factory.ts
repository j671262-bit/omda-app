/**
 * Fabrique de services — point d'entrée UNIQUE de la couche data.
 *
 * L'application n'utilise que des services RÉELS (aucun mode démonstration) :
 *
 * | Singleton exporté      | Implémentation                                  |
 * |---|---|
 * | `authService`          | `SupabaseAuthService` (Supabase Auth)           |
 * | `memberRepository`     | `SupabaseMemberRepository` (DB + Storage)       |
 * | `publicContentService` | `SupabasePublicContentService` (lecture seule)  |
 * | `candidateApi`         | `HttpCandidateApi` (API REST Express)           |
 *
 * Configuration requise (`.env`, voir `docs/BRANCHEMENT.md`) :
 * - `EXPO_PUBLIC_SUPABASE_URL` et `EXPO_PUBLIC_SUPABASE_ANON_KEY` ;
 * - `EXPO_PUBLIC_API_BASE_URL` (API candidat).
 *
 * Une configuration absente ne fait jamais planter le démarrage : le client
 * Supabase est PARESSEUX (`getSupabaseClient()` au premier appel) et
 * `HttpCandidateApi` renvoie un `Result` `serveur` explicite (« L'API OMDA n'est
 * pas configurée… ») sans exception ni appel réseau. Aucun repli sur de fausses
 * données n'existe.
 *
 * ⚠️ Les variables sont lues STATIQUEMENT (`process.env.EXPO_PUBLIC_…`) : c'est
 * la seule forme remplacée à la compilation par Expo.
 */
import type { AuthService, CandidateApi, MemberRepository, PublicContentService } from './contracts';
import { HttpCandidateApi } from './http/HttpCandidateApi';
import {
  SupabaseAuthService,
  SupabaseMemberRepository,
  SupabasePublicContentService,
} from './supabase';

/** URL de l'API REST candidat (`EXPO_PUBLIC_API_BASE_URL`), vide si non configurée. */
const API_BASE_URL_CANDIDAT = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim();

/**
 * Vrai si l'API REST du parcours candidat est renseignée (`EXPO_PUBLIC_API_BASE_URL`).
 * Diagnostic seul (écran de développement `/dev/env`).
 */
export function estApiCandidatConfiguree(): boolean {
  return API_BASE_URL_CANDIDAT.length > 0;
}

/** Authentification du membre (Supabase Auth). */
export const authService: AuthService = new SupabaseAuthService();

/** Accès aux données du membre connecté (Supabase DB + Storage). */
export const memberRepository: MemberRepository = new SupabaseMemberRepository();

/** Contenus publics : documentation, catégories, tarifs, opérateurs (Supabase, lecture seule). */
export const publicContentService: PublicContentService = new SupabasePublicContentService();

/** API candidate : parcours d'adhésion, suivi et paiement (API REST Express). */
export const candidateApi: CandidateApi = new HttpCandidateApi();
