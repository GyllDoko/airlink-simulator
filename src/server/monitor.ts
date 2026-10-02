import {
  CHANNELS,
  type EventsPage,
  type Measurement,
  type Reading,
  type StateEvent,
  type Status,
} from '../shared/types';
import type { Repository } from './repository';
import type { MeasurementInput } from './schema';

export interface MonitorOptions {
  /** Âge au-delà duquel la dernière mesure est considérée comme trop ancienne. */
  staleAfterMs: number;
  /** Horloge injectable pour les tests. */
  clock?: () => Date;
}

export function unknownReading(): Reading {
  return { sourceA: null, sourceB: null, load1: null, load2: null };
}

/** Une valeur absente devient `null` (inconnu). `false` reste `false`. */
export function normalise(input: MeasurementInput): Reading {
  return {
    sourceA: input.sourceA ?? null,
    sourceB: input.sourceB ?? null,
    load1: input.load1 ?? null,
    load2: input.load2 ?? null,
  };
}

/**
 * Logique métier : ingestion des mesures, détection des changements d'état,
 * calcul de la fraîcheur.
 */
export class Monitor {
  readonly staleAfterMs: number;
  private readonly clock: () => Date;
  /** Dernier état enregistré dans l'historique, par élément. */
  private readonly tracked: Reading = unknownReading();

  constructor(
    private readonly repo: Repository,
    options: MonitorOptions,
  ) {
    this.staleAfterMs = options.staleAfterMs;
    this.clock = options.clock ?? (() => new Date());
    for (const event of repo.allEvents()) this.tracked[event.channel] = event.to;
  }

  ingest(input: MeasurementInput): { measurement: Measurement; events: StateEvent[] } {
    const now = this.clock();
    // Si la mesure précédente était déjà périmée, on l'enregistre d'abord : l'historique
    // reste dans l'ordre (inconnu → nouvelle valeur).
    const events = this.sweep(now);

    const values = normalise(input);
    const measurement = this.repo.addMeasurement({
      receivedAt: now.toISOString(),
      measuredAt: input.measuredAt ?? null,
      values,
    });

    for (const channel of CHANNELS) {
      const from = this.tracked[channel];
      const to = values[channel];
      if (from === to) continue;
      events.push(
        this.repo.addEvent({ at: measurement.receivedAt, channel, from, to, reason: 'measurement' }),
      );
      this.tracked[channel] = to;
    }
    return { measurement, events };
  }

  /**
   * Enregistre le passage à « inconnu » si la dernière mesure est trop ancienne.
   * Idempotent. L'événement est daté du moment où la mesure est devenue périmée.
   */
  sweep(now: Date = this.clock()): StateEvent[] {
    const last = this.repo.latestMeasurement();
    if (!last || !this.isStale(last, now)) return [];

    const staleAt = new Date(Date.parse(last.receivedAt) + this.staleAfterMs).toISOString();
    const events: StateEvent[] = [];
    for (const channel of CHANNELS) {
      const from = this.tracked[channel];
      if (from === null) continue;
      events.push(this.repo.addEvent({ at: staleAt, channel, from, to: null, reason: 'stale' }));
      this.tracked[channel] = null;
    }
    return events;
  }

  /** Calculé à partir de l'horloge : correct même si `sweep` n'a pas encore tourné. */
  getStatus(now: Date = this.clock()): Status {
    const last = this.repo.latestMeasurement();
    const base = { now: now.toISOString(), staleAfterMs: this.staleAfterMs };
    if (!last) {
      return { ...base, freshness: 'never', ageMs: null, lastMeasurement: null, channels: unknownReading() };
    }
    const ageMs = Math.max(0, now.getTime() - Date.parse(last.receivedAt));
    const stale = this.isStale(last, now);
    return {
      ...base,
      freshness: stale ? 'stale' : 'fresh',
      ageMs,
      lastMeasurement: last,
      channels: stale ? unknownReading() : { ...last.values },
    };
  }

  /** Historique, du plus récent au plus ancien. Rattrape d'abord un éventuel passage à « inconnu ». */
  listEvents(limit: number, before?: number): EventsPage {
    this.sweep();
    return this.repo.listEvents(limit, before);
  }

  private isStale(measurement: Measurement, now: Date): boolean {
    return now.getTime() - Date.parse(measurement.receivedAt) > this.staleAfterMs;
  }
}
