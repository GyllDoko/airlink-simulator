import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  CHANNELS,
  type Channel,
  type ChannelState,
  type EventsPage,
  type LastSeen,
  type Measurement,
  type Reading,
  type StateEvent,
} from '../shared/types';
import type { Repository } from './repository';

/**
 * Un état est stocké en INTEGER : 1 = vrai, 0 = faux, NULL = inconnu.
 * NULL n'est jamais converti en 0 ; la contrainte CHECK refuse toute autre valeur.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS measurements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  measured_at TEXT,
  source_a    INTEGER CHECK (source_a IN (0, 1)),
  source_b    INTEGER CHECK (source_b IN (0, 1)),
  load1       INTEGER CHECK (load1 IN (0, 1)),
  load2       INTEGER CHECK (load2 IN (0, 1))
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  channel    TEXT NOT NULL CHECK (channel IN ('sourceA', 'sourceB', 'load1', 'load2')),
  from_state INTEGER CHECK (from_state IN (0, 1)),
  to_state   INTEGER CHECK (to_state IN (0, 1)),
  reason     TEXT NOT NULL CHECK (reason IN ('measurement', 'stale'))
);

CREATE INDEX IF NOT EXISTS idx_events_channel ON events (channel, id);
`;

interface MeasurementRow {
  id: number;
  received_at: string;
  measured_at: string | null;
  source_a: number | null;
  source_b: number | null;
  load1: number | null;
  load2: number | null;
}

interface EventRow {
  id: number;
  at: string;
  channel: StateEvent['channel'];
  from_state: number | null;
  to_state: number | null;
  reason: StateEvent['reason'];
}

/** Colonne de la table `measurements` pour chaque élément. */
const COLUMNS: Record<Channel, string> = {
  sourceA: 'source_a',
  sourceB: 'source_b',
  load1: 'load1',
  load2: 'load2',
};

const toDb = (state: ChannelState): number | null => (state === null ? null : state ? 1 : 0);
const fromDb = (value: number | null): ChannelState => (value === null ? null : value === 1);

const toMeasurement = (row: MeasurementRow): Measurement => ({
  id: row.id,
  receivedAt: row.received_at,
  measuredAt: row.measured_at,
  values: {
    sourceA: fromDb(row.source_a),
    sourceB: fromDb(row.source_b),
    load1: fromDb(row.load1),
    load2: fromDb(row.load2),
  },
});

const toEvent = (row: EventRow): StateEvent => ({
  id: row.id,
  at: row.at,
  channel: row.channel,
  from: fromDb(row.from_state),
  to: fromDb(row.to_state),
  reason: row.reason,
});

/** Stockage SQLite (module `node:sqlite`, Node 22.13 ou plus). `':memory:'` pour une base volatile. */
export class SqliteRepository implements Repository {
  private readonly db: DatabaseSync;
  private readonly insertMeasurement: StatementSync;
  private readonly insertEvent: StatementSync;
  private readonly selectLatest: StatementSync;
  private readonly selectLastState: StatementSync;
  private readonly selectEvents: StatementSync;
  private readonly selectLastSeen: Record<Channel, StatementSync>;
  private depth = 0;

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);

    this.insertMeasurement = this.db.prepare(
      'INSERT INTO measurements (received_at, measured_at, source_a, source_b, load1, load2) VALUES (?, ?, ?, ?, ?, ?)',
    );
    this.insertEvent = this.db.prepare(
      'INSERT INTO events (at, channel, from_state, to_state, reason) VALUES (?, ?, ?, ?, ?)',
    );
    this.selectLatest = this.db.prepare('SELECT * FROM measurements ORDER BY id DESC LIMIT 1');
    this.selectLastState = this.db.prepare(
      'SELECT to_state FROM events WHERE channel = ? ORDER BY id DESC LIMIT 1',
    );
    this.selectEvents = this.db.prepare(
      'SELECT * FROM events WHERE (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?',
    );
    const lastSeenQuery = (channel: Channel): StatementSync =>
      this.db.prepare(
        `SELECT received_at, ${COLUMNS[channel]} AS value FROM measurements
         WHERE ${COLUMNS[channel]} IS NOT NULL ORDER BY id DESC LIMIT 1`,
      );
    this.selectLastSeen = {
      sourceA: lastSeenQuery('sourceA'),
      sourceB: lastSeenQuery('sourceB'),
      load1: lastSeenQuery('load1'),
      load2: lastSeenQuery('load2'),
    };
  }

  addMeasurement(data: Omit<Measurement, 'id'>): Measurement {
    const { values } = data;
    const result = this.insertMeasurement.run(
      data.receivedAt,
      data.measuredAt,
      toDb(values.sourceA),
      toDb(values.sourceB),
      toDb(values.load1),
      toDb(values.load2),
    );
    return { id: Number(result.lastInsertRowid), ...data };
  }

  addEvent(data: Omit<StateEvent, 'id'>): StateEvent {
    const result = this.insertEvent.run(data.at, data.channel, toDb(data.from), toDb(data.to), data.reason);
    return { id: Number(result.lastInsertRowid), ...data };
  }

  latestMeasurement(): Measurement | null {
    const row = this.selectLatest.get() as unknown as MeasurementRow | undefined;
    return row ? toMeasurement(row) : null;
  }

  lastStates(): Reading {
    const state = (channel: keyof Reading): ChannelState => {
      const row = this.selectLastState.get(channel) as unknown as { to_state: number | null } | undefined;
      return row ? fromDb(row.to_state) : null;
    };
    return { sourceA: state('sourceA'), sourceB: state('sourceB'), load1: state('load1'), load2: state('load2') };
  }

  lastSeen(): Record<Channel, LastSeen | null> {
    const seen: Record<Channel, LastSeen | null> = { sourceA: null, sourceB: null, load1: null, load2: null };
    for (const channel of CHANNELS) {
      const row = this.selectLastSeen[channel].get() as unknown as { received_at: string; value: number } | undefined;
      if (row) seen[channel] = { at: row.received_at, value: row.value === 1 };
    }
    return seen;
  }

  listEvents(limit: number, beforeId?: number): EventsPage {
    const before = beforeId ?? null;
    // Une ligne de plus que demandé pour savoir s'il reste des événements plus anciens.
    const rows = this.selectEvents.all(before, before, limit + 1) as unknown as EventRow[];
    const page = rows.slice(0, limit).map(toEvent);
    const oldest = page[page.length - 1];
    return { events: page, nextBefore: rows.length > limit && oldest ? oldest.id : null };
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  close(): void {
    this.db.close();
  }
}
