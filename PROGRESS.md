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
- Aucune correction de code client n'a été appliquée (aucune cause établie). Aucun fallback mock n'a été ajouté.

Journaux temporaires ajoutés côté serveur (`server/src/server.mjs`) :
- Journaux expurgés indiquant uniquement : méthode, chemin, statut HTTP, durée. Jamais d'en-têtes d'authentification, de formulaires multipart, de noms de fichiers ni de corps de requêtes.
- Log `DEBUT` au début de chaque requête, log `FIN` automatique via `json()`, et log dédié pour le préflight `OPTIONS`.
- Ces journaux doivent être retirés après le diagnostic.

Vérification :
- `node --check server/src/server.mjs` → syntaxe valide (0 erreur)
- `npx tsc --noEmit` → 0 erreur (LASTEXITCODE=0)

Étapes restantes pour retester l'import :
1. Vérifier que `EXPO_PUBLIC_API_BASE_URL` pointe vers le serveur Express lancé.
2. Vérifier que `CORS_ALLOWED_ORIGINS` autorise l'origine de l'app (préflight CORS + en-têtes personnalisés `x-numero-dossier` / `x-code-suivi`).
3. Redémarrer le serveur Express avec les journaux temporaires activés.
4. Tester l'import d'une pièce (CIN / certificat de résidence) sur émulateur ou appareil avec le serveur lancé.
5. Relever les journaux `[OMDA-DIAG]` dans le terminal serveur : aucune requête / OPTIONS seul / POST avec statut d'erreur / POST 201.
6. Confirmer que l'upload retourne 201 et que l'écran affiche « Fichier accepté » ; en cas d'échec, relever le type d'erreur (`reseau` / `metier` / `serveur`) et le code serveur.

Diagnostic conditionnel (à confirmer par les observations serveur) :
- Aucune requête reçue dans les journaux serveur → connectivité, adresse IP, interface réseau d'écoute du serveur ou pare-feu ; l'URL compilée dans l'app doit pointer vers le serveur joignable depuis la plateforme cible (téléphone physique, émulateur Android, simulateur iOS ou Expo Web) — une requête réussie depuis l'ordinateur ne prouve pas que l'appareil peut joindre le serveur
- OPTIONS reçu sans POST, sur Expo Web → préflight CORS (origine non listée dans `CORS_ALLOWED_ORIGINS` ou en-têtes personnalisés `x-numero-dossier` / `x-code-suivi` non autorisés)
- POST reçu avec un statut d'erreur HTTP → traiter le code et le message serveur (`metier` pour 4xx, `serveur` pour 5xx), ne pas présenter comme une panne réseau
- POST réussi (201) mais échec affiché → vérifier la lecture de la réponse (`classerReponse` + `SCHEMA_FICHIER_TELEVERSE`) et la mise à jour de l'écran (`definirEnvoi`)

Statut : non retesté avec succès sur appareil — « Diagnostic en cours : journaux temporaires ajoutés côté serveur ; retest sur appareil requis ».

## Nouvelle règle métier (à documenter, non implémentée dans cette tâche)
- Pour l'adhésion à une nouvelle catégorie, chaque œuvre doit avoir une attestation de diffusion et une fiche de déclaration propre à la catégorie.
- Pour un membre existant qui ajoute une œuvre, la fiche de déclaration reste obligatoire et l'attestation devient facultative.
- Le mode d'intégration des fiches de déclaration n'est pas encore décidé (formulaire officiel rempli vs formulaire numérique spécifique à chaque catégorie).
- Le schéma actuel ne comporte pas de relation explicitement dédiée à cette fiche. Ne détourner pas un champ existant sans confirmer son rôle et ne créer pas de migration dans cette tâche.
- Décision à prendre : import d'un formulaire officiel rempli ou formulaire numérique spécifique à chaque catégorie.

## Fichiers modifiés dans cette tâche
- `server/src/server.mjs` : ajout de journaux temporaires expurgés de diagnostic (méthode, chemin, statut, durée uniquement) ; aucune logique métier modifiée, aucun contrôle d'authentification retiré, aucun fallback mock ajouté
- `PROGRESS.md` : mise à jour de l'avancement (ce fichier)