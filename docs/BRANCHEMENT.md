# Branchement réel (Supabase + API Express) — OMDA Mobile

- **Étape** : 27 — « 100 % réel : plus aucun mock ».
- **Principe** : l'application n'utilise que des services réels. Les écrans et
  `AuthContext` consomment les singletons de `src/services/factory.ts`
  (`authService`, `memberRepository`, `publicContentService`, `candidateApi`).
  Les dossiers `src/services/mocks`, `tools/verif-mocks.ts` et les drapeaux
  `EXPO_PUBLIC_USE_MOCKS*` ont été supprimés.

---

## 1) Variables d'environnement

Copiez `.env.example` en `.env` (fichier ignoré par git) et complétez :

| Variable | Obligatoire | Rôle |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | oui | URL du projet Supabase |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | oui | Clé publique anonyme (`anon`) |
| `EXPO_PUBLIC_API_BASE_URL` | oui (parcours candidat) | URL de base de l'API REST Express, **sans barre finale** : `HttpCandidateApi` ajoute lui-même `/v1` |

Une variable absente ne fait jamais planter le démarrage :
- Supabase non configuré ⇒ chaque appel renvoie un refus `serveur` « Supabase n'est pas configuré… » ;
- API non configurée ⇒ chaque appel du parcours candidat renvoie un refus `serveur` « L'API OMDA n'est pas configurée… ».

Dans les deux cas, les écrans affichent une erreur avec « Réessayer » : jamais de
données inventées ni de succès simulé.

> Préfixe `EXPO_PUBLIC_` : ces valeurs sont intégrées au bundle et sont donc
> **publiques**. N'y mettez jamais de clé `service_role` ni de secret.

Après modification de `.env`, **redémarrez Metro** (`npx expo start -c`).

---

## 2) Services

| Singleton exporté | Parcours | Implémentation |
|---|---|---|
| `authService` | Membre | `SupabaseAuthService` |
| `memberRepository` | Membre | `SupabaseMemberRepository` (DB + Storage) |
| `publicContentService` | Public / membre | `SupabasePublicContentService` (lecture seule) |
| `candidateApi` | Candidat | `HttpCandidateApi` (API Express) |

### Parcours candidat : API Express

Chaque URL est composée `EXPO_PUBLIC_API_BASE_URL` + `/v1` + chemin :

| Méthode `CandidateApi` | Requête (après `baseURL` + `/v1`) |
|---|---|
| `creerDemande` | `POST /demandes` |
| `mettreAJourDemande` | `PATCH /demandes/{numero_dossier}` |
| `soumettreDemande` | `POST /demandes/{numero_dossier}/envoi` (+ `Idempotency-Key`) |
| `televerserFichier` | `POST /fichiers` (multipart) |
| `suivreDemande` | `GET /suivi/{numero_dossier}` |
| `obtenirOptionsPaiement` | `GET /paiements/options/{numero_dossier}` |
| `initierPaiement` | `POST /paiements` (+ `Idempotency-Key`) |
| `obtenirEtatPaiement` | `GET /paiements/{reference_interne}` |

En-têtes : `X-Numero-Dossier` / `X-Code-Suivi` (dès qu'un dossier est connu) et
`Idempotency-Key` ; délai **15 s** par requête JSON et **120 s** par
téléversement. Contrat complet : `docs/API_CANDIDAT.md`.

### Espace membre et contenus publics : Supabase

Tables lues ou écrites : `utilisateur`, `membre`, `membre_categorie`,
`categorie`, `oeuvre`, `attestation_diffusion`, `paiement`, `notification`,
`documentation`, `tarif`, `operateur_mobile_money`. Les cotisations annuelles sont exclues du schéma cible ; appliquer la migration `0006_suppression_cotisations.sql` après sauvegarde et vérification du précontrôle.

Règles appliquées par `SupabasePublicContentService` : un élément `actif = false`
ou `publie = false` est absent des listes ; un tarif hors de sa période de
validité (`date_debut` / `date_fin`) n'est jamais proposé.

---

## 3) Buckets Storage attendus

| Bucket | Usage | Accès |
|---|---|---|
| `pieces` | Pièces justificatives du candidat : `PHOTO`, `CIN` légalisée, `ACTE_NAISSANCE`, `CERTIFICAT_RESIDENCE`, `AUTORISATION_PARENTALE` (15–17 ans) | Privé |
| `oeuvres` | Fichiers d'œuvre (MP3, WAV, PDF, JPEG, PNG) **et** attestations de diffusion (PDF, JPEG, PNG uniquement) | Privé |

Contraintes appliquées côté application : **20 Mo maximum** par fichier ;
attestation de diffusion limitée à `application/pdf`, `image/jpeg`, `image/png`.

---

## 4) Politiques RLS et migrations

RLS **activée sur toutes les tables** ; aucune règle n'est déléguée à l'UI. Les
politiques du script initial (`docs/SCHEMA_DB.md`) sont complétées par les
migrations de `supabase/migrations/`, à exécuter **dans l'éditeur SQL de
Supabase** (Dashboard → **SQL Editor** → *New query* → coller → **Run**),
**après** le script initial et **dans l'ordre** :

| Ordre | Fichier | Ce qu'il apporte |
|---|---|---|
| 1 | `0001_oeuvre_membre.sql` | `UPDATE` du membre sur ses propres œuvres, limité aux statuts `BROUILLON` / `ENVOYEE` / `EN_COURS_DE_VALIDATION` |
| 2 | `0002_attestation_diffusion_membre.sql` | `SELECT` / `INSERT` / `UPDATE` des attestations par le propriétaire de l'œuvre (jamais de `DELETE`) + contrainte sur `mime_type` |
| 3 | `0003_membre_categorie_membre.sql` | `INSERT` d'une demande `EN_ATTENTE` par le membre + annulation uniquement (`EN_ATTENTE` ⇒ `ANNULEE`) |
| 4 | `0004_contenus_publics_paiement_membre.sql` | Table `operateur_mobile_money` (MVola) ; garde-fou d'`INSERT` sur `paiement` ; protection des colonnes sensibles de `utilisateur` |
| 5 | `0005_securite_roles_et_paiements.sql` | Rôle `MEMBRE` imposé à la création du compte ; retrait du paiement de cotisation côté membre |
| 6 | `0006_suppression_cotisations.sql` | Suppression conditionnelle des structures de cotisation après précontrôle des données |
| 7 | `0007_garde_fou_paiement_authentification.sql` | Refuse les insertions de paiement sans session, sauf rôle serveur de confiance ; impose un contexte paiement exclusif |

Exécuter les migrations dans l’ordre après le schéma initial. La migration 0006 est volontairement bloquante si des données de cotisation subsistent. La migration 0007 doit être validée sur une copie de la base avant production ; ne pas considérer ces scripts comme exécutés tant qu’ils ne l’ont pas été dans Supabase.

> **Pourquoi la migration 0004 est importante** : sans elle, la table
> `operateur_mobile_money` n'existe pas (le paiement membre est alors impossible),
> un membre pourrait choisir lui-même le montant d'un paiement, et la politique
> `utilisateur_update_self_or_admin` du script initial lui permettrait de modifier
> son propre `role` depuis l'API.

> **Limite connue** : la réouverture d'une demande de catégorie (`ANNULEE` /
> `REJETEE` ⇒ `EN_ATTENTE`) reste bloquée par RLS (migration 0003 : annulation
> seule).

---

## 5) Paiements : ce que fait l'application, ce que fait le serveur

- `initierPaiement` (membre) vérifie le mode (MVola), l'opérateur actif, le numéro
  `+261…`, le statut de l'œuvre (`VALIDEE`) et l'absence de paiement déjà
  `REUSSI`, puis insère un paiement `INITIE`. Le montant vient de la grille
  `tarif`, jamais de l'écran.
- `obtenirPaiement` lit l'état (polling).
- **La confirmation `REUSSI` / `ECHEC` n'est jamais écrite par l'application** :
  elle doit venir d'un composant serveur relié à MVola (API Express ou fonction
  Edge) qui met à jour le statut de l'œuvre et les notifications. Tant que
  ce composant n'existe pas, un paiement reste « en attente ».

---

## 6) Dépannage

| Symptôme | Cause probable |
|---|---|
| « Supabase n'est pas configuré… » | `EXPO_PUBLIC_SUPABASE_URL` ou `EXPO_PUBLIC_SUPABASE_ANON_KEY` vide |
| « L'API OMDA n'est pas configurée… » | `EXPO_PUBLIC_API_BASE_URL` vide |
| Les listes publiques (catégories, tarifs, documentation) sont vides | Tables non renseignées, ou lignes `actif = false` / `publie = false` |
| Aucun opérateur de paiement proposé | Migration 0004 non exécutée, ou opérateur désactivé |
| Paiement refusé avec une erreur serveur | Migration 0004 : œuvre non `VALIDEE` ou tarif absent |
| Le paiement reste « en attente » | Pas de composant serveur pour confirmer les paiements MVola (§5) |
| Les variables ne sont pas prises en compte | Metro n'a pas été redémarré (`npx expo start -c`) |


## Migrations 0005–0006 — sécurité et nettoyage du schéma

Appliquer les migrations dans l'ordre. La migration `0005_securite_roles_et_paiements.sql` force le rôle `MEMBRE` à l'inscription et sécurise les paiements. La migration `0006_suppression_cotisations.sql` retire les structures de cotisation uniquement si son précontrôle confirme qu'aucune ligne de cotisation, aucun paiement de cotisation et aucun tarif de cotisation ne subsistent. Sauvegarder la base avant toute migration.
