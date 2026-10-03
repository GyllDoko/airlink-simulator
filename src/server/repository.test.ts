import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepository, type Repository } from './repository';
import { SqliteRepository } from './sqlite-repository';

const backends: Array<[string, () => Repository]> = [
  ['mémoire', () => new MemoryRepository()],
  ['SQLite', () => new SqliteRepository(':memory:')],
];

const measurement = (values: Partial<Record<'sourceA' | 'sourceB' | 'load1' | 'load2', boolean | null>> = {}) => ({
  receivedAt: '2026-01-01T12:00:00.000Z',
  measuredAt: null,
  values: { sourceA: null, sourceB: null, load1: null, load2: null, ...values },
});

describe.each(backends)('Repository (%s)', (_name, create) => {
  let repo: Repository;
  beforeEach(() => {
    repo = create();
  });
  afterEach(() => repo.close());

  it('ne renvoie aucune mesure au départ', () => {
    expect(repo.latestMeasurement()).toBeNull();
  });

  it('distingue null, false et true après écriture puis lecture', () => {
    repo.addMeasurement(measurement({ sourceA: true, sourceB: false }));
    const { values } = repo.latestMeasurement()!;
    expect(values.sourceA).toBe(true);
    expect(values.sourceB).toBe(false);
    expect(values.load1).toBeNull();
    expect(values.load2).toBeNull();
  });

  it('conserve measuredAt, ou null', () => {
    repo.addMeasurement({ ...measurement(), measuredAt: '2026-01-01T11:59:59.000Z' });
    expect(repo.latestMeasurement()?.measuredAt).toBe('2026-01-01T11:59:59.000Z');
    repo.addMeasurement(measurement());
    expect(repo.latestMeasurement()?.measuredAt).toBeNull();
  });

  it('renvoie la mesure la plus récente avec un id croissant', () => {
    const first = repo.addMeasurement(measurement({ load1: true }));
    const second = repo.addMeasurement(measurement({ load1: false }));
    expect(second.id).toBeGreaterThan(first.id);
    expect(repo.latestMeasurement()).toEqual(second);
  });

  it('retrouve le dernier état de chaque élément, inconnu par défaut', () => {
    expect(repo.lastStates()).toEqual({ sourceA: null, sourceB: null, load1: null, load2: null });
    repo.addEvent({ at: 'a', channel: 'sourceA', from: null, to: true, reason: 'measurement' });
    repo.addEvent({ at: 'b', channel: 'load1', from: null, to: false, reason: 'measurement' });
    repo.addEvent({ at: 'c', channel: 'sourceA', from: true, to: null, reason: 'stale' });
    expect(repo.lastStates()).toEqual({ sourceA: null, sourceB: null, load1: false, load2: null });
  });

  it('pagine les événements du plus récent au plus ancien', () => {
    for (let i = 0; i < 5; i++) {
      repo.addEvent({ at: `t${i}`, channel: 'load1', from: i % 2 === 0, to: i % 2 !== 0, reason: 'measurement' });
    }
    const first = repo.listEvents(2);
    expect(first.events.map((e) => e.id)).toEqual([5, 4]);
    expect(first.nextBefore).toBe(4);
    const second = repo.listEvents(2, first.nextBefore!);
    expect(second.events.map((e) => e.id)).toEqual([3, 2]);
    const third = repo.listEvents(2, second.nextBefore!);
    expect(third.events.map((e) => e.id)).toEqual([1]);
    expect(third.nextBefore).toBeNull();
  });

  it('relit les événements avec leurs valeurs null / false / true', () => {
    repo.addEvent({ at: 'x', channel: 'sourceB', from: true, to: null, reason: 'stale' });
    expect(repo.listEvents(10).events[0]).toEqual({
      id: 1,
      at: 'x',
      channel: 'sourceB',
      from: true,
      to: null,
      reason: 'stale',
    });
  });

  it('accepte les transactions imbriquées et renvoie le résultat', () => {
    const result = repo.transaction(() => repo.transaction(() => repo.addEvent({ at: 'x', channel: 'load2', from: null, to: true, reason: 'measurement' })));
    expect(result.id).toBe(1);
  });
});

describe('SqliteRepository', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'airlink-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('annule tout si la transaction échoue', () => {
    const repo = new SqliteRepository(':memory:');
    expect(() =>
      repo.transaction(() => {
        repo.addMeasurement(measurement({ sourceA: true }));
        repo.addEvent({ at: 'x', channel: 'sourceA', from: null, to: true, reason: 'measurement' });
        throw new Error('panne');
      }),
    ).toThrow('panne');
    expect(repo.latestMeasurement()).toBeNull();
    expect(repo.listEvents(10).events).toEqual([]);
    repo.close();
  });

  it('survit à un redémarrage (fichier)', () => {
    const file = join(dir, 'sous-dossier', 'airlink.db');
    const first = new SqliteRepository(file);
    first.addMeasurement(measurement({ sourceA: false }));
    first.addEvent({ at: 'x', channel: 'sourceA', from: null, to: false, reason: 'measurement' });
    first.close();

    const second = new SqliteRepository(file);
    expect(second.latestMeasurement()?.values.sourceA).toBe(false);
    expect(second.lastStates().sourceA).toBe(false);
    expect(second.addEvent({ at: 'y', channel: 'sourceA', from: false, to: true, reason: 'measurement' }).id).toBe(2);
    second.close();
  });

  it('stocke l’inconnu comme NULL et jamais comme 0', () => {
    const file = join(dir, 'airlink.db');
    const repo = new SqliteRepository(file);
    repo.addMeasurement(measurement({ sourceA: false }));
    repo.close();

    const raw = new DatabaseSync(file);
    const row = raw.prepare('SELECT source_a, source_b, load1, load2 FROM measurements').get();
    raw.close();
    expect(row).toEqual({ source_a: 0, source_b: null, load1: null, load2: null });
  });

  it('refuse une valeur autre que 0, 1 ou NULL (contrainte CHECK)', () => {
    const file = join(dir, 'airlink.db');
    new SqliteRepository(file).close();
    const raw = new DatabaseSync(file);
    expect(() =>
      raw.prepare("INSERT INTO measurements (received_at, source_a) VALUES ('x', 2)").run(),
    ).toThrow(/CHECK/);
    raw.close();
  });
});
