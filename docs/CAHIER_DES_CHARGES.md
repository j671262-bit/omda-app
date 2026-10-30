# Cahier des charges — OMDA **Application mobile uniquement** (iOS / Android)

## 0) Objectif de la mission (ce que l’IA doit livrer)
Produire une **application mobile React Native (Expo) opérationnelle**, compilable et navigable, incluant :
- tous les écrans mobile décrits ci-dessous,
- un design system NativeWind conforme à la palette OMDA,
- une navigation conforme (linéaire côté public/candidat, TabBar côté membre),
- une couche “data” **déjà structurée** (services + modèles + gestion d’états) afin que **le seul travail restant** soit de **brancher** les appels réels à Supabase (Auth + DB + Storage) et à l’API REST (Node/Express) côté candidat.

### Important — Interdiction formelle
- **Ne jamais concevoir ni générer de back-office web**, ni d’écrans admin/agent, ni de fonctionnalités staff.
- Tout le périmètre ci-dessous est **exclusivement mobile**.
- Les cotisations annuelles sont exclues de cette version ; seuls les paiements d’adhésion et de dépôt d’œuvre après validation sont conservés.

---

## 1) Périmètre fonctionnel (mobile)

### Utilisateurs cibles
1) **Visiteur (sans compte)**
   - Consulte : documentation, tarifs/simulateur, à propos
   - Peut démarrer une demande d’adhésion

2) **Candidat (sans compte)**
   - Remplit une demande (identité → catégorie → documents/œuvres → récapitulatif → envoi)
   - Suit l’état via **Numéro de dossier + Code de suivi**
   - Peut payer **uniquement** si la demande est **VALIDÉE**
   - Ne se connecte jamais (pas de compte candidat)

3) **Membre (connecté)**
   - Auth via **Supabase Auth**
   - Accès via TabBar : Accueil, Œuvres, Profil, Notifications

---

## 2) Contraintes techniques obligatoires (mobile)
- **React Native**
- **Expo**
- **TypeScript**
- **NativeWind** (Tailwind compatible RN)
- **FontAwesome** via Expo (`@expo/vector-icons`, pack FontAwesome)

### Exigences de livrable “opérationnel”
L’IA doit générer un projet qui :
- démarre avec `npx expo start`,
- affiche et enchaîne les écrans,
- gère les états `loading / erreur / vide / contenu`,
- contient une **couche data mockable** :
  - Services/API typés (interfaces),
  - Données factices (mock) par défaut,
  - Points d’extension clairs pour brancher Supabase et l’API Express.

---

## 3) Règles UX majeures (contexte Madagascar / mobile modeste)
- Téléphones modestes, réseau instable, utilisateurs peu habitués
- Priorités :
  - grandes zones tactiles
  - contraste élevé
  - typographie lisible en plein soleil
  - parcours guidés, linéaires
  - **états visibles partout** : Chargement / Erreur / Réessayer

---

## 4) Langue / devise / règles d’affichage
- Langue : **français** (vouvoiement)
- Devise : **Ariary (Ar)**
- Montants : **toujours dynamiques** (provenant du serveur / API / DB)
  → Dans la version livrée sans backend, utiliser des **mocks** mais **interdire** les montants “codés en dur” dans les composants UI : ils doivent venir d’un service (mockable) comme s’ils venaient du serveur.

### Règle critique (paiement)
L’app n’annonce un succès (paiement, validation, changement de statut) **qu’après confirmation serveur**.
Dans la version mock : simuler cette confirmation via un service (polling simulé), mais conserver la logique “confirmation externe”.

---

## 5) Palette officielle OMDA (obligatoire, stricte)
| Couleur | Rôle | Valeur |
|---|---|---|
| Vert OMDA | marque + succès confirmé | `#2E7A46` |
| Vert OMDA foncé | variantes sombres | `#205C35` |
| Ocre OMDA | en attente/en cours | `#C79A3B` |
| Ocre OMDA foncé | variantes | `#A87E2C` |
| Noir OMDA | texte principal | `#1A1A1A` |
| Blanc | fond/cartes | `#FFFFFF` |
| Gris clair chaud | fond page | `#F5F4EF` |
| Gris moyen chaud | bordures | `#DDD9CE` |
| Gris texte | secondaire | `#6B675E` |
| Rouge erreur | erreurs/rejet | `#B3261E` |
| Bleu-gris info | info neutre | `#2E4A66` |

### Règle critique (couleur verte)
**Ne jamais utiliser le Vert OMDA de manière décorative à proximité d’un bouton “Payer” tant que le serveur n’a pas confirmé `statut = REUSSI`.**
Le vert = succès confirmé uniquement.

---

## 6) Tokens NativeWind obligatoires (pas de hex partout)
L’IA doit définir les couleurs OMDA en tokens Tailwind/NativeWind (ex : `omda-green`, `omda-ochre`, etc.) + tokens sémantiques :
- `status-success` = vert OMDA
- `status-pending` = ocre OMDA
- `status-error` = rouge
- `status-info` = bleu-gris info

---

## 7) Iconographie FontAwesome (fonctionnelle + accessible)
- Icônes **jamais décoratives** : toujours un libellé texte à côté si action importante
- Couleurs :
  - défaut : `omda-black` / `omda-textGray`
  - statuts : `status-*` uniquement

Mapping recommandé :
- Dossier : `faFolderOpen` / `faFileLines`
- Suivi : `faMagnifyingGlass`
- Paiement : `faMoneyBillWave` / `faCreditCard`
- Mobile Money : `faMobileScreenButton`
- Upload : `faCloudArrowUp`
- Document : `faFilePdf`, `faIdCard`, `faImage`
- Succès : `faCircleCheck` (status-success)
- Attente : `faClock` (status-pending)
- Échec/rejet : `faCircleXmark` (status-error)
- Info : `faCircleInfo` (status-info)

---

## 8) Navigation — contrainte IMPÉRATIVE
### Public + Candidat
- **Aucun menu** (pas de TabBar, pas de Drawer, pas de hamburger)
- Navigation **linéaire** : Stack + bouton retour

### Membre connecté
- TabBar uniquement dans l’espace membre :
  - Accueil
  - Œuvres
  - Profil
  - Notifications

---

## 9) Accès aux données (architecture à respecter dans le code)

### 9.1 Candidat (sans compte) : via API REST Express (pas accès direct DB)
Le mobile doit consommer une API REST (à brancher plus tard) pour :
- suivi public (numéro + code)
- options de paiement disponibles (modes + opérateurs actifs)
- initiation + polling paiement

**Dans la version livrée** : implémenter un `CandidateApi` typé avec une implémentation `MockCandidateApi` par défaut, et une implémentation `HttpCandidateApi` prête à brancher (baseURL via env).

### 9.2 Membre (connecté) : Supabase
- Auth : Supabase Auth
- Données : `utilisateur`, `membre`, `membre_categorie`, `oeuvre`, `paiement`, `notification`
- Storage : `pieces`, `oeuvres`

**Dans la version livrée** : mettre en place une couche `MemberRepository` typée avec `MockMemberRepository` par défaut + squelette `SupabaseMemberRepository`.

---

## 10) Règles métier (doivent être visibles dans l’UI)
1. Aucun paiement à l’envoi du dossier
2. Validation ≠ membre (membre seulement après paiement confirmé)
3. Candidat : suivi + paiement initial = public (numéro + code)
4. Œuvre : envoi → validation → paiement → dépôt finalisé (jamais de paiement à l’envoi)
5. Paiement “réussi” uniquement si serveur confirme `paiement.statut=REUSSI`
6. Mobile Money : confirmation serveur automatique (polling)
7. Âge :
   - < 15 : refus bloquant
   - 15–17 : autorisation parentale obligatoire
   - ≥ 18 : pas d’autorisation
8. Adhésion : au moins 2 œuvres + fiche de déclaration obligatoire par œuvre ; attestation de diffusion obligatoire par œuvre uniquement dans les cas A (adhésion non-membre) et B (catégorie supplémentaire), non obligatoire dans le cas C (dépôt dans catégorie déjà détenue) — voir règle métier 3 de `docs/AI_RULES.md` (remplace l'ancienne règle "1 attestation par œuvre" systématique).
9. Catégorie supplémentaire possible via `membre_categorie`
10. Première connexion : changement mot de passe obligatoire si `doit_changer_mot_de_passe=true`
11. Délai affiché informatif : 72h
12. Rejet : motif obligatoire
13. Chaque écran important : `Loading / Contenu / Vide / Erreur + Réessayer`
14. Opérateurs Mobile Money : liste **dynamique** (si désactivé côté serveur → absent)

---

## 11) Écrans mobile à implémenter (tous)

### A. Démarrage
- Splash (logo OMDA + nom complet) + chargement discret

### B. Accueil public (sans menu)
- Boutons verticaux :
  1) Devenir membre (primaire)
  2) Suivre ma demande
  3) Se connecter
- Liens : Documentation, Tarifs (simulateur), À propos

### C. Documentation (sans menu)
- Liste articles publiés
- Détail article (lecture confortable)

### D. Tarifs / Simulateur (sans menu)
- Type opération : adhésion / dépôt d’œuvre
- Catégorie si requis
- Montant estimatif (dynamique via service)
- Mention : “Estimation — le montant final est confirmé par le serveur.”

### E. Connexion membre
- email + mot de passe
- mot de passe oublié
- erreurs distinctes (mock + structure réelle)

### F. Mot de passe oublié
- saisie email
- confirmation sans révéler si compte existe

### G. Changement obligatoire mot de passe (bloquant)
- nouveau mdp + confirmation + règles visibles
- impossible d’accéder au reste tant que non validé

---

## 12) Parcours adhésion (public, sans menu) — avec progression

### H. Étape 1 — Identité
Champs : nom, prénom, date naissance, CIN, téléphone +261, email, adresse
Cas :
- < 15 : écran blocage + retour accueil
- 15–17 : info “autorisation parentale requise”

### I. Étape 2 — Catégorie
- Liste des catégories actives
- Description courte

### J. Étape 3 — Documents + œuvres
Documents à uploader + statut :
- PHOTO, CIN légalisée, ACTE_NAISSANCE, CERTIFICAT_RESIDENCE
- AUTORISATION_PARENTALE si 15–17
Œuvres :
- au moins 2 œuvres
- chaque œuvre a une attestation de diffusion

Contraintes upload :
- 20 Mo max
- progression + retry + gestion coupure réseau

### K. Récapitulatif (modifiable)
- sections éditables
- bouton “Envoyer ma demande” activé seulement si complet

### L. Confirmation d’envoi (écran critique)
- Numéro dossier + Code de suivi en clair
- Actions : copier / partager / sauvegarder
- Messages :
  - “Conservez ces informations…”
  - “Délai indicatif : 72 heures”
  - “Aucun paiement n’est demandé pour le moment.”

---

## 13) Parcours suivi / paiement candidat (public, sans menu)

### M. Suivi de demande
- Champs : numéro dossier + code suivi
- Résultat :
  - statut + timeline
  - dernière mise à jour
  - si rejet : motif + action
  - si validée : montant dynamique + bouton payer

### N. Paiement candidat
- Objet “Frais d’adhésion”, montant non modifiable
- Mode unique : Mobile Money (MVola) — opérateur servi par le serveur, non sélectionnable
- États paiement (UI + mapping)
  - INITIE, EN_ATTENTE_CONFIRMATION, REUSSI, REJETE, ECHEC_*, etc.

Mobile Money :
- opérateur proposé = uniquement s'il est actif (liste dynamique servie par le serveur)
- numéro +261
- polling statut

### O. Succès adhésion (après paiement confirmé)
Uniquement si serveur confirme `REUSSI` + adhésion finalisée
- “Paiement confirmé.”
- numéro adhérent si dispo
- “Vos identifiants ont été envoyés.”
- bouton : “Se connecter” (ne pas connecter automatiquement)

---

## 14) Espace membre (connecté, TabBar visible)

### P. Accueil membre
- Bonjour + prénom, numéro adhérent, statut compte
- nombre d’œuvres, notifications non lues

### Q. Œuvres
- liste œuvres + statuts
- empty state si aucune œuvre

### R. Dépôt d’œuvre (flow)
- création brouillon
- champs : titre, catégorie, description, année, fichier, attestation
- envoi : ENVOYEE, aucun paiement

### S. Fiche œuvre
- selon statut : actions adaptées (payer seulement si VALIDEE)

### U. Profil
- infos utilisateur + membre + catégories
- distinguer modifiable vs lecture

### V. Notifications
- liste + lues/non lues

### W. Déconnexion
- confirmation, retour accueil public (sans menu)

---

## 15) Composants UI obligatoires (NativeWind)
L’IA doit implémenter ces composants réutilisables (avec variantes) :
- `Button` (primary/secondary/destructive + disabled/loading)
- `TextField` (label/help/error)
- `SelectField`
- `UploadTile` (progression/retry/statut)
- `StatusPill` (success/pending/error/info)
- `StepTimeline`
- `AmountCard`
- `InfoBanner`
- `EmptyState`
- `ErrorState` (message + “Réessayer”)
- `LoadingState`

---

## 16) Règles de qualité / acceptance criteria
L’application est considérée “prête à brancher” si :
- Tous les écrans sont présents + navigation conforme (pas de menu côté public)
- Les statuts et interdictions (paiement, vert réservé au succès confirmé) sont respectés
- Chaque écran critique a : normal + loading + erreur réseau + erreur serveur + vide si applicable
- Les montants et listes dynamiques (catégories, opérateurs, tarifs) viennent **d’un service** mockable (pas en dur dans l’UI)
- Architecture data claire :
  - `services/` (API clients, repositories)
  - `models/` (types)
  - `screens/`
  - `components/`
  - `navigation/`
  - `theme/` (tokens)
- Variables d’environnement prévues :
  - `EXPO_PUBLIC_API_BASE_URL` (API Express candidat)
  - `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`

---

## 17) Processus imposé à l’IA (ordre strict)
1) Générer la structure du projet Expo + NativeWind + FontAwesome + navigation
2) Implémenter design tokens OMDA (NativeWind)
3) Implémenter composants UI obligatoires
4) Implémenter écrans Public + parcours adhésion (avec mocks)
5) Implémenter suivi + paiement candidat (mock polling)
6) Implémenter Auth membre + zone membre (mock repo + squelette Supabase)
7) Ajouter variantes d’état (loading/erreur/vide) sur tous les écrans critiques
8) Audit final de conformité (navigation, couleurs, statuts, paiements confirmés serveur)

---

### Note finale à l’IA
Vous ne devez produire **que l’application mobile**.
Aucun back-office, aucun écran admin/agent, aucun design web.

L’objectif est une app **fonctionnelle en local** avec données mockées et une couche data prête à brancher à Supabase + API Express, sans devoir refondre l’UI ni la navigation.
