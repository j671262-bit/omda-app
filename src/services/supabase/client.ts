/**
 * Client Supabase (Auth + DB + Storage) — étape 17 « préparer le branchement ».
 *
 * Le client n'est créé qu'au premier appel, et seulement si les deux variables
 * d'environnement sont renseignées (cf. `docs/BRANCHEMENT.md`). L'import du
 * module ne lève JAMAIS d'exception, même sans configuration.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

/** URL du projet Supabase (`EXPO_PUBLIC_SUPABASE_URL`). */
export const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();

/** Clé publique anonyme (`EXPO_PUBLIC_SUPABASE_ANON_KEY`). */
export const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

/** Clé de stockage de la session dans le trousseau sécurisé du téléphone. */
export const CLE_SESSION_SECURISEE = 'omda-session-supabase';

/**
 * Stockage chiffré de la session (`expo-secure-store` : trousseau iOS /
 * Keystore Android). Le jeton d'accès ne transite donc jamais en clair dans
 * AsyncStorage.
 */
export const stockageSessionSecurise = {
  getItem: (cle: string): Promise<string | null> => SecureStore.getItemAsync(cle),
  setItem: (cle: string, valeur: string): Promise<void> => SecureStore.setItemAsync(cle, valeur),
  removeItem: (cle: string): Promise<void> => SecureStore.deleteItemAsync(cle),
};

/** Vrai dès que l'URL et la clé anonyme sont renseignées. */
export function estSupabaseConfigure(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

/** Message affiché lorsque Supabase n'est pas configuré (mode réel activé par erreur). */
export const MESSAGE_SUPABASE_NON_CONFIGURE =
  'Supabase n’est pas configuré : renseignez EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY (voir docs/BRANCHEMENT.md).';

let client: SupabaseClient | null = null;

/**
 * Client Supabase partagé (singleton paresseux).
 *
 * Créé au PREMIER usage réel : la configuration n'est donc exigée qu'à l'usage. Session persistée dans `expo-secure-store`,
 * rafraîchissement automatique du jeton activé, détection d'URL désactivée
 * (application mobile sans deep-link de récupération).
 */
export function getSupabaseClient(): SupabaseClient {
  if (!estSupabaseConfigure()) {
    throw new Error(MESSAGE_SUPABASE_NON_CONFIGURE);
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: stockageSessionSecurise,
        storageKey: CLE_SESSION_SECURISEE,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
