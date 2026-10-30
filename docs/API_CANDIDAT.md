# OMDA — Contrat REST de l'API Candidat (proposition)

Version : 1.1 — cible : API Node/Express consommée par l'application mobile pour le
parcours **visiteur / candidat** (utilisateur SANS compte).

> **v1.1** — implémenté côté mobile par `src/services/http/HttpCandidateApi.ts`
> (étape 19) : §5.3 adapté au dépôt **préalable** à la création du dossier ;
> contrôles client ajoutés au §9. Le fond n'a pas changé : **Mobile Money
> (MVola) reste le seul mode de paiement, aucun virement n'existe.**

> Ce document décrit le contrat HTTP que l'implémentation `HttpCandidateApi`
> (étape 19) respecte. Il correspond au contrat TypeScript
> `src/services/contracts/candidateApi.ts` (`CandidateApi`).
>
> **Hors périmètre** : l'espace membre (auth + données) passe par **Supabase**
> (Auth, Postgres, Storage) — voir `MemberRepository` et `AuthService`.
> Aucun endpoint d'administration/agent n'est prévu ici (pas de back-office).

---

## 1) Conventions

| Élément | Règle |
|---|---|
| Base URL | `EXPO_PUBLIC_API_BASE_URL` (ex. `https://api.omda.mg`) |
| Préfixe | `/v1` (versionné, rétrocompatible) |
| Corps | JSON UTF-8, `Content-Type: application/json` (sauf uploads : `multipart/form-data`) |
| Encodage des montants | `integer`, **Ariary entiers** (pas de centimes), `devise: "MGA"` |
| Dates | ISO 8601 UTC (`2026-09-24T08:30:00.000Z`) ; dates civiles `AAAA-MM-JJ` |
| Identifiants | UUID v4 côté serveur |
| Langue | Messages d'erreur en **français (vouvoiement)**, prêts à afficher |
| Authentification candidat | En-têtes `X-Numero-Dossier` + `X-Code-Suivi` (jeton de suivi communiqué une seule fois) |
| Idempotence | `Idempotency-Key: <uuid>` obligatoire sur `POST /v1/paiements` et `POST /v1/demandes/{numero}/envoi` |
| Pagination | `?limite=` / `?curseur=` pour les listes (documentation) |
| Corrélation | Réponse en erreur 5xx : `reference` à citer au support |

**Sécurité** : le candidat n'a **aucun accès direct** à la base ni au storage
en écriture libre ; les pièces et les œuvres passent par les endpoints d'upload.

---

## 2) Format d'erreur normalisé

Toutes les erreurs (4xx/5xx) renvoient le même enveloppe :

```json
{
  "code": "DEMANDE_NON_VALIDEE",
  "message": "Votre demande n'est pas encore validée : le paiement n'est pas disponible pour le moment.",
  "details": { "statut": "EN_COURS_DE_VERIFICATION" },
  "reference": "err_01J8Z..."
}
```

- `code` : identifiant **stable** (jamais traduit, destiné au code mobile) ;
- `message` : texte français destiné à l'affichage ;
- `details` : objet libre (facultatif) ;
- `reference` : identifiant de corrélation (facultatif, surtout 5xx).

### Mapping vers le type `Result` du mobile

| Situation HTTP | `Result` mobile | Type d'erreur |
|---|---|---|
| Aucune réponse / DNS / timeout | `{ ok: false }` | `reseau` |
| `500`, `502`, `503`, `504`, JSON invalide, contrat rompu | `{ ok: false }` | `serveur` (`statut_http`, `reference`) |
| `400`, `401`, `403`, `404`, `409`, `413`, `415`, `422`, `429` avec `code` | `{ ok: false }` | `metier` (`code`, `message`, `details`) |
| `200`, `201`, `202` | `{ ok: true, valeur }` | — |

> Règle mobile : une erreur métier n'est jamais déduite localement ; elle vient
> toujours du serveur (jamais de succès ni d'échec inventé par l'app).

---

## 3) Codes d'erreur métier (candidat)

| `code` | HTTP | Message (exemple) | Contexte |
|---|---|---|---|
| `DEMANDE_INTROUVABLE` | 404 | « Nous ne trouvons aucune demande avec ces informations. » | suivi / paiement |
| `CODE_SUIVI_INVALIDE` | 401 | « Le code de suivi ne correspond pas à ce numéro de dossier. » | suivi / paiement |
| `DEMANDE_NON_VALIDEE` | 409 | « Votre demande n'est pas encore validée : le paiement n'est pas disponible. » | options paiement / initiation |
| `DOSSIER_INCOMPLET` | 422 | « Votre dossier est incomplet : chaque œuvre doit être accompagnée de sa fiche de déclaration, et d'une attestation de diffusion selon votre situation (cas A/B/C de la règle 3). » | envoi de demande |
| `AGE_INSUFFISANT` | 422 | « Une demande d'adhésion est possible à partir de 15 ans. » | création / envoi |
| `AUTORISATION_PARENTALE_REQUISE` | 422 | « Une autorisation parentale est exigée pour les personnes de 15 à 17 ans. » | envoi |
| `OPERATEUR_INDISPONIBLE` | 409 | « Cet opérateur Mobile Money est momentanément indisponible. » | initiation paiement |
| `PAIEMENT_DEJA_REUSSI` | 409 | « Le paiement de ces frais a déjà été confirmé. » | initiation paiement |
| `FICHIER_TROP_VOLUMINEUX` | 413 | « Le fichier dépasse la taille maximale de 20 Mo. » | upload |
| `TYPE_FICHIER_NON_AUTORISE` | 415 | « Ce format de fichier n'est pas accepté (JPEG, PNG ou PDF). » | upload |

**Codes techniques** (à ne pas confondre avec les codes métier) :
`TROP_DE_TENTATIVES` (429, renvoyé par l'authentification **membre** Supabase),
`SERVICE_INDISPONIBLE` (503).

---

## 4) Enveloppe de réponse

Aucune enveloppe `data` générique : les endpoints renvoient directement la
ressource (ou une liste). Les erreurs suivent §2. Les champs suivent le
**snake_case** du schéma Postgres (`docs/SCHEMA_DB.md`) pour éviter tout
mapping implicite.

Ce qui n'est **jamais** renvoyé :

- `jeton_suivi_hash` (le code de suivi n'est en clair que dans la réponse de
  création / d'envoi) ;
- `mot_de_passe_hash`, jetons internes, données d'autres candidats.

---

## 5) Endpoints — parcours adhésion / candidat

### 5.1 Créer une demande (brouillon)

`POST /v1/demandes`

```json
{
  "identite": {
    "nom": "RAKOTO",
    "prenom": "Jean",
    "pseudonyme": "Rakoto Chanteur",
    "date_naissance": "1996-04-12",
    "cin": "101234567890",
    "telephone": "+261341234567",
    "email": "jean.rakoto@example.mg",
    "adresse": "Lot 12 Bis, Antananarivo 101"
  },
  "categorie_id": "8f0f0d3a-1c2b-4a1e-9f0e-1d2c3b4a5e6f"
}
```

`201 Created`

```json
{
  "demande_id": "2b1b7a3c-...",
  "numero_dossier": "OMDA-2026-000123",
  "code_suivi": "K7X4-9B2Q",
  "statut": "BROUILLON",
  "created_at": "2026-09-24T08:30:00.000Z"
}
```

Règles : `pseudonyme` obligatoire (règle métier 1) ; `AGE_INSUFFISANT` si moins de 15 ans ; `code_suivi` renvoyé **en clair
une seule fois** ; l'app le conserve (stockage local) et l'affiche à l'écran L.

### 5.2 Mettre à jour un brouillon

`PATCH /v1/demandes/{numero_dossier}` — en-têtes `X-Code-Suivi`

```json
{ "identite": { "adresse": "Lot 8, Antsirabe 110" }, "categorie_id": "..." }
```

`200 OK` → même objet que 5.1. Refus si `statut <> 'BROUILLON'` (409 `metier`).

### 5.3 Téléverser un fichier (pièce, œuvre, attestation)

`POST /v1/fichiers` — `multipart/form-data`

> Le mobile crée désormais le brouillon avant le premier téléversement afin que
> chaque envoi soit autorisé par le numéro de dossier et le code de suivi. Le
> serveur vérifie que le code correspond au hash enregistré et que le dossier
> est toujours `BROUILLON` avant de lire le fichier. Le serveur génère un chemin
> imprévisible, vérifie la signature du contenu MIME, limite la taille à 20 Mo et
> applique une limitation de débit. La soumission finale vérifie que chaque objet
> existe dans le stockage privé. Les objets téléversés mais jamais rattachés
> devront être nettoyés périodiquement.

| Part | Contenu |
|---|---|
| `fichier` | binaire (≤ **20 Mo**) |
| `bucket` | `pieces` \| `oeuvres` |
| `chemin_stockage` | chemin souhaité dans le bucket (ex. `pieces/PHOTO/photo.jpg`) ; le serveur peut le préfixer |
| `type` | facultatif, pour `pieces` : `PHOTO` \| `CIN` \| `ACTE_NAISSANCE` \| `CERTIFICAT_RESIDENCE` \| `AUTORISATION_PARENTALE` \| `AUTRE` |
| `oeuvre_id` | facultatif (rattachement à une œuvre) |

> **Distinction des documents (règle métier 4)** : le endpoint `/v1/fichiers` transporte des fichiers binaires. La **fiche de déclaration d'œuvre** et l'**attestation de diffusion** sont deux documents distincts, chacun avec son propre `chemin_stockage` dans le bucket `oeuvres`. Ils ne doivent jamais être confondus ni fusionnés dans un même fichier.

MIME autorisés par bucket (identiques au schéma) :
`pieces` → `image/jpeg`, `image/png`, `application/pdf` ;
`oeuvres` → + `audio/mpeg`, `audio/wav`.

`201 Created`

```json
{ "chemin_stockage": "pieces/11111111-1111-4111-8111-111111111111/cin.pdf",
  "mime_type": "application/pdf",
  "taille_octets": 842133 }
```

Le mobile réutilise ce `chemin_stockage` dans le récapitulatif et l'envoi.
Progression : le client peut suivre l'octet-count du `multipart` (implémentation
`HttpCandidateApi`) ; erreurs `FICHIER_TROP_VOLUMINEUX` / `TYPE_FICHIER_NON_AUTORISE`.

### 5.4 Envoyer la demande (dossier complet)

`POST /v1/demandes/{numero_dossier}/envoi` — en-têtes `X-Numero-Dossier`, `X-Code-Suivi` + `Idempotency-Key`

```json
{
  "categorie_id": "8f0f0d3a-...",
  "pieces": [
    { "type": "PHOTO", "chemin_stockage": "pieces/.../photo.jpg", "mime_type": "image/jpeg", "taille_octets": 210332 },
    { "type": "CIN", "chemin_stockage": "pieces/.../cin.pdf", "mime_type": "application/pdf", "taille_octets": 842133 }
  ],
  "oeuvres": [
    { "titre": "La varangue", "categorie_id": "...", "annee": 2024,
      "fiche_declaration": { "chemin_stockage": "oeuvres/.../fiche-varangue.pdf", "mime_type": "application/pdf", "taille_octets": 450000 },
      "fichier": { "chemin_stockage": "oeuvres/.../varangue.pdf", "mime_type": "application/pdf", "taille_octets": 1204332 },
      "attestations": [ { "chemin_stockage": "oeuvres/.../attestation-varangue.pdf", "mime_type": "application/pdf", "taille_octets": 330211 } ]
    }
  ]
}
```

> **Fiche de déclaration (règle métier 2)** : chaque œuvre doit obligatoirement être accompagnée de sa fiche de déclaration (`fiche_declaration`), dont le modèle dépend de la catégorie de l'œuvre.
> **Attestation de diffusion (règle métier 3)** : le tableau `attestations` est **obligatoire** pour chaque œuvre dans les cas A (adhésion d'un non-membre) et B (catégorie supplémentaire d'un membre). Il est **non obligatoire** dans le cas C (dépôt dans une catégorie déjà détenue par le membre). L'absence d'attestation dans le cas C ne doit pas bloquer l'envoi.

`200 OK`

```json
{
  "numero_dossier": "OMDA-2026-000123",
  "code_suivi": "K7X4-9B2Q",
  "statut": "ENVOYEE",
  "date_soumission": "2026-09-24T08:45:10.000Z",
  "delai_indicatif_heures": 72
}
```

Règles serveur et transaction SQL (`supabase/migrations/0009_soumission_demande_atomique.sql`) :
photo + CIN, ≥ **2 œuvres**, **fiche de déclaration obligatoire par œuvre** (règle métier 2),
attestation de diffusion selon le cas A/B/C de la règle métier 3 (obligatoire en cas A et B, non obligatoire en cas C),
`AUTORISATION_PARENTALE_REQUISE` pour les 15–17 ans.
Les pièces, œuvres, fiches de déclaration, attestations et le passage à `ENVOYEE` sont enregistrés dans une seule transaction.
La clé d'idempotence est conservée côté base. **Aucun paiement** n'est déclenché ni
demandé à ce stade (règle métier 1). La migration doit être appliquée sur Supabase
avant d'activer ce endpoint en production.

### 5.5 Suivre une demande

`GET /v1/suivi/{numero_dossier}` — en-têtes `X-Code-Suivi`

`200 OK`

```json
{
  "numero_dossier": "OMDA-2026-000123",
  "statut": "VALIDEE",
  "derniere_mise_a_jour": "2026-09-25T06:12:00.000Z",
  "etapes": [
    { "statut": "ENVOYEE", "libelle": "Demande reçue", "realisee": true, "date": "2026-09-24T08:45:10.000Z" },
    { "statut": "EN_COURS_DE_VERIFICATION", "libelle": "Vérification du dossier", "realisee": true, "date": "2026-09-24T09:00:00.000Z" },
    { "statut": "VALIDEE", "libelle": "Dossier validé", "realisee": true, "date": "2026-09-25T06:12:00.000Z" },
    { "statut": "ADHESION_TERMINEE", "libelle": "Adhésion finalisée", "realisee": false, "date": null }
  ],
  "motif_rejet": null,
  "paiement_du": { "type": "ADHESION", "montant": 150000, "devise": "MGA" }
}
```

- `motif_rejet` : renseigné **uniquement** si `statut = 'REJETEE'` (jamais vide dans ce cas) ;
- `paiement_du` : `null` tant que le dossier n'est pas `VALIDEE` — le montant est
  **toujours** fourni par le serveur (jamais calculé dans l'UI).

---

### 5.6 Options de paiement disponibles

`GET /v1/paiements/options/{numero_dossier}` — en-têtes `X-Code-Suivi`

`200 OK`

```json
{
  "paiement_du": { "type": "ADHESION", "montant": 150000, "devise": "MGA" },
  "modes": [
    {
      "mode": "MOBILE_MONEY",
      "libelle": "Paiement Mobile Money (MVola)",
      "operateurs": [
        { "code": "MVOLA", "libelle": "MVola", "actif": true, "ordre": 1, "updated_at": "2026-09-20T05:00:00.000Z" }
      ]
    }
  ]
}
```

Règles :
- réponse identique au type `OptionsPaiementCandidat` du contrat TS :
  `paiement_du` (montant dû) + `modes` — **seul mode : `MOBILE_MONEY` (MVola)**,
  aucun autre mode n'est proposé ;
- `409 DEMANDE_NON_VALIDEE` si le dossier n'est pas `VALIDEE` ;
- `paiement_du.montant` suit la ligne `tarif` (Ariary entier, `devise: "MGA"`) :
  le montant vient **toujours** du serveur, jamais de l'UI ;
- les **opérateurs inactifs doivent être absents ou marqués `actif: false`** —
  l'app n'affiche **que** les éléments actifs (liste 100 % dynamique, jamais de
  codage dur côté UI) ;
- `operateurs` reprend la table `operateur_mobile_money` (`code`, `libelle`,
  `actif`, `ordre`, `updated_at`) ; **MVola est le seul opérateur** du schéma et
  il est affiché dans l'UI **sans sélecteur** (non sélectionnable) ; un opérateur
  désactivé doit être **absent** de l'UI ;
- un champ d'aide facultatif (`instructions` par mode/opérateur) peut être ajouté
  par le serveur : il n'est jamais stocké en base, il est purement affiché.

### 5.7 Initier un paiement

`POST /v1/paiements` — en-têtes `X-Code-Suivi` + `Idempotency-Key`

```json
{
  "numero_dossier": "OMDA-2026-000123",
  "mode": "MOBILE_MONEY",
  "operateur": "MVOLA",
  "numero_telephone": "+261341234567"
}
```

Le `code_suivi` du contrat TS (`InitierPaiementEntree`) voyage dans l'en-tête
`X-Code-Suivi`, et le `type` de paiement n'est **pas** envoyé : le serveur
l'impose (ici `ADHESION`, contexte `demande_adhesion_id` selon
`paiement_contexte_chk`).

`201 Created`

```json
{
  "paiement_id": "3a9c2f10-...",
  "reference_interne": "PAI-2026-000742",
  "reference_externe": null,
  "type": "ADHESION",
  "montant": 150000,
  "devise": "MGA",
  "mode": "MOBILE_MONEY",
  "operateur": "MVOLA",
  "statut": "EN_ATTENTE_CONFIRMATION",
  "motif_echec": null,
  "date_initiation": "2026-09-25T07:00:00.000Z",
  "date_confirmation": null,
  "instruction": "Validez la demande de paiement reçue sur votre téléphone."
}
```

Règles :
- dossier non `VALIDEE` → `409 DEMANDE_NON_VALIDEE` ;
- opérateur inactif → `409 OPERATEUR_INDISPONIBLE` ;
- déjà `REUSSI` → `409 PAIEMENT_DEJA_REUSSI` ;
- `201` = **initiation uniquement** : ne JAMAIS afficher de vert ni de
  « paiement réussi » sur cette réponse (le statut réel est `INITIE` /
  `EN_ATTENTE_CONFIRMATION`).

### 5.8 État d'un paiement (polling)

`GET /v1/paiements/{reference_interne}` — en-têtes `X-Code-Suivi`

> La clé de polling est la **référence interne** (`PAI-2026-000742`), seule
> valeur exposée au candidat côté `obtenirEtatPaiement` du contrat mobile.
>
> `HttpCandidateApi` mémorise le couple dossier en cours (§1) pour joindre
> `X-Code-Suivi` à cet appel ; sans contexte (application redémarrée), la
> requête part avec la seule référence et le serveur peut alors répondre
> `401 CODE_SUIVI_INVALIDE`.

`200 OK` → même objet que 5.7 avec les champs complétés :

```json
{
  "paiement_id": "3a9c2f10-...",
  "reference_interne": "PAI-2026-000742",
  "reference_externe": "MM-2026-8891",
  "type": "ADHESION",
  "mode": "MOBILE_MONEY",
  "operateur": "MVOLA",
  "montant": 150000,
  "devise": "MGA",
  "statut": "REUSSI",
  "motif_echec": null,
  "date_initiation": "2026-09-25T07:00:00.000Z",
  "date_confirmation": "2026-09-25T07:03:25.000Z",
  "instruction": null
}
```

- **Mobile Money (MVola)** : confirmation **automatique** côté serveur (webhook opérateur,
  trace dans `journal_paiement`) ; l'app **interroge** cet endpoint
  (ex. toutes les 3 s, backoff exponentiel) ;
- l'app ne passe à l'écran « Succès » que si `statut = 'REUSSI'` **et**
  `date_confirmation <> null` (confirmation externe impérative), avec
  `reference_externe` renseignée quand l'opérateur la fournit ;
- `motif_echec` : renseigné pour `ECHEC_*` et `REJETE` (jamais vide dans ces cas).

---

## 6) Endpoints publics (`PublicContentService`, sans authentification)

| Méthode du contrat | Endpoint | Retour |
|---|---|---|
| `listerDocumentation` | `GET /v1/documentation` | `Documentation[]` — articles publiés, triés par `ordre` |
| `obtenirArticle` | `GET /v1/documentation/{slug}` | `Documentation` (404 si inconnu/non publié) |
| `listerCategories` | `GET /v1/categories?actives=true` | `Categorie[]` |
| `listerTarifs` | `GET /v1/tarifs?actives=true&type_operation=&categorie_id=` | `Tarif[]` |
| `estimerMontant` | `GET /v1/tarifs/estimation?type_operation=&categorie_id=` | `EstimationMontant` avec `estimation: true` + `mention` |
| `listerOperateursMobileMoney` | `GET /v1/operateurs-mobile-money?actifs=true` | `OperateurMobileMoney[]` |

`GET /v1/tarifs/estimation` renvoie par exemple :

```json
{
  "type_operation": "ADHESION",
  "categorie_id": "8f0f0d3a-...",
  "montant": 150000,
  "devise": "MGA",
  "estimation": true,
  "mention": "Estimation — le montant final est confirmé par le serveur.",
  "valide_jusqu_au": "2026-12-31"
}
```

Tout est **dynamique** : désactivation côté serveur ⇒ élément absent de la
liste ; l'UI ne codifie aucun montant, opérateur ou tarif (règle AI_RULES).

---

## 7) Correspondance contrat mobile ↔ HTTP

| Méthode `CandidateApi` | Requête |
|---|---|
| `creerDemande` | `POST /v1/demandes` (§5.1) |
| `mettreAJourDemande` | `PATCH /v1/demandes/{numero_dossier}` (§5.2) |
| `soumettreDemande` | `POST /v1/demandes/{numero_dossier}/envoi` (§5.4) |
| `televerserFichier` | `POST /v1/fichiers` (§5.3) |
| `suivreDemande` | `GET /v1/suivi/{numero_dossier}` (§5.5) |
| `obtenirOptionsPaiement` | `GET /v1/paiements/options/{numero_dossier}` (§5.6) |
| `initierPaiement` | `POST /v1/paiements` (§5.7) |
| `obtenirEtatPaiement` | `GET /v1/paiements/{reference_interne}` (§5.8) |

---

## 8) Règles impératives côté API (récapitulatif)

1. **Aucun paiement** à la création ni à l'envoi d'une demande (§5.1–5.4).
2. **Validation ≠ membre** : `REUSSI` sur les frais d'adhésion ne finalise
   l'adhésion (`ADHESION_TERMINEE`) qu'après traitement serveur ; les identifiants
   du nouveau membre partent alors par e-mail.
3. `REUSSI` **uniquement** sur confirmation externe (webhook Mobile Money MVola)
   + `date_confirmation_serveur` — jamais de succès immédiat.
4. Liste des opérateurs/modes strictement **dynamique** (désactivé = absent) ;
   seul mode : `MOBILE_MONEY` (MVola, opérateur non sélectionnable dans l'UI).
5. `motif_rejet` obligatoire dès que `statut = 'REJETEE'`.
6. Upload : **20 Mo max**, MIME restreints par bucket, progression/retry gérés
   par le client, rejeu possible après coupure réseau (Idempotency-Key sur l'envoi).
7. Délai affiché : `delai_indicatif_heures = 72` (**informatif**, jamais promis).
8. Âge : `< 15` refus bloquant, `15–17` autorisation parentale exigée,
   `≥ 18` rien — validé côté serveur (§5.1/§5.4), pas seulement dans l'UI.
9. Le code de suivi n'est révélé qu'à la création/envoi ; jamais dans les
   réponses ultérieures (seul `X-Code-Suivi` en en-tête le prouve).
10. **Pseudonyme obligatoire** (`pseudonyme`) dans `identite` à la création d'une
    demande d'adhésion, distinct du `nom` et du `prenom` (règle métier 1).
11. **Fiche de déclaration obligatoire par œuvre** : chaque œuvre doit être
    accompagnée de sa `fiche_declaration`, dont le modèle dépend de la catégorie
    de l'œuvre (règle métier 2).
12. **Attestation de diffusion conditionnelle** (règle métier 3) : pour chaque
    œuvre, l'attestation est obligatoire dans le cas A (adhésion d'un non-membre)
    et le cas B (catégorie supplémentaire d'un membre), mais **non obligatoire**
    dans le cas C (dépôt dans une catégorie déjà détenue par le membre).
13. **Distinction des documents** (règle métier 4) : fiche de déclaration,
    attestation de diffusion et autres pièces administratives sont des documents
    séparés, identifiés individuellement dans l'API, le stockage et les réponses
    serveur.
14. **Lien œuvre ↔ catégorie ↔ fiche ↔ attestation** : chaque œuvre référence
    exactement une `categorie_id` ; sa fiche de déclaration doit correspondre à
    cette catégorie ; l'attestation (quand requise) est liée à cette même œuvre.

### 8.1 Validations serveur attendues

Le serveur doit vérifier, pour chaque envoi de demande :

- `pseudonyme` présent et non vide dans `identite` (adhésion) ;
- chaque œuvre possède une `fiche_declaration` valide (fichier présent, MIME autorisé, taille ≤ 20 Mo) ;
- si le cas est A ou B : chaque œuvre possède au moins une attestation de diffusion ;
- si le cas est C : l'absence d'attestation ne bloque pas l'envoi ;
- le modèle de fiche de déclaration correspond à la `categorie_id` de l'œuvre ;
- chaque `chemin_stockage` désigne un objet réellement présent dans le bucket privé correspondant (`pieces` ou `oeuvres`) ;
- au moins 2 œuvres dans le dossier ;
- photo + CIN présentes dans les pièces ;
- âge ≥ 15 ans, autorisation parentale pour les 15–17 ans.

### 8.2 Formulaires officiels de l'OMDA (point en attente)

Conformément à la règle métier 5, aucun formulaire officiel de déclaration d'œuvre n'a été localisé dans le projet à ce jour. Les points suivants doivent être confirmés par l'OMDA avant tout développement fonctionnel des fiches :

- les modèles de fiche par catégorie et leurs champs réels ;
- si la fiche est remplie directement dans l'application ou déposée sous forme de fichier ;
- si le modèle de fiche est stocké côté serveur ou côté client.

Aucun champ ni aucun formulaire fictif ne doit être créé en attendant ces précisions. Les informations manquantes sont consignées dans `docs/PROGRESS.md`.

## 9) Branchement et environnement

- `EXPO_PUBLIC_API_BASE_URL` : base de l'API Express ;
- `HttpCandidateApi` est l'unique implémentation du contrat `CandidateApi` ;
- tous les endpoints répondent JSON ; toute réponse hors contrat (champ manquant,
  type incohérent) doit produire une erreur `serveur` côté app — **jamais** un
  écran « prêt » affiché sur des données inconnues ;
- versions : `/v1` reste stable ; toute rupture de contrat impose `/v2` ;
- `HttpCandidateApi` (étape 19) impose côté client : délai de **15 s** par
  requête JSON et **120 s** par téléversement (dépassement ⇒ `reseau`) ;
  enveloppe §2 ⇒ `metier` ; 5xx, corps illisible, champ absent ou ENUM inconnu
  ⇒ `serveur` ; contrôles à la lecture : `REJETEE` exige `motif_rejet`,
  `VALIDEE` exige `paiement_du`, `REUSSI` exige `date_confirmation`,
  `ECHEC_*`/`REJETE` exige `motif_echec`, `mode` doit valoir `MOBILE_MONEY` et
  `operateur` `MVOLA` (toute autre valeur, y compris un virement, est refusée),
  un opérateur `actif = false` est écarté de la réponse ;
- `Idempotency-Key` (UUID v4) envoyée sur `POST /v1/paiements` et
  `POST /v1/demandes/{numero_dossier}/envoi` ;
- instanciation : `src/services/factory.ts` (aucun mock, aucun repli).

> **Périmètre** : ce contrat couvre uniquement le parcours candidat/visiteur.
> Le reste (membre connecté) passe par Supabase : `AuthService` (Supabase Auth)
> et `MemberRepository` (tables `utilisateur`, `membre`, `membre_categorie`,
> `oeuvre`, `paiement`, `notification` + buckets `pieces`,
> `oeuvres`).

### 5.2.1 Mise à jour transactionnelle d'un brouillon (implémentation serveur)

`PATCH /v1/demandes/{numero_dossier}` — en-tête `X-Code-Suivi`, corps JSON avec
`identite` partielle et/ou `categorie_id`. Seul un dossier `BROUILLON` est
modifiable. Le serveur vérifie le code de suivi et délègue l'écriture atomique à
`public.omda_mettre_a_jour_brouillon`, définie dans la migration
`0008_mise_a_jour_brouillon_transactionnelle.sql`. La fonction est exécutable
uniquement par `service_role`; elle ne doit jamais être appelée directement par
l'application mobile. Une migration non appliquée provoquera une erreur de
service, sans repli silencieux.

#### Implémentation serveur — téléversement (étape 9)

- L'API limite chaque fichier à 20 Mio (avec une marge dédiée au multipart),
  vérifie le MIME annoncé **et** une signature binaire reconnue, puis refuse les
  formats incohérents ou inconnus.
- Le chemin fourni par le mobile n'est pas utilisé comme destination. Le serveur
  génère un chemin imprévisible `pieces/<UUID>/<nom>` ou `oeuvres/<UUID>/<nom>`
  et retourne ce chemin canonique. Les objets sont envoyés dans le bucket privé
  correspondant via l'API Storage avec la clé de service exclusivement côté serveur.
- Limitation basique : 30 téléversements par heure et par adresse IP, par instance
  du serveur. En production multi-instance, compléter par un limiteur partagé et
  une politique de nettoyage des objets temporaires non rattachés à un dossier.
- Vérifications automatisées : refus du mauvais type de contenu, de signatures
  MIME incohérentes et réponse fermée lorsque Supabase Storage n'est pas configuré.
  Un téléversement réel doit encore être vérifié dans l'environnement Supabase cible.
