import {
  CHANNELS,
  type Channel,
  type EventsPage,
  type LastSeen,
  type Measurement,
  type Reading,
  type StateEvent,
  type Status,
} from '../shared/types';
import type { Repository } from './repository';
import type { MeasurementInput } from './schema';

export interface MonitorOptions {
  /**
   * Âge au-delà duquel une valeur est considérée comme trop ancienne. S'applique à la dernière
   * mesure (fraîcheur globale) et à la dernière valeur connue de chaque élément.
   */
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
 *
 * Un élément absent d'une mesure (ou à `null`) garde son dernier état connu pendant
 * `staleAfterMs`, puis passe à inconnu. Les autres éléments ne sont pas affectés.
 */
export class Monitor {
  readonly staleAfterMs: number;
  private readonly clock: () => Date;
  /** Dernier état enregistré dans l'historique, par élément. */
  private readonly tracked: Reading = unknownReading();
  /** Dernière valeur connue par élément : sert à maintenir l'état d'un élément absent. */
  private readonly seen: Record<Channel, LastSeen | null>;

  constructor(
    private readonly repo: Repository,
    options: MonitorOptions,
  ) {
    this.staleAfterMs = options.staleAfterMs;
    this.clock = options.clock ?? (() => new Date());
    Object.assign(this.tracked, repo.lastStates());
    this.seen = repo.lastSeen();
  }

  ingest(input: MeasurementInput): { measurement: Measurement; events: StateEvent[] } {
    const now = this.clock();
    // Mesure et événements sont écrits ensemble : tout ou rien.
    return this.repo.transaction(() => {
      // Si un élément était déjà périmé, on l'enregistre d'abord : l'historique
      // reste dans l'ordre (inconnu → nouvelle valeur).
      const events = this.sweep(now);

      const values = normalise(input);
      const measurement = this.repo.addMeasurement({
        receivedAt: now.toISOString(),
        measuredAt: input.measuredAt ?? null,
        values,
      });

      for (const channel of CHANNELS) {
        const to = values[channel];
        // Valeur absente : on garde le dernier état, `sweep` le passera à inconnu le moment venu.
        if (to === null) continue;
        this.seen[channel] = { at: measurement.receivedAt, value: to };
        const from = this.tracked[channel];
        if (from === to) continue;
        events.push(
          this.repo.addEvent({ at: measurement.receivedAt, channel, from, to, reason: 'measurement' }),
        );
        this.tracked[channel] = to;
      }
      return { measurement, events };
    });
  }

  /**
   * Enregistre le passage à « inconnu » de chaque élément dont la dernière valeur connue est
   * trop ancienne. Idempotent. L'événement est daté du moment où la valeur est devenue périmée.
   */
  sweep(now: Date = this.clock()): StateEvent[] {
    const expired = CHANNELS.filter((channel) => {
      const seen = this.seen[channel];
      return this.tracked[channel] !== null && (!seen || this.isExpired(seen.at, now));
    });
    if (expired.length === 0) return [];

    return this.repo.transaction(() =>
      expired.map((channel) => {
        const from = this.tracked[channel];
        const seen = this.seen[channel];
        const staleAt = seen ? new Date(Date.parse(seen.at) + this.staleAfterMs).toISOString() : now.toISOString();
        this.tracked[channel] = null;
        return this.repo.addEvent({ at: staleAt, channel, from, to: null, reason: 'stale' });
      }),
    );
  }

  /** Calculé à partir de l'horloge : correct même si `sweep` n'a pas encore tourné. */
  getStatus(now: Date = this.clock()): Status {
    const last = this.repo.latestMeasurement();
    const channels = unknownReading();
    for (const channel of CHANNELS) {
      const seen = this.seen[channel];
      if (seen && !this.isExpired(seen.at, now)) channels[channel] = seen.value;
    }
    const base = {
      now: now.toISOString(),
      staleAfterMs: this.staleAfterMs,
      channels,
      seenAt: {
        sourceA: this.seen.sourceA?.at ?? null,
        sourceB: this.seen.sourceB?.at ?? null,
        load1: this.seen.load1?.at ?? null,
        load2: this.seen.load2?.at ?? null,
      },
    };
    if (!last) {
      return { ...base, freshness: 'never', ageMs: null, lastMeasurement: null };
    }
    const ageMs = Math.max(0, now.getTime() - Date.parse(last.receivedAt));
    return {
      ...base,
      freshness: this.isExpired(last.receivedAt, now) ? 'stale' : 'fresh',
      ageMs,
      lastMeasurement: last,
    };
  }

  /** Historique, du plus récent au plus ancien. Rattrape d'abord un éventuel passage à « inconnu ». */
  listEvents(limit: number, before?: number): EventsPage {
    this.sweep();
    return this.repo.listEvents(limit, before);
  }

  private isExpired(at: string, now: Date): boolean {
    return now.getTime() - Date.parse(at) > this.staleAfterMs;
  }
}
