# Avancement OMDA Mobile

## Contexte
- Branche : `version-regles-metier` (HEAD 6828e1f)
- Parcours candidat : écran `app/(adhesion)/documents-oeuvres.tsx` (pièces : PHOTO, CIN, ACTE_NAISSANCE, CERTIFICAT_RESIDENCE, AUTORISATION_PARENTALE)
- Couche data : `src/services/http/HttpCandidateApi.ts` (API REST Express, singleton via `src/services/factory.ts`, aucun mock, aucun repli)
- Contrat : `docs/API_CANDIDAT.md` (v1.1)

## [02/11/2026] — Diagnostic : régression import des pièces (CIN, certificat de résidence, etc.) — complément Expo Go Android
Problème signalé : l'import d'une pièce affiche « Impossible de joindre le serveur » (type d'erreur `reseau`), alors que le serveur est lancé.

Chaîne d'import auditée (sélection → validation → requête → client → endpoint → réponse → écran) :
- sélection : `choisirDocument` / `choisirImage` → `CandidatFichier { uri, nom, mime_fourni, taille_octets }`
- validation : `validerCandidat` (taille ≤ 20 Mo, type MIME autorisé par bucket) → message de validation français en cas de refus
- construction : `televerser` → `candidateApi.televerserFichier({ bucket, chemin_stockage, fichier_uri, nom_fichier, mime_type, taille_octets })` via `FormData` (`bucket`, `chemin_stockage`, `fichier {uri,name,type}`)
- client : `HttpCandidateApi.televerserFichier` → `XMLHttpRequest` POST `BASE_URL/v1/fichiers`, délai 120 s, aucun `Content-Type` imposé (boundary générée par la plateforme)
- endpoint : `POST /v1/fichiers` (multipart/form-data, champs `bucket`/`chemin_stockage`/`fichier`, réponse 201 `{chemin_stockage, mime_type, taille_octets}`) — contrat serveur (`server/src/server.mjs`) cohérent avec le client
- lecture : `classerReponse` + `SCHEMA_FICHIER_TELEVERSE`
- écran : `messageErreurEnvoi` → `definirEnvoi({ statut: 'erreur', erreur })`

### 1. Ordre réel des opérations (écran étape 3 → `POST /v1/fichiers`)
- Sélection du fichier → `selectionner()` → `televerser()`
- Si `brouillon.numero_dossier` / `brouillon.code_suivi` absents → `candidateApi.creerDemande()` (POST `/v1/demandes`) crée le brouillon et définit `this.contexteDossier` dans `HttpCandidateApi`
- Sinon → `mettreAJourDemande()` réhydrate le contexte mémoire
- Puis `candidateApi.televerserFichier()` → XHR POST `BASE_URL/v1/fichiers` avec `FormData` (`bucket`, `chemin_stockage`, `fichier {uri,name,type}`)
- En-têtes : `Accept: application/json` + `X-Numero-Dossier` / `X-Code-Suivi` via `enTetesContexte()` (vide `{}` si aucun contexte)

### 2. Disponibilité et transmission de `numero_dossier` et `codeSuivi`
- Disponibles après `creerDemande()` ou `mettreAJourDemande()`, stockés dans `this.contexteDossier` du singleton `HttpCandidateApi`
- Transmis dans `enTetesContexte()` au moment de l'upload via `requete.setRequestHeader()`
- Si le contexte n'est pas défini (mémoire vide après redémarrage), `enTetesContexte()` retourne `{}` et l'upload est envoyé sans en-têtes d'authentification → serveur répond 401 (traitée comme `metier`, PAS comme `reseau`)

### 3. Exigences de la route serveur `POST /v1/fichiers`
- Exige `x-numero-dossier` et `x-code-suivi` (401 `CODE_SUIVI_INVALIDE` sinon)
- Exige `multipart/form-data` (415 sinon)
- Valide `bucket`, `chemin_stockage`, `fichier` (422 sinon)

### 4. Compatibilité contrat v1.1
- Le contrat §5.3 indique "dépôt PRÉALABLE à la création du dossier" — cette formulation est confuse
- Le serveur exige en réalité `x-numero-dossier` + `x-code-suivi` AVANT tout upload
- L'implémentation crée le brouillon AVANT l'upload : c'est compatible avec la route serveur, mais le commentaire du contrat est ambigu
- Aucune contradiction bloquante dans le code actuel ; pas de contournement de sécurité

### Constat instrumentation serveur
- Un journal global existe déjà dans `gerer()` (`server/src/server.mjs`) : log `[OMDA-DIAG] DEBUT <méthode> <chemin>` placé **avant CORS et avant les routes**, et log de fin automatique via `json()` (méthode, chemin, statut, durée). Il trace `OPTIONS` comme les autres requêtes.
- Ce journal ne journalise aucun header, corps multipart, nom de fichier ou donnée personnelle.
- Le silence du terminal serveur après un essai d'import **n'est pas significatif** tant que ce journal n'a pas été confirmé actif au démarrage du serveur : une requête qui n'atteint pas le serveur ne produit aucun log.
- La route `/v1/categories` n'existe pas dans ce serveur. La route publique simple pour vérifier l'instrumentation est `GET /health`.

### Constat URL construite côté app
- L'URL de l'upload est construite par `urlDepuisChemin('/fichiers')` = `API_BASE_URL.replace(/\/+$/, '') + '/v1' + '/fichiers'`.
- `API_BASE_URL` est lue statiquement depuis `process.env.EXPO_PUBLIC_API_BASE_URL` (substituée par Expo au build).
- La valeur de `.env` n'est pas affichée dans ce rapport.

### 5. Plateforme Expo Go sur Android — risques spécifiques
- `localhost` ne fonctionne PAS depuis Expo Go sur un appareil physique : il faut l'adresse IP LAN du poste exécutant le serveur
- `EXPO_PUBLIC_API_BASE_URL` doit pointer vers `http://<IP_LAN>:<port>` (valeur non affichée ici)
- Les requêtes HTTP (non HTTPS) vers une adresse IP locale sur Android peuvent être bloquées si `usesCleartextTraffic` n'est pas autorisé dans le manifeste
- CORS : le serveur vérifie `settings.allowedOrigins` ; si l'origine d'Expo Go (`http://<IP_LAN>:19000` ou similaire) n'est pas listée, le préflight `OPTIONS` échouera et la réponse pourra être masquée côté client (apparence `onerror`)

### 6. Base URL utilisée par le client
- Lue statiquement depuis `process.env.EXPO_PUBLIC_API_BASE_URL` (substituée par Expo au build)
- Garde-fou : si vide, `televerserFichier()` renvoie `serveur` sans appel réseau
- Valeur non affichée dans ce rapport

### 7. Traitement des événements XHR (diagnostic temporaire ajouté)
- `onload` → statut HTTP lu, réponse JSON validée ; si 4xx/5xx → `metier`/`serveur` (jamais `reseau`)
- `onerror` → `erreurReseau` (« aucune réponse du serveur »)
- `ontimeout` → `erreurReseau` (120 s)
- `onabort` → `refusAnnulation` (métier `TELEVERSEMENT_ANNULE`)
- Logs temporaires ajoutés : événement XHR, statut, durée, plateforme, chemin `/fichiers` — aucune donnée de fichier, aucun en-tête sensible

### Journaux temporaires ajoutés côté app (`src/services/http/HttpCandidateApi.ts`)
- `_diagLog` : événement XHR (`demarrage`/`onload`/`onerror`/`ontimeout`/`onabort`), statut HTTP, durée, plateforme (`Platform.OS`), chemin `/fichiers`
- Cas `API_BASE_URL === ''` : log `motif=API_BASE_URL_non_configurable`
- Aucun header, corps multipart, nom de fichier ou donnée personnelle journalisé

### Journaux temporaires ajoutés côté serveur (`server/src/server.mjs`)
- Méthode, chemin, statut, durée uniquement ; jamais d'en-tête, corps multipart ou fichier

Vérification :
- `node --check server/src/server.mjs` → syntaxe valide (0 erreur)
- `npx tsc --noEmit` → 0 erreur

Diagnostic conditionnel (à confirmer par les observations) :
- Aucune requête reçue dans les journaux serveur → connectivité, adresse IP, interface réseau d'écoute du serveur ou pare-feu ; l'URL compilée dans l'app doit pointer vers le serveur joignable depuis Expo Go Android — une requête réussie depuis l'ordinateur ne prouve pas que l'appareil peut joindre le serveur
- OPTIONS reçu sans POST sur Expo Go Android → préflight CORS (origine non listée dans `CORS_ALLOWED_ORIGINS` ou en-têtes personnalisés `x-numero-dossier` / `x-code-suivi` non autorisés)
- POST reçu avec un statut d'erreur HTTP → traiter le code et le message serveur (`metier` pour 4xx, `serveur` pour 5xx), ne pas présenter comme une panne réseau
- POST réussi (201) mais échec affiché → vérifier la lecture de la réponse (`classerReponse` + `SCHEMA_FICHIER_TELEVERSE`) et la mise à jour de l'écran (`definirEnvoi`)
- Client : `onerror` / `ontimeout` = échec de transport (`reseau`) ; `onload` avec statut 4xx/5xx = réponse serveur reçue (jamais `reseau`)

Statut : non retesté avec succès sur appareil — « Diagnostic en cours : journaux temporaires ajoutés côté app (HttpCandidateApi.ts) et serveur ; retest sur Expo Go Android requis ».

Étapes restantes pour retester l'import :
1. Vérifier que `EXPO_PUBLIC_API_BASE_URL` pointe vers l'adresse IP LAN du serveur (joignable depuis l'appareil Android, pas seulement `localhost`)
2. Vérifier que `CORS_ALLOWED_ORIGINS` autorise l'origine d'Expo Go (préflight CORS + en-têtes personnalisés `x-numero-dossier` / `x-code-suivi`)
3. Redémarrer le serveur Express avec les journaux temporaires activés
4. Relancer l'app sur Expo Go Android avec les diagnostics côté app activés
5. Aller à l'étape 3 « Documents et œuvres » et sélectionner une pièce (ex. CIN)
6. Relever dans le terminal Metro (app) : logs `[OMDA-DIAG] XHR …` (événement, statut, durée, plateforme)
7. Relever dans le terminal serveur : logs `[OMDA-DIAG]` (aucune requête / OPTIONS seul / POST avec statut)
8. Confirmer le retour 201 et l'affichage « Fichier accepté », ou relever le type d'erreur (`reseau` / `metier` / `serveur`) et le code serveur

## Nouvelle règle métier (à documenter, non implémentée dans cette tâche)
- Pour l'adhésion à une nouvelle catégorie, chaque œuvre doit avoir une attestation de diffusion et une fiche de déclaration propre à la catégorie.
- Pour un membre existant qui ajoute une œuvre, la fiche de déclaration reste obligatoire et l'attestation devient facultative.
- Le mode d'intégration des fiches de déclaration n'est pas encore décidé (formulaire officiel rempli vs formulaire numérique spécifique à chaque catégorie).
- Le schéma actuel ne comporte pas de relation explicitement dédiée à cette fiche. Ne détourner pas un champ existant sans confirmer son rôle et ne créer pas de migration dans cette tâche.
- Décision à prendre : import d'un formulaire officiel rempli ou formulaire numérique spécifique à chaque catégorie.

## Fichiers modifiés dans cette tâche
- `src/services/http/HttpCandidateApi.ts` : ajout de diagnostics temporaires expurgés (événement XHR, statut, durée, plateforme, chemin) ; aucune logique métier modifiée, aucun contrôle d'authentification retiré, aucun fallback mock ajouté
- `server/src/server.mjs` : ajout de journaux temporaires expurgés de diagnostic (méthode, chemin, statut, durée uniquement) ; aucune logique métier modifiée, aucun contrôle d'authentification retiré, aucun fallback mock ajouté
- `PROGRESS.md` : mise à jour de l'avancement (ce fichier)