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