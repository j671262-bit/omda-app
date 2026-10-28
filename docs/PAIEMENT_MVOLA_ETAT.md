# État du branchement des paiements MVola

## État vérifié dans le dépôt mobile

- L’application mobile contient les écrans et contrats de paiement pour l’adhésion (API candidat) et le dépôt d’œuvre (espace membre).
- Le parcours candidat dépend d’une API REST Express (`EXPO_PUBLIC_API_BASE_URL`) décrite dans `docs/API_CANDIDAT.md`, mais aucun serveur Express n’est livré dans cette archive. (**périmé** : le serveur existe dans `server/` ; seules les routes de paiement restent fermées, voir `CORRECTIFS_2026-10-27.md`)
- L’espace membre utilise Supabase directement. Avant cette correction, `initierPaiement` créait une ligne `paiement` au statut `INITIE` sans appel au fournisseur MVola. Cette ligne ne prouvait pas qu’une transaction opérateur avait réellement été lancée.
- La confirmation externe MVola/webhook et son traitement idempotent ne sont pas fournis dans le dépôt.

## Garde-fou ajouté

`SupabaseMemberRepository.initierPaiement` conserve les contrôles préalables (membre connecté, opérateur actif, numéro, appartenance de l’œuvre, statut `VALIDEE`, tarif) puis renvoie `503 Service indisponible` sans créer de ligne de paiement. Le message indique clairement qu’aucun paiement n’a été initié.

C’est un comportement volontairement fermé : mieux vaut refuser temporairement un paiement que créer un faux état d’initiation. Il ne s’agit pas d’une intégration MVola terminée.

## Travaux indispensables avant activation

1. Fournir un serveur sécurisé pour l’initiation MVola et la confirmation opérateur.
2. Conserver les identifiants fournisseur uniquement côté serveur (jamais dans `EXPO_PUBLIC_*`).
3. Recalculer le montant depuis le tarif serveur et vérifier le statut validé dans une transaction atomique.
4. Implémenter une clé d’idempotence et empêcher les paiements doublons.
5. Valider la signature/authenticité du callback MVola, vérifier montant, référence et bénéficiaire, puis mettre à jour le paiement de façon idempotente.
6. Exposer un endpoint d’état protégé ; l’application ne doit afficher le succès qu’après confirmation serveur vérifiée.
7. Appliquer les mêmes règles au paiement d’adhésion via l’API candidat.
8. Tester les cas succès, échec, délai, callback dupliqué, montant erroné, référence inconnue et tentative d’accès par un autre membre.

Aucun paiement réel n’a été exécuté pendant cette étape.

## Étape 12 — Durcissement de la porte d'activation

- Le contrôle de configuration exige désormais des URL HTTPS réelles et refuse les domaines de démonstration `.example` / `example.com`.
- `/health` distingue la présence de paramètres de configuration de l'activation effective : `paymentInitiationEnabled` et `paymentCallbackEnabled` restent explicitement `false`.
- Les routes de paiement et le webhook restent volontairement fermés (`503`, code `INTEGRATION_MVOLA_NON_IMPLEMENTEE`) tant que l'adaptateur officiel et la vérification authentique du callback ne sont pas développés.
- Aucun endpoint ne crée une transaction et aucune réponse ne déclare un paiement réussi.

**Limite :** cette étape n'est pas une intégration MVola. Pour la développer correctement, il faut la documentation API officielle et les identifiants de l'environnement de test OMDA/MVola. Les identifiants ne doivent jamais être placés dans l'application mobile ni dans un dépôt public.
