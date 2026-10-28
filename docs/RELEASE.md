# OMDA Mobile — Guide de release (EAS Build / Submit)

Ce document décrit la procédure de publication de l'application **OMDA** (Expo + EAS). Il ne change **aucune règle métier** : il documente uniquement la configuration de build, les variables d'environnement et les commandes.

## 1) Variables d'environnement (`EXPO_PUBLIC_*`)

Toutes les variables publiques sont préfixées `EXPO_PUBLIC_` et lues à la compilation du bundle (voir `docs/BRANCHEMENT.md` §1). L'application n'a plus de mode démonstration : les trois variables ci-dessous sont **requises** pour un build connecté.

| Variable | Rôle | Valeur de production (exemple) |
| --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | URL de base de l'API Express du parcours candidat (`HttpCandidateApi`), sans barre finale. **Vide ⇒ chaque appel du parcours candidat renvoie une erreur « API non configurée »** (aucun repli sur de fausses données). | `https://api-omda.example.org` |
| `EXPO_PUBLIC_SUPABASE_URL` | URL du projet Supabase (authentification, espace membre, contenus publics). | `https://xxxx.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Clé anon publique Supabase. | `eyJhbGciOi...` |

Modèle copiable : `.env.example` (racine du projet). Un `.env` local sert au développement ; **les valeurs embarquées dans un build EAS** proviennent de l'environnement EAS (voir §4) — ne jamais committer de secret réel, la clé anon est publique par conception.

## 2) Services utilisés

`src/services/factory.ts` instancie uniquement les services réels : `SupabaseAuthService`, `SupabaseMemberRepository`, `SupabasePublicContentService` et `HttpCandidateApi`. Aucun drapeau `EXPO_PUBLIC_USE_MOCKS*` n'existe plus.

Exemple `.env` de recette :

```bash
EXPO_PUBLIC_API_BASE_URL=https://api-omda.example.org
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

## 3) Prérequis EAS

1. Compte Expo : `npx eas-cli whoami` (sinon `npx eas-cli login`).
2. Lier le projet : déjà fait via `app.json` (`expo.name` = **OMDA**, `expo.slug` = **omda-mobile**, `expo.version` = **1.0.0**) ; `eas.json` (racine) définit les profils `development` / `preview` / `production`.
3. CLI : `eas.json` impose `cli.version` `>= 16.0.0` et `appVersionSource` `local` (le numéro de version vient de `app.json`).
4. Assets présents : `assets/icon.png`, `assets/splash.png`, `assets/android-icon-*.png`, `assets/favicon.png` (déjà référencés dans `app.json`, splash en `contain` sur fond `#F5F4EF`).
5. Android : keystore de signature (ou laisser EAS en générer un — demandé à la première construction `production`). iOS : compte Apple Developer requis pour `eas submit`.

## 4) Commandes EAS

Exécuter à la racine du projet :

```bash
# Connexion (une fois par machine)
npx eas-cli login

# Lister / vérifier les builds
npx eas-cli build:list

# Android — développement (development client, distribution interne)
npx eas-cli build --platform android --profile development

# Android — preview (APK interne pour recette hors store)
npx eas-cli build --platform android --profile preview

# Android — production (AAB Google Play, autoIncrement)
npx eas-cli build --platform android --profile production

# iOS — production (App Store, compte Apple Developer requis)
npx eas-cli build --platform ios --profile production

# Soumission aux stores
npx eas-cli submit --platform android --profile production
npx eas-cli submit --platform ios --profile production
```

Profils définis dans `eas.json` :

| Profil | Détails | Usage |
| --- | --- | --- |
| `development` | `developmentClient: true`, `distribution: "internal"` | Build de développement (expo-dev-client) installable en interne. |
| `preview` | `distribution: "internal"` (APK Android par défaut) | Recette sur appareil réel **sans** store — idéal pour `docs/TEST_PLAN.md`. |
| `production` | `autoIncrement: true` (version locale `app.json`) | Publication store (AAB / IPA). |

### Variables EAS pour un build connecté

Le bundle embarque les valeurs `EXPO_PUBLIC_*` présentes au moment de la construction. Deux méthodes :

1. **Bloc `"env"` dans `eas.json`** : ajouter à chaque profil un bloc `"env": { "EXPO_PUBLIC_...": "..." }` (valeurs à ne pas committer si elles sont sensibles — préférer les secrets Expo), ou
2. **Secrets EAS** : `npx eas-cli secret:create --name EXPO_PUBLIC_SUPABASE_URL --value https://....supabase.co` (idem pour les autres variables) — injectés par le CLI pendant le build.

Un build sans ces variables démarre, mais chaque appel de service renvoie une erreur de configuration explicite : déclarez-les toujours pour un build distribué.

## 5) Checklist avant release

1. `npx tsc --noEmit` → 0 erreur.
3. Exécuter `docs/TEST_PLAN.md` sur appareil (rappels T1–T7 + scénarios §1–§11) sur un build `preview`.
4. Exécuter `supabase/migrations/0001_oeuvre_membre.sql` → `0002_attestation_diffusion_membre.sql` → `0003_membre_categorie_membre.sql` → `0004_contenus_publics_paiement_membre.sql` dans l'éditeur SQL Supabase (voir `docs/BRANCHEMENT.md`).
5. Variables du profil visé (§1) : aucun secret réel commité, `.env.example` à jour, secrets EAS renseignés pour les builds connectés.
6. Services (§2) : uniquement réels ; aucune variable `EXPO_PUBLIC_USE_MOCKS*` dans `.env`, `eas.json` ni les secrets EAS.
7. Version et assets : `app.json` (`expo.version`, icône, splash) cohérents — l'incrément `production` est géré par `autoIncrement`.
8. `git status --short` propre avant commit, puis tag `etape-N` (convention du projet).
9. Construction : `npx eas-cli build --platform android --profile preview` → recette → `production` puis `npx eas-cli submit` pour les stores.

## 6) Limitations connues (aucune règle métier changée)

- **Confirmation des paiements** : l'application crée le paiement au statut `INITIE` et lit son état ; le passage à `REUSSI` / `ECHEC` (et ses effets : œuvre finalisée, notification) doit être écrit par un composant serveur relié à MVola (API Express ou fonction Edge). Ce composant n'est pas dans ce dépôt.
- **API candidat** : le parcours d'adhésion exige l'API Express décrite dans `docs/API_CANDIDAT.md` (`EXPO_PUBLIC_API_BASE_URL`) ; sans elle, chaque écran affiche une erreur avec « Réessayer ».
- Réouverture d'une catégorie `ANNULEE` / `REJETEE` bloquée par la migration 0003 (annulation stricte assumée ; toute extension demande une décision explicite).
- Les migrations (0001 → 0004) s'exécutent manuellement dans le SQL editor Supabase avant toute session membre.
- `eas submit` iOS exige un compte Apple Developer ; la construction `production` Android demande un keystore (généré à la demande par EAS).
