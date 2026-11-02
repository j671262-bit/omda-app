# Avancement OMDA Mobile

## Contexte
- Branche : `version-regles-metier` (HEAD 6828e1f)
- Parcours candidat : écran `app/(adhesion)/documents-oeuvres.tsx` (pièces : PHOTO, CIN, ACTE_NAISSANCE, CERTIFICAT_RESIDENCE, AUTORISATION_PARENTALE)
- Couche data : `src/services/http/HttpCandidateApi.ts` (API REST Express, singleton via `src/services/factory.ts`, aucun mock, aucun repli)
- Contrat : `docs/API_CANDIDAT.md` (v1.1)

## [02/11/2026] — Diagnostic : régression import des pièces (CIN, certificat de résidence, etc.)
Problème signalé : l'import d'une pièce affiche « Impossible de joindre le serveur » (type d'erreur `reseau`), alors que le serveur est lancé.

Chaîne d'import auditée (sélection → validation → requête → client → endpoint → réponse → écran) :
- sélection : `choisirDocument` / `choisirImage` → `CandidatFichier { uri, nom, mime_fourni, taille_octets }`
- validation : `validerCandidat` (taille ≤ 20 Mo, type MIME autorisé par bucket) → message de validation français en cas de refus
- construction : `televerser` → `candidateApi.televerserFichier({ bucket, chemin_stockage, fichier_uri, nom_fichier, mime_type, taille_octets })` via `FormData` (`bucket`, `chemin_stockage`, `fichier {uri,name,type}`)
- client : `HttpCandidateApi.televerserFichier` → `XMLHttpRequest` POST `BASE_URL/v1/fichiers`, délai 120 s, aucun `Content-Type` imposé (boundary générée par la plateforme)
- endpoint : `POST /v1/fichiers` (multipart/form-data, champs `bucket`/`chemin_stockage`/`fichier`, réponse 201 `{chemin_stockage, mime_type, taille_octets}`) — contrat serveur (`server/src/server.mjs`) cohérent avec le client
- lecture : `classerReponse` + `SCHEMA_FICHIER_TELEVERSE`
- écran : `messageErreurEnvoi` → `definirEnvoi({ statut: 'erreur', erreur })`

Cause recherchée :
- Le code client est CONFORME au contrat `docs/API_CANDIDAT.md` (§1, §2, §5.3, §9) :
  - URL construite avec le préfixe `/v1` ajouté une seule fois (`urlDepuisChemin`) ;
  - aucun `JSON.stringify` du `FormData`, aucun `Content-Type: application/json` appliqué à l'upload, aucun en-tête `multipart/form-data` imposé ;
  - format fichier Expo/React Native `{ uri, name, type }` conservé ;
  - délai d'attente de 120 s pour le téléversement ;
  - mapping des erreurs : HTTP 4xx avec enveloppe → `metier`, 5xx → `serveur`, absence de réponse / timeout → `reseau` (aucune 4xx/5xx n'est transformée en « serveur injoignable ») ;
  - pas de repli sur un mock (`factory.ts` instancie le vrai `HttpCandidateApi`) ;
  - schéma respecté : pièces PDF/JPEG/PNG, max 20 Mo.
- Aucune régression côté client n'a été établie. `HttpCandidateApi.ts` est inchangé depuis `2dc4a28` et identique à l'implémentation de référence décrite dans la worktree (ÉTAPE 27). Les écrans appellent bien `candidateApi.televerserFichier` et traduisent les erreurs en français.
- Le message « impossible de joindre le serveur » provient exclusivement de `XMLHttpRequest.onerror` / `ontimeout` dans `televerserFichier`. Comme le serveur est lancé et que les contrats client/serveur correspondent, ce `reseau` indique un échec de transport (requête qui n'atteint pas le serveur ou réponse illisible), d'origine environnementale (ex. `CORS_ALLOWED_ORIGINS` ne listant pas l'origine cliente, préflight CORS bloqué sur les en-têtes `x-numero-dossier` / `x-code-suivi`, ou `EXPO_PUBLIC_API_BASE_URL` inaccessible depuis l'app) et non un défaut de code client corrigible par édition.
- Aucun fichier n'a été modifié : aucune cause établie côté client → aucune correction appliquée, conformément à « corrige uniquement la cause établie » (pas de fallback mock, aucune valeur `.env` exposée).

Vérification :
- `npx tsc --noEmit` → 0 erreur (LASTEXITCODE=0).

Étapes restantes pour retester l'import :
1. Vérifier que `EXPO_PUBLIC_API_BASE_URL` pointe vers le serveur Express lancé.
2. Vérifier que `CORS_ALLOWED_ORIGINS` autorise l'origine de l'app (préflight CORS + en-têtes personnalisés `x-numero-dossier` / `x-code-suivi`).
3. Tester l'import d'une pièce (CIN / certificat de résidence) sur émulateur ou appareil avec le serveur lancé.
4. Confirmer que l'upload retourne 201 et que l'écran affiche « Fichier accepté » ; en cas d'échec, relever le type d'erreur (`reseau` / `metier` / `serveur`) et le code serveur.

Statut : non retesté avec succès sur appareil — « Diagnostic effectué : aucune régression côté client établie ; retest sur appareil requis ».