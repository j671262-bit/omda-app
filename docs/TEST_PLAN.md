# Plan de test manuel — OMDA Mobile

- **Objet** : vérifier les parcours de l'application sur téléphone (Expo Go ou build de prévisualisation) **sans modifier les règles métier**.
- **Mode par défaut : mocks** — aucune variable `EXPO_PUBLIC_USE_MOCKS_*` ou valeur différente de `false` (voir `docs/BRANCHEMENT.md` §1). Les scénarios propres au **mode réel** sont explicitement signalés.
- **Lancement** : `npx expo start` puis `a` (Android) / `i` (iOS), ou build de prévisualisation (`docs/RELEASE.md`).
- **Jeu de données** : `docs/DONNEES_TEST.md` (dossiers + codes de suivi, comptes membres, numéros Mobile Money, tarifs, référentiels).
- **Vérifications automatiques préalables** : `npx tsc --noEmit` → 0 erreur ; `npx --yes tsx tools/verif-mocks.ts` → `TOUS LES CONTROLES SONT PASSES`.

## Rappels transversaux (à contrôler dans CHAQUE scénario)

| # | Règle | Contrôle |
| --- | --- | --- |
| T1 | Navigation | Aucun menu (TabBar / Drawer / hamburger) côté **Public** et **Candidat** ; `Tabs` uniquement dans l'espace **Membre** connecté |
| T2 | 4 états obligatoires | Chaque écran data-driven affiche : chargement / erreur + « Réessayer » / vide / contenu |
| T3 | Règle du vert | Le vert (`status-success` / `circle-check`) n'apparaît qu'après une **confirmation serveur** (paiement `REUSSI`, œuvre `DEPOT_FINALISE`, session ouverte) ; jamais collé au bouton « Payer » |
| T4 | Aucune valeur en dur | Montants, tarifs, catégories, opérateurs et statuts viennent toujours d'un service (jamais de l'UI) |
| T5 | Paiement | **Mobile Money MVola uniquement** : mode et opérateur affichés en information, **non sélectionnables** ; aucun virement |
| T6 | Langue | Français, vouvoiement ; devise Ariary (Ar) |
| T7 | Montants | Le montant affiché provient **toujours** du service (écran de paiement comme écran de tarifs) |

## 1) Public — documentation et tarifs

**Prérequis** : application ouverte sur l'accueil public ; mode mock.
**Données** : articles publiés `devenir-membre`, `documents-a-fournir`, `vos-droits-d-auteur` ; `article-en-preparation` jamais listé.

| # | Étapes | Résultat attendu |
| --- | --- | --- |
| 1.1 | Accueil → « Documentation » | `LoadingState` puis liste des 3 articles publiés (titre + extrait) ; aucun article codé en dur |
| 1.2 | Ouvrir un article, puis revenir à la liste | Contenu aéré par paragraphes, date de mise à jour affichée, retour fonctionnel |
| 1.3 | Forcer une panne (voir §10) puis ouvrir « Documentation » | `ErrorState` + « Réessayer » ; après « Réessayer » la liste revient (aucun écran blanc) |
| 1.4 | Accueil → « Tarifs & simulateur » | Grille des tarifs (`ADHESION`, `DEPOT_OEUVRE`) et catégories **chargées dynamiquement** |
| 1.5 | Opération `ADHESION` + catégorie « Musicien » | Estimation **120 000 Ar** + mention « Estimation — le montant final est confirmé par le serveur. » |
| 1.6 | Opération `ADHESION` — autre catégorie (Artiste-auteur) | Estimation **150 000 Ar** ; sélecteur de catégorie affiché uniquement pour les opérations qui en dépendent |
| 1.7 | Vérifier les catégories proposées | « Arts numériques » (désactivée) **n'apparaît pas** ; bannière « aucun paiement depuis cet écran » présente |
| 1.8 | « À propos » | Texte institutionnel + rappels clés (aucun paiement à l'envoi, validation ≠ membre), liens fonctionnels |

## 2) Adhésion candidat — identité, catégorie, documents + 2 œuvres + attestations

**Prérequis** : accueil public → « Devenir membre ». Brouillon vide (`AsyncStorage`).
**Rappel** : aucune donnée n'est envoyée avant l'étape 4 ; le brouillon survit à la fermeture de l'app.

| # | Étapes | Résultat attendu |
| --- | --- | --- |
| 2.1 | Étape 1 « Identité » : laisser vide puis renseigner nom, prénom, date de naissance (AAAA-MM-JJ), CIN (12 chiffres), téléphone `+261…`, e-mail, adresse | Messages d'erreur explicites champ par champ ; « Continuer » désactivé tant que l'identité est invalide |
| 2.2 | **Cas < 15 ans** : saisir une date de naissance de moins de 15 ans | Bandeau d'alerte + redirection **bloquante** vers l'écran de refus d'âge (sans menu) ; « Corriger ma date de naissance » revient à l'étape 1 |
| 2.3 | **Cas 15–17 ans** : saisir une date de naissance de 17 ans | `InfoBanner` « Autorisation parentale obligatoire à l'étape documents » ; la suite est accessible |
| 2.4 | Étape 2 « Catégorie » | `LoadingState` puis catégories actives (Artiste-auteur, Écrivain, Musicien) ; aucune valeur codée en dur ; « Continuer » exige une sélection |
| 2.5 | Étape 3 « Documents + œuvres » : téléverser PHOTO, CIN, ACTE_NAISSANCE, CERTIFICAT_RESIDENCE (et AUTORISATION_PARENTALE si 15–17 ans) | Progression 0 → 100 % par tuile ; état « Ajouté » après confirmation ; les 4 pièces exigées sont rappelées en clair |
| 2.6 | Refuser un format interdit en attestation (ex. MP3/WAV) | Message « Format non supporté. Formats autorisés : PDF, JPEG, PNG. » ; le fichier n'est pas envoyé |
| 2.7 | Attestation en **PDF**, puis une autre en **JPEG**, puis une en **PNG** | Les 3 formats sont acceptés ; l'audio reste réservé au fichier de l'œuvre |
| 2.8 | Choisir une pièce de plus de 20 Mo | Refus avant envoi (« Le fichier dépasse la taille maximale de 20 Mo. ») |
| 2.9 | Œuvres : n'en renseigner qu'une (titre + fichier + attestation) | Bandeau « Dossier incomplet » listant le manque ; « Continuer vers le récapitulatif » reste **désactivé** |
| 2.10 | Ajouter une 2ᵉ œuvre complète (titre + fichier + attestation) | Le dossier devient complet ; le bouton « Continuer vers le récapitulatif » s'active |
| 2.11 | Sur une tuile déjà remplie : « Modifier » → « Remplacer le fichier » puis « Modifier » → « Supprimer le fichier » | Remplacement : nouveau fichier affiché, état « Ajouté » ; suppression : retour à « Choisir un fichier » et « Continuer » se désactive |
| 2.12 | Quitter l'application puis revenir à l'étape 3 | Le brouillon (identité, catégorie, pièces et œuvres confirmées) est **conservé** |

## 3) Confirmation d'envoi — copie du numéro et du code (aucun bouton « Partager »)

**Prérequis** : étape 4 « Récapitulatif » avec un dossier complet → « Envoyer ma demande ».

| # | Étapes | Résultat attendu |
| --- | --- | --- |
| 3.1 | Étape 4 : vérifier les 4 sections (Identité, Catégorie, Documents, Œuvres) | Chaque section propose « Modifier : … » qui revient à l'étape correspondante ; aucune donnée de paiement affichée |
| 3.2 | « Envoyer ma demande » | Envoi en cours puis écran 5 : numéro de dossier et **code de suivi affichés en clair** (texte sélectionnable) + pastille de statut |
| 3.3 | « Copier les informations » | Message « Numéro de dossier et code de suivi copiés dans le presse-papiers. » ; coller dans une note pour vérifier **les deux** valeurs (numéro **et** code) |
| 3.4 | Contrôler les actions disponibles | Présents : « Copier les informations », « Sauvegarder sur mon téléphone », « Suivre ma demande », « Retour à l'accueil » |
| 3.5 | Contrôler l'absence de partage | **Aucun bouton ni texte « Partager »** sur l'écran (ni icône de partage) |
| 3.6 | Contrôler les 3 messages obligatoires | « Conservez ces informations… », « Délai indicatif : 72 heures » (valeur du service), « Aucun paiement n'est demandé pour le moment. » |
| 3.7 | « Sauvegarder sur mon téléphone », puis relancer l'application | La sauvegarde est confirmée ; l'écran peut retrouver le dossier sauvegardé (repli local si les paramètres de navigation sont absents) |

## 4) Suivi candidat — numéro + code (mock si pas d'API Express)

**Prérequis** : accueil public → « Suivre ma demande ».
**Données** : `OMDA-2026-000001` / `K7X4-9B2Q` (`VALIDEE`), `OMDA-2026-000003` / `R9F2-4H6K` (`REJETEE`), `OMDA-2026-000004` / `D5N7-1Q8Z` (`ADHESION_TERMINEE`).
**Mode réel** : si `EXPO_PUBLIC_API_BASE_URL` est renseignée et `EXPO_PUBLIC_USE_MOCKS_CANDIDATE=false`, ces appels passent par l'API Express ; **sinon le parcours reste en mock** (comportement voulu, `docs/BRANCHEMENT.md` §2.3).

| # | Étapes | Résultat attendu |
| --- | --- | --- |
| 4.1 | Rechercher avec un numéro ou un code incomplet | Bouton « Rechercher » désactivé ; aucune requête |
| 4.2 | Saisir un numéro inconnu (code valide) | `ErrorState`/bannière métier « Nous ne trouvons aucune demande avec ces informations. » + « Réessayer » |
| 4.3 | Saisir `OMDA-2026-000001` + `K7X4-9B2Q` | Dossier `VALIDEE` : montant dû affiché (150 000 Ar, non vert) + « Effectuer le paiement » |
| 4.4 | Saisir `OMDA-2026-000003` + `R9F2-4H6K` | Dossier `REJETEE` : **motif obligatoire** affiché + action conseillée ; aucun paiement proposé |
| 4.5 | Saisir `OMDA-2026-000002` + `M3P8-7T2W` | Statut en examen : frise `StepTimeline` avec étapes réalisées/en cours horodatées |
| 4.6 | Saisir `OMDA-2026-000004` + `D5N7-1Q8Z` | `ADHESION_TERMINEE` : bannière de succès + « Se connecter » |
| 4.7 | Code de suivi incorrect pour un numéro valide | Refus métier « Le code de suivi ne correspond pas à ce numéro de dossier. » |
| 4.8 | Après 3.3 (dossier sauvegardé) : relancer l'app puis « Suivre ma demande » | Le dernier dossier est pré-rempli depuis l'historique local, sans saisie manuelle |

## 5) Paiement — MVola uniquement (succès / échec / délai) + règle du vert

**Prérequis** : dossier `VALIDEE` (`OMDA-2026-000001` / `K7X4-9B2Q`) → « Effectuer le paiement ».
**Données** : `+261340000001` → `REUSSI` ; `+261340000002` → `ECHEC_SOLDE_INSUFFISANT` ; `+261340000003` → `ECHEC_AUTRE` ; `+261340000004` → `REJETE`.

| # | Étapes | Résultat attendu |
| --- | --- | --- |
| 5.1 | Ouvrir l'écran de paiement | Montant (150 000 Ar) **fourni par le service** ; mode et opérateur **Mobile Money (MVola)** affichés en information, **non sélectionnables** |
| 5.2 | Vérifier avant tout paiement | **Aucun vert** : bouton « Payer » neutre ; aucun `status-success` ni `circle-check` visible |
| 5.3 | Saisir un numéro invalide (ex. `034…`) puis « Payer » | Validation locale bloquante (format `+261…`) ; aucun appel au service |
| 5.4 | Numéro `+261340000001` → « Payer » | `INITIE` → `EN_ATTENTE_CONFIRMATION` (instruction serveur affichée) → **`REUSSI` confirmé** : pastille verte + `circle-check` + montant réglé + date de confirmation |
| 5.5 | Numéro `+261340000002` → « Payer » | `ECHEC_SOLDE_INSUFFISANT` : message + motif du serveur ; **aucun vert** ; « Relancer le paiement » proposé |
| 5.6 | Numéro `+261340000003` → « Payer » | `ECHEC_AUTRE` : message + motif du serveur ; aucun vert |
| 5.7 | Numéro `+261340000004` → « Payer » | `REJETE` : message + motif du serveur ; aucun vert |
| 5.8 | **Délai** : rendre le paiement non final (voir §10, `optionsMock.polls_avant_statut_final` élevé) puis « Payer » | « Délai d'attente dépassé » avec « Vérifier à nouveau » et « Relancer le paiement » ; aucun vert |
| 5.9 | Après un `REUSSI`, ouvrir « Succès adhésion » | L'écran **réinterroge le service** : « Paiement confirmé. » uniquement si `REUSSI` ; montant, références, date, message « Vos identifiants ont été envoyés. », bouton « Se connecter » (aucune connexion automatique) |
| 5.10 | Opérateur désactivé côté « serveur » (`definirOperateurActif('MVOLA', false)`) puis revenir à l'écran de paiement | Aucun opérateur listé ⇒ aucun paiement proposé (état vide explicite) |

## 6) Membre — connexion, mot de passe obligatoire, profil, notifications

**Prérequis** : accueil public → « Se connecter ».
**Données** : mot de passe commun `Omda2026!` ; comptes `membre@omda.mg`, `premiere.connexion@omda.mg`, `vide@omda.mg`, `desactive@omda.mg`, `bloque@omda.mg`.

| # | Étapes | Résultat attendu |
| --- | --- | --- |
| 6.1 | `membre@omda.mg` + `Omda2026!` | Connexion → espace membre (onglets Accueil, Œuvres, Profil, Notifications) ; **aucun menu** hors de ces onglets |
| 6.2 | Accueil | Salutation + numéro d'adhérent, pastille de statut, nombre d'œuvres et notifications non lues ; « Actualiser » rejoue l'appel |
| 6.3 | Identifiants erronés | `IDENTIFIANTS_INVALIDES` : « E-mail ou mot de passe incorrect… » ; aucune session créée |
| 6.4 | `desactive@omda.mg` | `COMPTE_DESACTIVE` : message dédié, connexion refusée |
| 6.5 | `bloque@omda.mg` : 3 échecs consécutifs, puis une 4ᵉ tentative **même avec le bon mot de passe** | `TROP_DE_TENTATIVES` + action directe « Mot de passe oublié » |
| 6.6 | **Mot de passe obligatoire** : `premiere.connexion@omda.mg` | Redirection immédiate vers l'écran bloquant de changement (sans retour arrière) ; règles visibles en direct (8 caractères, majuscule, minuscule, chiffre, confirmation identique) ; bouton désactivé tant qu'elles ne sont pas satisfaites ; « Annuler et me déconnecter » ramène à la connexion |
| 6.7 | Valider un nouveau mot de passe conforme | Redirection vers l'accueil membre ; se reconnecter **ne rebloque pas** l'écran (drapeau `doit_changer_mot_de_passe` remis à `false`) |
| 6.8 | « Mot de passe oublié » avec une adresse inconnue puis avec `membre@omda.mg` | **Réponse identique** dans les deux cas (« Si un compte membre OMDA est associé à l'adresse… ») : aucune fuite sur l'existence du compte |
| 6.9 | Profil : modifier le téléphone (format `+261` + 9 chiffres) puis « Enregistrer » | « Enregistrer » désactivé tant que la valeur n'a pas changé ; après appel : bannière de confirmation ; format invalide ⇒ message d'erreur, rien n'est envoyé |
| 6.10 | Profil : vérifier les informations en lecture seule | E-mail, numéro d'adhérent, rôle, statut du compte, date d'adhésion, dernière connexion — pastille « Non modifiable » |
| 6.11 | Notifications : « Marquer comme lue » sur une notification puis « Tout marquer comme lu » | Pastilles « Non lue » → « Lue », compteurs « Non lues (n) » / « Lues (n) » mis à jour ; l'annonce globale n'a **pas** de bouton individuel (message explicatif) |
| 6.12 | `vide@omda.mg` : Accueil, Profil, Notifications | États vides pilotés par les données (« aucune activité », « aucune catégorie », « aucune notification ») — jamais un écran blanc |
| 6.13 | Profil → « Se déconnecter » | Écran de déconnexion dédié avec confirmation **dans l'écran** (aucun `Alert`) ; « Oui, me déconnecter » → retour à l'**accueil public** ; « Annuler » → retour à l'onglet précédent |
| 6.14 | Après déconnexion : tenter d'ouvrir une route de l'espace membre | Redirection vers l'accueil public (aucun accès sans session) |

## 7) Œuvres — liste, recherche/filtre, dépôt, modification, fiche, paiement du dépôt

**Prérequis** : session `membre@omda.mg` (3 œuvres : « La varangue » `VALIDEE`, « Le chant des rizières » `EN_COURS_DE_VALIDATION`, « Récit sans titre » `REJETEE`).

| # | Étapes | Résultat attendu |
| --- | --- | --- |
| 7.1 | Onglet « Œuvres » | Liste data-driven avec pastille de statut par œuvre ; le motif de rejet est affiché pour « Récit sans titre » ; une **seule** pastille verte possible (`DEPOT_FINALISE`) |
| 7.2 | Filtre par statut | La liste est rechargée par le service pour le statut choisi ; état vide filtré distinct de l'état vide global |
| 7.3 | **Recherche** : saisir `varangue` | « 1 résultat » ; filtre local par titre **et** description, insensible à la casse ; « Effacer la recherche » rétablit la liste |
| 7.4 | **Filtre par catégorie** | Visible uniquement si le membre a 2 catégories ou plus (voir §8) ; options « Toutes les catégories » + catégories du membre |
| 7.5 | **Dépôt** : « Déposer une œuvre » → titre, catégorie, description, année, fichier de l'œuvre **et** attestation (PDF/JPEG/PNG) | Brouillon créé d'abord ; progression 0 → 100 % ; refus local au-delà de 20 Mo ou format non autorisé |
| 7.6 | Quitter puis « Reprendre le dépôt » | Valeurs et fichiers déjà confirmés repris (état `BROUILLON`) |
| 7.7 | « Envoyer l'œuvre » | Statut `ENVOYEE` + message explicite « Aucun paiement à cette étape » (règle métier 4) |
| 7.8 | Fiche de l'œuvre déposée | Sections « Informations sur l'œuvre » **toujours** affichées (« — » si valeur absente) et « Attestation de diffusion » en lecture seule (pastille « Ajoutée » / « Manquante ») |
| 7.9 | **Modification autorisée** : `BROUILLON`, `ENVOYEE` ou `EN_COURS_DE_VALIDATION` → « Modifier les informations » / « Modifier mon œuvre » | Formulaire pré-rempli ; « Enregistrer les modifications » inactif tant que rien n'a changé ; après enregistrement : bannière de confirmation, statut **inchangé**, aucun nouveau paiement |
| 7.10 | **Modification interdite** : `VALIDEE`, `REJETEE` ou `DEPOT_FINALISE` | Aucun bouton de modification ; message invitant à déposer une nouvelle œuvre |
| 7.11 | Fiche d'une œuvre audio (« La varangue ») → « Écouter l'œuvre » | Lecture dans l'application (lecture/pause, chronomètre, retour au début) ; format non audio : « Aperçu audio indisponible pour ce format. » |
| 7.12 | Contrôler les actions de la fiche | **Aucun** bouton « Ouvrir le fichier » ni « Partager » |
| 7.13 | **Paiement du dépôt** : fiche de « La varangue » (`VALIDEE`) → « Payer les frais de dépôt » | `AmountCard` **50 000 Ar** fournie par le service ; écran de paiement membre → `+261340000001` → `REUSSI` confirmé |
| 7.14 | Après le paiement : revenir à la fiche et à l'onglet Œuvres | Œuvre passée en `DEPOT_FINALISE` (pastille **verte**, effet serveur) ; aucun bouton de paiement ; notification « Paiement confirmé » ajoutée |

## 8) Catégorie supplémentaire — demande, statuts, annulation

**Prérequis** : session `membre@omda.mg` (1 catégorie active : « Artiste-auteur »).

| # | Étapes | Résultat attendu |
| --- | --- | --- |
| 8.1 | Profil → « Demander une catégorie supplimentaire » | Écran 1 : sélecteur « Catégorie souhaitée » limité aux catégories actives **non** déjà présentes au profil (mention « Déjà dans votre profil : … ») ; « Continuer vers les œuvres » désactivé tant que rien n'est choisi |
| 8.2 | Choisir « Écrivain » → « Continuer vers les œuvres » | Écran 2 : **2 œuvres minimum** avec titre, fichier et attestation (PDF/JPEG/PNG), 20 Mo max ; action désactivée tant que le minimum n'est pas atteint |
| 8.3 | Valider une demande conforme → « Envoyer ma demande » | « Demande transmise » + pastille « Demande en attente » (`EN_ATTENTE`) ; **aucune activation locale** de la catégorie |
| 8.4 | Retour au Profil | Phrase horodatée « Demande envoyée le … : en attente de la décision d'un agent OMDA » ; la catégorie supplémentaire apparaît « En attente » (l'onglet Œuvres n'affiche que les catégories actives) |
| 8.5 | Relancer une demande sur la même catégorie (règle « une seule demande ») | L'action n'est **pas** proposée tant que la demande est `EN_ATTENTE` ou `ACCEPTEE` |
| 8.6 | `EN_ATTENTE` → « Annuler la demande » → confirmation « Oui, annuler la demande » | Statut `ANNULEE` sans confirmation système (dans l'écran) ; phrase « Demande annulée le … : vous pouvez la demander à nouveau. » ; phrase identique si l'annulation se fait pendant l'envoi |
| 8.7 | Après annulation : relancer une demande | Écran 1 de nouveau accessible (nouvelle demande possible) |
| 8.8 | Référence serveur en doublon (`CATEGORIE_DEJA_DEMANDEE`) | Message d'erreur serveur affiché ; nouvelle tentative réaffiche l'état d'attente existant |
| 8.9 | Écran 2 : visibilité du filtre de catégorie (voir 7.4) | Après **acceptation** (catégorie active) : l'onglet Œuvres affiche le filtre par catégorie et l'onglet « Mes catégories » liste les 2 catégories |
| 8.10 | Scénarios d'échec | Envoi impossible hors écran 2 (pas de vraie requête hors parcours) ; état vide « Vous avez déposé toutes les catégories supplémentaires » si plus rien n'est demandable |

## 9) Simulations de panne et options de service (mode mocks)

Les fonctions ci-dessous se déclenchent depuis le code (appelées dans `tools/verif-mocks.ts` ou un snippet temporaire) : elles servent à vérifier les états d'erreur et de chargement **sans toucher aux règles métier**.

| # | Simulation (indicatif de code) | Résultat attendu à l'écran |
| --- | --- | --- |
| 9.1 | `forcerErreurReseau(true)` puis utiliser l'application | États d'erreur réseau avec action « Réessayer » (jamais un écran vide) ; `forcerErreurReseau(false)` rétablit le service |
| 9.2 | `forcerErreurServeur(true)` | États d'erreur serveur (500) avec « Réessayer » ; message serveur affiché s'il est renvoyé |
| 9.3 | `definirDelaisMock(3000, 5000)` | Les états de chargement (squelette / « Chargement… ») sont observables sur les écrans concernés |
| 9.4 | `optionsMock.polls_avant_statut_final` élevé puis « Payer » (voir 5.8) | Paiement non final → « Délai d'attente dépassé » + « Vérifier à nouveau » / « Relancer le paiement » |
| 9.5 | `definirOperateurActif('MVOLA', false)` (voir 5.10) | Aucun opérateur proposé ; état vide explicite, aucun bouton de paiement |
| 9.6 | Réinitialisation : `reinitialiserOptionsMock()` (ou `definirDelaisMock(0, 0)` + flags à `false`) | Service de démonstration de retour à l'état nominal pour les scénarios suivants |

> Ces réglages sont **éphémères en mémoire** : ils repartent de la configuration nominale au redémarrage de l'application, ce qui évite tout effet de bord sur les autres scénarios.

## 10) Récapitulatif de campagne de tests

| Bloc | Scénarios | Statut |
| --- | --- | --- |
| Transversaux (T1–T7) | Aucune modification des règles métier, mocks par défaut, absence de « # » dans les sources, CRLF, contrôles d'écran, Ariary, états d'erreur | ☐ |
| §1 Public | 5 cas | ☐ |
| §2 Adhésion | 12 cas | ☐ |
| §3 Confirmation | 7 cas | ☐ |
| §4 Suivi | 8 cas | ☐ |
| §5 Paiement MVola | 10 cas | ☐ |
| §6 Membre | 14 cas | ☐ |
| §7 Œuvres | 14 cas | ☐ |
| §8 Catégorie supplémentaire | 10 cas | ☐ |
| §9 Panne / simulations | 6 cas | ☐ |

**Critères de sortie d'une campagne** : tous les scénarios ci-dessus au vert, `npx tsc --noEmit` sans erreur, `npx --yes tsx tools/verif-mocks.ts` → « TOUS LES CONTROLES SONT PASSES ». Toute anomalie est consignée avec son numéro de scénario dans le rapport de recette.

