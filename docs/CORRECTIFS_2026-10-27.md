# Correctifs de l'audit du 27/10/2026

Ce document remplace les constats périmés de `AUDIT.md` (30/09). L'intégration MVola n'est PAS
mise en place : les routes `/v1/paiements` répondent toujours 503, par conception.

## Corrigé

| # | Problème | Correction | Vérification |
|---|----------|------------|--------------|
| 1 | Une URL mal encodée (`/v1/suivi/%E0%A4%A`) arrêtait tout le serveur | Garde globale par requête, décodage tolérant (400), `unhandledRejection` journalisé | Reproduit puis corrigé sur un vrai processus ; 4 tests |
| 2 | Pièces d'identité lisibles/déposables par la clé anonyme (politiques `to public`) | Migration `0010_verrouillage_stockage.sql` ; politiques retirées de `SCHEMA_DB.md` ; chemins des membres préfixés par leur identifiant (`storage.ts`) | Migration jouée sur PostgreSQL 16 avec rôles anonyme / membre A / membre B / agent |
| 3 | `ReferenceError` dans `documents-oeuvres.tsx` : dossier créé mais code de suivi perdu, CIN « brûlé » | Ajout de `definirIdentifiantsDossier` dans le hook | `tsc` : 0 erreur |
| 4 | Pas de limite sur création de dossier et codes de suivi (40 bits) | Limites par IP et verrouillage d'un dossier après 10 codes erronés par heure | 6 tests |
| 5 | Limite de téléversement basée sur l'IP du proxy | `TRUST_PROXY_HOPS` ; `X-Forwarded-For` ignoré si aucun proxy de confiance | Test dédié |
| 6 | Code de suivi et historique des dossiers en clair (`AsyncStorage`) | `expo-secure-store`, avec migration automatique de l'ancien contenu | `tsc` + bundle Android |
| 7 | Écritures dans un `setState` (brouillon) | Un seul `useEffect` de persistance | `tsc` |
| 8 | `console.log` de l'URL audio résolue | Supprimé | — |
| 9 | Détail des contraintes SQL exposé dans les 409 | Retiré | — |
| 10 | `bundleIdentifier` / `package` absents, textes de permission iOS | `mg.omda.mobile` (à changer si besoin), plugin `expo-image-picker`, caméra/micro désactivés | `expo config`, bundle Android |
| 11 | `.env.example` manquant | Ajouté, serveur et limites documentés | — |

Résultats : `tsc` 0 erreur · tests serveur 30/30 · bundle Android OK.

## À faire pour tester

1. **Supabase** : exécuter `supabase/migrations/0010_verrouillage_stockage.sql` (SQL Editor). Rejouable sans risque.
2. Copier `.env.example` en `.env`, compléter, puis `npx expo start -c`.
3. Serveur : `cd server && npm run dev` (variables dans `server/.env`, voir `.env.example`). Sur téléphone réel, `HOST=0.0.0.0` et l'IP du PC dans `EXPO_PUBLIC_API_BASE_URL`.
4. Les fichiers déposés par un membre AVANT cette migration, sous `oeuvres/brouillons/…`, ne sont plus lisibles par le membre (le personnel les lit toujours). Redéposez-les pour vos tests.

## Données de test à nettoyer

Le CIN et l'e-mail d'un candidat sont uniques : un dossier de test abandonné bloque une nouvelle tentative avec les mêmes données (409). Dans le SQL Editor :

```sql
-- Supprime les dossiers de test jamais envoyés (statut BROUILLON) et leurs candidats orphelins
delete from public.demande_adhesion where statut = 'BROUILLON';
delete from public.candidat c where not exists (select 1 from public.demande_adhesion d where d.candidat_id = c.id)
                                  and not exists (select 1 from public.membre m where m.candidat_id = c.id);
```

## Reste à faire (hors périmètre de ce lot)

- Intégration MVola (volontairement non faite).
- Création candidat + demande en une seule fonction SQL transactionnelle (aujourd'hui : annulation « au mieux »).
- `doit_changer_mot_de_passe` n'est imposé que par l'interface : le trigger laisse le membre le remettre à `false`.
- `npm audit` : 13 alertes transitives (outils Expo), à traiter à la prochaine montée de version d'Expo.
- Tests automatisés côté application, ESLint et intégration continue ; découpage des fichiers de plus de 1 000 lignes.
- Archiver `docs/PROGRESS.md` (232 Ko).
