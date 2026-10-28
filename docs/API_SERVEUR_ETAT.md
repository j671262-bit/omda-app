# État du serveur OMDA — API candidat

## Endpoints implémentés dans cette version

- `GET /health` : état du processus et indicateurs de configuration sans exposer les secrets.
- `POST /v1/demandes` : valide les champs d’identité et l’âge minimal, puis crée un candidat et un brouillon d’adhésion via l’API REST Supabase côté serveur. Le code de suivi est aléatoire, renvoyé une seule fois et son empreinte est stockée avec un secret serveur (`TRACKING_CODE_PEPPER`).
- `GET /v1/suivi/{numero_dossier}` : vérifie le code de suivi en temps constant et retourne l’état de la demande. Lorsque la demande est validée, le montant d’adhésion est lu dans `tarif` ; si aucun tarif correspondant n’est disponible, l’API renvoie une erreur au lieu d’inventer un montant.
- Les routes de paiement et le webhook MVola restent explicitement refusés (`503`) tant que l’intégration fournisseur réelle n’est pas implémentée.
- Les autres routes `/v1/*` renvoient `501` au lieu d’un succès fictif.

## Configuration obligatoire

Configurer côté serveur uniquement :

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — secret serveur, jamais dans l’application mobile
- `TRACKING_CODE_PEPPER` — secret aléatoire long d’au moins 32 caractères

Le serveur utilise les requêtes REST Supabase ; la clé privilégiée ne doit jamais être préfixée par `EXPO_PUBLIC_` ni envoyée au client.

## Limites connues

L’API candidat n’est pas encore complète. `PATCH /v1/demandes/{numero_dossier}`, `POST /v1/fichiers`, `POST /v1/demandes/{numero_dossier}/envoi`, les options de paiement et l’initiation/polling de paiement restent à implémenter. Le téléversement doit être conçu pour vérifier le MIME réel, la taille, les chemins de stockage et les autorisations. La création du candidat et du brouillon utilise actuellement deux requêtes REST ; une fonction SQL transactionnelle est recommandée avant production pour garantir l’atomicité.

Le code ne réalise pas encore de test d’intégration avec un projet Supabase réel. Ne pas déployer en production avant les tests d’intégration, la vérification des politiques RLS, les limites de débit et l’audit du stockage.

## Vérification locale

Depuis `server/` :

- `npm test`
- `npm run check`
- `npm start`

Le serveur écoute par défaut sur `127.0.0.1:8080`. Pour un déploiement, configurer `HOST`, une liste CORS restrictive et des secrets serveur forts.
