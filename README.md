# AirLink Simulator

Supervision de deux sources d'énergie (A et B) et de deux charges (1 et 2).
Un contrôleur envoie l'état de ces quatre éléments toutes les 5 secondes ; une API les reçoit,
le backend conserve l'historique des changements d'état et une interface les affiche.

Tout est en TypeScript. Aucune base de données native n'est nécessaire.

## Démarrage rapide

Prérequis : Node.js 20 ou plus.

```bash
npm install

npm run dev:server     # API sur http://127.0.0.1:3000
npm run dev:web        # interface sur http://localhost:5173 (proxy /api → :3000)
npm run simulate       # contrôleur simulé, scénario « sourceA disparaît » (un message toutes les 5 s)
npm run simulate:random  # ancienne simulation aléatoire
```

Le mode se choisit avec `SIM_MODE` (`source-a` par défaut, ou `random`).

- **`source-a`** : sourceB, load1 et load2 arrivent toujours et changent d'état au hasard ; sourceA
  reste à `true` mais disparaît des messages selon un cycle de 60 s :

  | messages | sourceA          | effet attendu                                   |
  | -------- | ---------------- | ----------------------------------------------- |
  | 1 à 3    | envoyé           | connu                                           |
  | 4 et 5   | absent (10 s)    | dernier état maintenu, aucun événement          |
  | 6 et 7   | envoyé           | connu                                           |
  | 8 à 12   | absent (25 s)    | inconnu 15 s après sa dernière valeur (`stale`) |

- **`random`** : fait varier les états, omet parfois des champs, envoie parfois `null`, et simule des
  coupures complètes (plus aucun message) pour montrer le passage à « Inconnu ».

Autres commandes :

| Commande            | Rôle                                           |
| ------------------- | ---------------------------------------------- |
| `npm test`          | tests unitaires et d'API (Vitest)              |
| `npm run typecheck` | vérification TypeScript (serveur et interface) |
| `npm run build:web` | build de l'interface dans `web/dist`           |

Variables d'environnement du serveur :

| Variable         | Défaut      | Rôle                                                          |
| ---------------- | ----------- | ------------------------------------------------------------- |
| `PORT`           | `3000`      | port d'écoute                                                 |
| `HOST`           | `127.0.0.1` | adresse d'écoute                                              |
| `STALE_AFTER_MS` | `15000`     | âge au-delà duquel une mesure, ou la dernière valeur d'un élément, devient inconnue |
| `DATA_FILE`      | _(aucun)_   | chemin d'un journal JSONL pour survivre à un redémarrage      |

## Architecture

```
src/
  shared/      types partagés serveur / interface
  server/
    schema.ts      validation des entrées (Zod)
    repository.ts  stockage en mémoire + journal JSONL optionnel
    monitor.ts     logique métier : ingestion, événements, fraîcheur
    app.ts         routes HTTP (Fastify)
    main.ts        configuration et démarrage
  simulator/   faux contrôleur
web/           interface React + Vite
```

La logique métier est dans `Monitor`, qui ne connaît ni HTTP ni le stockage concret. L'horloge est
injectable, ce qui permet de tester l'expiration des mesures sans attendre.

## API

| Méthode | Route                              | Description                                |
| ------- | ---------------------------------- | ------------------------------------------ |
| `POST`  | `/api/measurements`                | reçoit une mesure                          |
| `GET`   | `/api/status`                      | états courants, dernière mesure, fraîcheur |
| `GET`   | `/api/events?limit=50&before=<id>` | historique, du plus récent au plus ancien  |

```bash
curl -X POST http://127.0.0.1:3000/api/measurements \
  -H 'content-type: application/json' \
  -d '{"sourceA": true, "sourceB": false, "load1": true}'
```

Champs acceptés : `sourceA`, `sourceB`, `load1`, `load2` (booléen, `null` ou absent) et
`measuredAt` (date ISO 8601, optionnelle). Toute autre valeur donne une réponse `400`.

## Décisions de conception

### Aucune valeur manquante n'est transformée en zéro

- Un état est `true`, `false` ou `null`. `null` signifie **inconnu** et n'est jamais confondu avec `false`.
- Un champ absent ou `null` est enregistré comme `null` dans la mesure (donnée brute).
- Les valeurs d'un autre type (`0`, `1`, `"true"`) sont **refusées** (400), pas converties.
  Les clés inconnues aussi.
- `false ?? null` vaut `false` : seuls `null` et `undefined` deviennent inconnus.
- L'interface affiche « Inconnu » pour `null`, avec une forme différente (anneau pointillé et hachures),
  pas seulement une couleur.
- Si l'API est injoignable, l'interface affiche aussi « Inconnu » plutôt que de laisser une valeur
  périmée, et le signale.

### État inconnu quand la mesure est trop ancienne

- Une mesure est périmée si son âge dépasse `STALE_AFTER_MS` (15 s par défaut, soit trois cycles manqués).
- L'âge est calculé à partir de l'heure de **réception** par le backend, pas de l'horloge du
  contrôleur, qui peut être décalée. `measuredAt` est conservé à titre informatif.
- `GET /api/status` calcule la fraîcheur à partir de l'horloge : le résultat est correct même si
  personne n'a encore enregistré l'événement.
- Le passage à inconnu est enregistré dans l'historique (`reason: "stale"`), daté du moment où la
  mesure est devenue périmée. Un balayage toutes les secondes le fait, et il est aussi rattrapé
  à la lecture de l'historique et à la réception d'une nouvelle mesure. L'opération est idempotente.
- La dernière mesure reste affichée avec son âge, mais les états courants sont inconnus.

### Élément absent pendant que les autres continuent

- La tolérance s'applique **par élément**. Si `sourceA` n'arrive plus (champ absent ou `null`) mais
  que `sourceB`, `load1` et `load2` continuent, `sourceA` garde son dernier état connu pendant
  `STALE_AFTER_MS` après sa dernière valeur reçue, puis passe à inconnu. Les autres éléments ne
  sont pas affectés.
- Aucun événement n'est enregistré quand la valeur disparaît. Si elle revient avant le seuil, rien
  n'est enregistré non plus. Sinon, un événement `stale` est daté de « dernière valeur + seuil ».
- `GET /api/status` renvoie `seenAt` : la date de la dernière valeur connue de chaque élément.
- La dernière valeur connue de chaque élément est relue depuis la base au redémarrage.

### Événements

Un événement est un changement d'état d'un élément (`from` → `to`). Il est enregistré quand l'état
diffère du dernier état connu. Une mesure identique à la précédente ne produit rien. Le premier état
reçu est un passage `null → valeur`. La cause est `measurement` ou `stale`.

### Persistance

Par défaut tout est en mémoire. Avec `DATA_FILE`, chaque mesure et chaque événement est ajouté à un
journal JSONL ; au redémarrage, les événements, la dernière mesure et l'état suivi sont restaurés.
Seule la dernière mesure est gardée en mémoire (le journal les garde toutes). Une ligne corrompue
(écriture interrompue) est ignorée avec un avertissement.

## Tests

`npm test` : 99 tests.

- **Valeurs manquantes** : absent → `null`, `false` conservé, `0` et chaînes refusés.
- **Événements** : premier état, absence de doublon, changement, passage à inconnu.
- **Fraîcheur** : seuil inclus, juste après le seuil, date de l'événement `stale`, idempotence, reprise.
- **Élément absent** : maintien du dernier état jusqu'au seuil, passage à inconnu d'un seul élément,
  `null` explicite, retour avant et après le seuil, redémarrage.
- **API** : réponses 201 et 400, statut avant et après expiration, pagination, paramètres invalides.
- **Persistance** : redémarrage sans faux événements, ligne corrompue.
- **Interface** : libellés (`null` ≠ `false`) et formatage de l'âge.
- **Simulateur** : génération des messages avec champs absents ou nuls, cycle du scénario « sourceA disparaît ».

## Limites et pistes

- Pas d'authentification sur l'API : à ajouter avant toute exposition réelle.
- Le journal JSONL grossit sans limite (pas de rotation) ; une base SQLite serait le choix suivant.
  L'interface `Repository` isole ce choix.
- L'interface interroge l'API toutes les 2 s (polling) ; des SSE ou WebSocket réduiraient la latence.
- L'historique affiche les 100 événements les plus récents ; l'API gère déjà la pagination.
