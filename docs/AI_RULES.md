# OMDA Mobile — Règles strictes

- Construire UNIQUEMENT l’app mobile (iOS/Android). Interdiction de générer un back-office web (admin/agent).
- Stack : Expo + React Native + TypeScript + Expo Router + NativeWind + FontAwesome (@expo/vector-icons).
- Français (vouvoiement). Devise : Ariary (Ar).
- Navigation : aucun menu (TabBar/Drawer/hamburger) côté Public/Candidat. Tabs uniquement côté Membre connecté.
- Couleurs : uniquement via tokens NativeWind (omda-* et status-*). Pas de couleurs hex dans les composants.
- Le vert (status-success) = succès confirmé serveur uniquement. Jamais près de “Payer” avant REUSSI confirmé.
- Aucun montant/catégorie/opérateur/tarif codé en dur dans l’UI : tout vient d’un service (mockable).
- Chaque écran data-driven : Loading / Erreur + “Réessayer” / Vide / Contenu.
- Ne faire QUE l’étape demandée (pas d’anticipation).
- À la fin de l’étape : mettre à jour docs/PROGRESS.md + vérifier `npx tsc --noEmit`.

---

## Règles métier — identité, documents et œuvres (obligatoires, prioritaires)

Ces règles s'appliquent à l'application mobile, au serveur, à l'API, à la base de données, au stockage des fichiers et aux tests. Elles priment sur toute règle ou commentaire antérieur (notamment l'ancienne "règle métier 8" qui rendait l'attestation de diffusion systématique par œuvre).

### Règle 1 — Pseudonyme de l'auteur obligatoire à l'adhésion

Lorsqu'un auteur (candidat non membre) demande son adhésion à l'OMDA, il doit obligatoirement renseigner son **pseudonyme** (ou nom d'artiste).
- Ce pseudonyme est **distinct** de son nom officiel et de son prénom officiel.
- Il doit être correctement enregistré et associé au profil de l'auteur.
- Pour un **membre existant** qui demande une catégorie supplémentaire, son pseudonyme déjà enregistré doit être **réutilisé** ; il ne doit pas lui être demandé à nouveau sans justification métier.

### Règle 2 — Fiche de déclaration d'œuvre obligatoire pour chaque œuvre

Chaque œuvre déposée par un auteur doit obligatoirement être accompagnée d'une **fiche de déclaration d'œuvre**. Cette obligation concerne :
- **Cas A** : l'auteur non membre qui demande son adhésion (chaque œuvre de sa demande) ;
- **Cas B** : le membre qui dépose une œuvre dans une catégorie à laquelle il appartient déjà ;
- **Cas C** : le membre qui demande une catégorie supplémentaire (chaque œuvre déposée dans le cadre de cette demande).

Une fiche de déclaration doit correspondre à une **œuvre précise** (lien un-à-un œuvre ↔ fiche).
Le **modèle de fiche dépend de la catégorie de l'œuvre** : chaque œuvre doit posséder la fiche correspondant à sa catégorie.

### Règle 3 — Attestation de diffusion : obligation conditionnelle au cas par cas

L'attestation de diffusion est un document **distinct** de la fiche de déclaration d'œuvre. Son caractère obligatoire s'évalue **individuellement pour chaque œuvre**, selon la situation de l'auteur et la catégorie concernée :

- **Cas A — Auteur non membre demandant son adhésion** : l'attestation de diffusion est **obligatoire pour chaque œuvre déposée**.
- **Cas B — Membre demandant une catégorie supplémentaire** : l'attestation de diffusion est **obligatoire pour chaque œuvre déposée** dans le cadre de cette demande.
- **Cas C — Membre déposant une œuvre dans une catégorie à laquelle il appartient déjà** : l'attestation de diffusion **n'est pas obligatoire**.

### Règle 4 — Distinction stricte entre les documents

Ne jamais confondre :
1. La **fiche de déclaration d'œuvre** ;
2. L'**attestation de diffusion** ;
3. Les autres documents administratifs demandés par l'OMDA (pièces d'identité, autorisation parentale, etc.).

Ces documents ont des rôles différents et doivent être identifiés séparément dans les interfaces, les types de données, les services, l'API, la base de données et le stockage (chemins de stockage et buckets distincts).

### Règle 5 — Respect des formulaires officiels de l'OMDA

N'inventer aucun champ pour les fiches de déclaration d'œuvre. Avant toute modification fonctionnelle :
1. Rechercher les formulaires officiels et les documents métier disponibles ;
2. Identifier les modèles de fiches correspondant aux différentes catégories ;
3. Vérifier les champs réellement demandés par l'OMDA ;
4. Vérifier si les fiches doivent être remplies directement dans l'application ou simplement déposées sous forme de fichiers ;
5. Vérifier comment les fiches sont actuellement représentées dans les données du projet.

Si les documents nécessaires sont absents ou insuffisants, signaler précisément les informations manquantes dans `docs/PROGRESS.md` comme point à clarifier par l'OMDA. Ne pas créer de formulaire fictif et ne pas prendre de décision métier à la place de l'OMDA.

### Règle 0 — Consigne pour les étapes à venir

Toutes les étapes ultérieures (parcours des 22 étapes) doivent respecter ces règles métier. `docs/AI_RULES.md` est la référence permanente : avant chaque étape, le développeur doit consulter ce fichier. Aucune règle ne doit être recopie dans chaque prompt ; il suffit de se référer à ce document.