> **Note (27/10/2026)** : ce document est antérieur à l'audit du 27/10. Voir `CORRECTIFS_2026-10-27.md` pour l'état actuel.

> **Mise à jour du périmètre (26/10/2026)** : les cotisations annuelles ont été retirées de l’application mobile. Cet audit historique a été corrigé sur les points de navigation et de paiement ; la base de données existante n’a pas été modifiée par cette étape.

# OMDA Mobile — Audit de conformité (étape 16)

- **Date** : 30/09/2026
- **Périmètre** : application mobile uniquement (`app/`, `src/`, `tools/`, `docs/`, configuration). Aucun back-office, aucun écran admin/agent.
- **Méthode** : lecture du code + scans automatisés (recherche de motifs sur `app/` et `src/`), exécution de `npx tsc --noEmit`, `npx --yes tsx tools/verif-mocks.ts` et démarrage `npx expo start`.
- **Résultat global** : **conforme** sur l'ensemble des points vérifiés ; reliquats de l'ancien paiement manuel / virement et de l'ouverture-partage de documents supprimés.

---

## 1) Tableau « Conforme / Non conforme / Notes »

| # | Thème audité | Attendu | Constat | Verdict | Notes |
|---|---|---|---|---|---|
| 1 | Navigation — Public / Candidat | Aucun menu (ni TabBar, ni Drawer, ni hamburger) ; navigation linéaire (Stack + bouton retour) | `<Tabs>` présent UNIQUEMENT dans `app/(membre)/(tabs)/_layout.tsx` ; aucune occurrence de `Drawer` ni de `hamburger` dans `app/` ; les groupes `(public)`, `(adhesion)`, `(candidat)` n'utilisent que `Stack` + `AppHeader` | **Conforme** | Aucun fichier de menu hors espace membre |
| 2 | Navigation — Membre connecté | TabBar limitée à 4 onglets : Accueil, Œuvres, Profil, Notifications | 4 `<Tabs.Screen>` exactement (`accueil`, `oeuvres`, `profil`, `notifications`) ; les écrans hors onglets (`depot-oeuvre`, `fiche-oeuvre`, `modifier-oeuvre`, `deconnexion`, `paiement-membre`, `demander-categorie*`) sont dans la Stack de `app/(membre)/_layout.tsx` | **Conforme** | — |
| 3 | États des écrans critiques | Chargement / Erreur + « Réessayer » / Vide / Contenu | Composants `LoadingState` / `ErrorState` / `EmptyState` présents sur tous les écrans data-driven (voir décompte §2). Seuls les écrans non data-driven (`deconnexion`, `(_layout)` des gardes, `connexion`) n'affichent pas d'`EmptyState` : non applicable | **Conforme** | `deconnexion` porte le chargement sur le bouton et l'échec par `ErrorState` |
| 4 | Paiement — modes | Mobile Money uniquement (MVola), jamais de virement | `MODES_PAIEMENT = ['MOBILE_MONEY']`, `OPERATEURS_PAIEMENT = ['MVOLA']` (`src/models/enums.ts`) ; 0 occurrence de `VIREMENT`, `VIREMENT_BANCAIRE`, `coordonnees_bancaires`, `preuve_virement`, `EN_ATTENTE_PREUVE`, `EN_ATTENTE_VERIFICATION_AGENT` dans le dépôt | **Conforme** | Opérateur unique, non sélectionnable (affiché en information) |
| 5 | Paiement — succès | Succès annoncé uniquement après confirmation serveur (`REUSSI`) | Machine à états `INITIE` → `EN_ATTENTE_CONFIRMATION` → `REUSSI` par polling du service ; l'écran O réinterroge le service et ne confirme que sur `REUSSI` | **Conforme** | Aucun statut final calculé par l'app |
| 6 | Couleur verte | Vert `status-success` réservé au succès confirmé par le serveur, jamais près du bouton « Payer » | Boutons « Payer » en variante `secondary` (neutre) ; le vert n'apparaît qu'après confirmation (`StatusPill` success, `circle-check`) | **Conforme** | Contrôles `tools/verif-mocks.ts` |
| 7 | Montants | Montants/opérateurs/tarifs jamais codés en dur dans l'UI — toujours servis par un service | `AmountCard` reçoit ses valeurs des services de paiement et de tarification ; aucune valeur en dur dans `app/` | **Conforme** | Tout est mockable et prêt à brancher |
| 8 | Candidat — suivi | Suivi public par numéro de dossier + code de suivi | `app/(candidat)/suivi.tsx` : `suivreDemande({ numero_dossier, code_suivi })`, pré-remplissage par paramètres d'URL ou historique local | **Conforme** | Aucun compte candidat |
| 9 | Âge | < 15 ans : refus bloquant ; 15–17 ans : autorisation parentale obligatoire ; ≥ 18 : aucune | `estMoinsDe15Ans` → redirection `refus-age` ; `estMineur15A17` → `InfoBanner` + pièce `AUTORISATION_PARENTALE` exigée (adhésion + récapitulatif) | **Conforme** | Règle métier 7 |
| 10 | Adhésion — œuvres | Au moins 2 œuvres + 1 attestation de diffusion par œuvre | `documents-oeuvres.tsx` : 2 œuvres minimum, fichier d'œuvre + attestation obligatoires ; complétude recalculée avant « Continuer » | **Conforme** | Règle métier 8 |
| 11 | Catégorie supplémentaire | Demande via `membre_categorie` + annulation possible si `EN_ATTENTE` | `demanderCategorieSupplementaireAvecOeuvres` → statut `EN_ATTENTE` ; `annulerDemandeCategorie` depuis le Profil (confirmation dans l'écran) → `ANNULEE` | **Conforme** | Règle métier 9 |
| 12 | Attestation — formats | PDF, JPEG ou PNG uniquement (jamais d'audio) | `TYPES_MIME_ATTESTATION = ['application/pdf','image/jpeg','image/png']` ; `isAllowedAttestationMime` (`src/utils/uploadValidation.ts`) appliqué aux 4 emplacements d'envoi ; `DocumentPicker` restreint à ces types ; aide « Formats : PDF, JPEG, PNG — 20 Mo max. » ; revalidation côté mock | **Conforme** | L'audio reste réservé au fichier de l'œuvre (MP3/WAV) |

---

## 2) Décompte des états obligatoires par écran (`app/**/*.tsx`)

Nombre d'occurrences des composants d'état (import + rendu) :

| Écran | Loading | Error | Empty | Commentaire |
|---|---|---|---|---|
| `(adhesion)/categorie.tsx` | 3 | 3 | 3 | 4 états complets |
| `(adhesion)/confirmation.tsx` | 2 | 2 | 2 | 4 états complets |
| `(adhesion)/documents-oeuvres.tsx` | 2 | 2 | 2 | 4 états complets |
| `(adhesion)/recapitulatif.tsx` | 2 | 2 | 2 | 4 états complets |
| `(candidat)/paiement.tsx` | 2 | 2 | 2 | 4 états complets |
| `(candidat)/succes-adhesion.tsx` | 2 | 2 | 0 | Vide non applicable (paiement confirmé) |
| `(candidat)/suivi.tsx` | 2 | 2 | 2 | 4 états complets |
| `(membre)/(tabs)/accueil.tsx` | 3 | 3 | 4 | 4 états complets |
| `(membre)/(tabs)/notifications.tsx` | 3 | 3 | 3 | 4 états complets |
| `(membre)/(tabs)/oeuvres.tsx` | 2 | 2 | 3 | 4 états complets |
| `(membre)/(tabs)/profil.tsx` | 3 | 3 | 5 | 4 états complets |
| `(membre)/demander-categorie-oeuvres.tsx` | 3 | 3 | 3 | 4 états complets |
| `(membre)/demander-categorie.tsx` | 3 | 3 | 3 | 4 états complets |
| `(membre)/depot-oeuvre.tsx` | 2 | 2 | 2 | 4 états complets |
| `(membre)/fiche-oeuvre.tsx` | 2 | 2 | 2 | 4 états complets |
| `(membre)/modifier-oeuvre.tsx` | 2 | 2 | 2 | 4 états complets |
| `(membre)/paiement-membre.tsx` | 2 | 2 | 2 | 4 états complets |
| `(membre)/deconnexion.tsx` | 0 | 3 | 0 | Chargement sur le bouton, échec par `ErrorState` |
| `(public)/article.tsx` | 3 | 3 | 3 | 4 états complets |
| `(public)/documentation.tsx` | 3 | 3 | 3 | 4 états complets |
| `(public)/tarifs.tsx` | 3 | 3 | 2 | 4 états complets |
| `(public)/connexion.tsx` | 2 | 0 | 0 | Formulaire (erreurs contextuelles), pas de data à charger |
| `(auth-required)/changer-mot-de-passe.tsx` | 2 | 0 | 0 | Écran bloquant, aucune donnée distante |
| `(_layout)` des gardes | 2 | 0 | 0 | Chargement de session uniquement |
| `app/dev/catalogue.tsx` | 2 | 2 | 2 | Écran de développement |

---

## 3) Reliquats — scan et nettoyage

Motifs recherchés dans `app/`, `src/`, `tools/` et `docs/` :

| Motif recherché | Résultats avant nettoyage | Action / État final |
|---|---|---|
| `VIREMENT`, `VIREMENT_BANCAIRE` | 0 (code + docs) | Rien à supprimer — **conforme** |
| `coordonnees_bancaires` | 0 | Rien à supprimer — **conforme** |
| `preuve_virement` | 0 | Rien à supprimer — **conforme** |
| `EN_ATTENTE_PREUVE` | 0 | Rien à supprimer — **conforme** |
| `EN_ATTENTE_VERIFICATION_AGENT` | 0 | Rien à supprimer — **conforme** |
| `Partager` (bouton / texte) | 0 bouton ; seuls des commentaires et une ligne de microcopie explicative | Commentaires/textes reformulés pour ne plus mentionner « ouverture » ni « partage » (`fiche-oeuvre.tsx`, contrats, mocks, `tools/verif-mocks.ts`) |
| `openFile` | 0 | Déjà supprimé (post-16H) — **conforme** |
| `openWithSystemPicker` | 0 | Déjà supprimé — **conforme** |
| `filePreview` (`src/utils/filePreview.ts`) | 0 | Fichier déjà supprimé — **conforme** |
| `share-nodes` (icône FontAwesome) | 0 | Déjà supprimé — **conforme** |
| `expo-sharing` | imports : 0 ; dépendance + plugin présents | **Dépendance et plugin retirés** (`npm uninstall`, `app.json`) |
| `expo-intent-launcher` | imports : 0 ; dépendance présente | **Dépendance retirée** (`npm uninstall`) |
| `expo-web-browser` | imports : 0 ; dépendance + plugin présents | **Dépendance et plugin retirés** (`npm uninstall`, `app.json`) |
| `Alert.alert` | 0 | Toutes les confirmations se font dans l'écran — **conforme** |
| `console.log` de diagnostic | 0 | Logs DEBUG déjà retirés avec le module d'ouverture de fichiers — **conforme** |

**Fichiers modifiés par ce nettoyage** : `app.json`, `package.json`, `package-lock.json`, `src/services/contracts/memberRepository.ts`, `src/services/mocks/etatMock.ts`, `src/services/mocks/MockMemberRepository.ts`, `tools/verif-mocks.ts`, `app/(membre)/fiche-oeuvre.tsx` (commentaires + une ligne de microcopie), `docs/AUDIT.md` (nouveau), `docs/PROGRESS.md`.

---


## 4) Couleurs codées en dur (hex)

| Emplacement | Hex autorisé ? | Constat |
|---|---|---|
| Composants et écrans (`app/**/*.tsx`, `src/components/**`) | **Non** | 0 caractère `#` — uniquement les tokens `omda-*` et `status-*` — **conforme** |
| `src/theme/colors.ts` | Oui | Source unique des valeurs de la palette (11 couleurs + 4 statuts), consommée par `tailwind.config.js` — seul fichier de code contenant des hex |
| `app.json` | Oui | Fichier de configuration (`android.adaptiveIcon.backgroundColor`, `splash.backgroundColor`) |
| `public/index.html` | Oui | Splash web statique (HTML hors composants React), mêmes valeurs que `app.json` |

**Verdict** : conforme — aucun hex dans les composants UI.

---

## 5) Dépendances — état après nettoyage

| Dépendance | Importée dans le code ? | Décision |
|---|---|---|
| `expo-audio` | Oui (`AudioPreview.tsx`) | Conservée |
| `expo-clipboard` | Oui (`confirmation.tsx`) | Conservée |
| `expo-document-picker` | Oui (4 écrans d'envoi) | Conservée |
| `expo-image-picker` | Oui (`documents-oeuvres.tsx`) | Conservée |
| `expo-splash-screen` | Oui (`app/_layout.tsx`) | Conservée |
| `expo-status-bar` | Oui (`app/_layout.tsx`) | Conservée |
| `expo-file-system` | Non (directement) | **Conservée** : dépendance transitive de `expo@57.0.24` (`expo-file-system@57.0.7 deduped`) — retrait inutile et risqué |
| `expo-sharing` | Non | **Retirée** (`npm uninstall` + `app.json`) |
| `expo-intent-launcher` | Non | **Retirée** (`npm uninstall`) |
| `expo-web-browser` | Non | **Retirée** (`npm uninstall` + `app.json`) |
| `expo-constants`, `expo-linking`, `expo-font` | Non (directement) | **Conservées** : requises transitivement par `expo` / `expo-router` / `@expo/vector-icons` |
| `react-native-reanimated`, `react-native-worklets` | Non (directement) | **Conservées** : requises par NativeWind v4 |

`npm uninstall` a supprimé 3 paquets (« removed 3 packages »), `package.json` et `package-lock.json` sont à jour, et les `plugins` de `app.json` sont réduits à `expo-router`, `expo-audio`, `expo-splash-screen` (paramétré).

---

## 6) Points de vigilance (non bloquants, aucun correctif requis)

1. `src/services/contracts/memberRepository.ts` conserve la méthode `obtenirUrlFichier` : elle sert désormais à l'écoute audio intégrée uniquement. Les commentaires ont été alignés en conséquence.
2. `docs/CAHIER_DES_CHARGES.md` §12 L mentionne encore « copier / partager / sauvegarder » : cahier des charges de référence, volontairement non modifié (le code ne propose plus que copier / sauvegarder).
3. Le splash utilise des images PLACEHOLDER (`assets/splash.png`, `public/splash.png`) à remplacer par l'image finale avant publication (voir `docs/PROGRESS.md`).

---

## 7) Vérifications finales

| Commande | Résultat attendu | Résultat |
|---|---|---|
| `npx tsc --noEmit` | 0 erreur | **0 erreur** |
| `npx --yes tsx tools/verif-mocks.ts` | `TOUS LES CONTROLES SONT PASSES` | **111/111** |
| `npx expo start` | L'application démarre, Metro répond | **Metro répond (`packager-status:running`)** |

