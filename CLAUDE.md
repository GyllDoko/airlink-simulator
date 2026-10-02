# Conventions du projet

- TypeScript strict. Pas de `any`.
- Un état d'élément est `boolean | null`. `null` = inconnu. Ne jamais convertir une valeur absente
  en `false` ni en `0`.
- La logique métier reste dans `src/server/monitor.ts`, sans dépendance à HTTP.
- Toute règle métier a un test. Les tests de temps utilisent `FakeClock`, jamais `setTimeout`.
- Commits courts et conventionnels (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- Le README est en français.
- Avant de terminer : `npm run typecheck && npm test`.
