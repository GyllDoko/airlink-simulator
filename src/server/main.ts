import { buildApp } from './app';
import { Monitor } from './monitor';
import { SqliteRepository } from './sqlite-repository';

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} doit être un entier positif (reçu : "${raw}")`);
  }
  return value;
}

const port = positiveInt('PORT', 3000);
const host = process.env.HOST ?? '127.0.0.1';
// 15 s = trois cycles manqués du contrôleur (une mesure toutes les 5 s).
const staleAfterMs = positiveInt('STALE_AFTER_MS', 15_000);

// ':memory:' pour une base volatile.
const dbFile = process.env.DB_FILE || 'data/airlink.db';
const repository = new SqliteRepository(dbFile);
const monitor = new Monitor(repository, { staleAfterMs });
const app = buildApp(monitor);

// Enregistre le passage à « inconnu » même si personne n'interroge l'API.
const sweeper = setInterval(() => monitor.sweep(), 1000);

const shutdown = async () => {
  clearInterval(sweeper);
  await app.close();
  repository.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port, host });
console.log(
  `API prête sur http://${host}:${port} (inconnu après ${staleAfterMs} ms, base SQLite : ${dbFile})`,
);
