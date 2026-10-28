/**
 * Couche Supabase réelle — barrel (voir `src/services/factory.ts` et
 * `docs/BRANCHEMENT.md`).
 */
export * from './client';
export { SupabaseAuthService } from './SupabaseAuthService';
export { SupabaseMemberRepository } from './SupabaseMemberRepository';
export { SupabasePublicContentService } from './SupabasePublicContentService';
