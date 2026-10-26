import {
  CHANNELS,
  type Channel,
  type EventsPage,
  type LastSeen,
  type Measurement,
  type Reading,
  type StateEvent,
} from '../shared/types';

/**
 * Contrat de stockage. Le reste du backend ne connaît que cette interface.
 * Toutes les opérations sont synchrones.
 */
export interface Repository {
  addMeasurement(data: Omit<Measurement, 'id'>): Measurement;
  addEvent(data: Omit<StateEvent, 'id'>): StateEvent;
  latestMeasurement(): Measurement | null;
  /** Dernier état enregistré par élément dans l'historique. `null` = inconnu ou jamais vu. */
  lastStates(): Reading;
  /** Dernière valeur non nulle reçue par élément. `null` = jamais reçue. */
  lastSeen(): Record<Channel, LastSeen | null>;
  /** Du plus récent au plus ancien. `beforeId` exclut cet id et les suivants. */
  listEvents(limit: number, beforeId?: number): EventsPage;
  /** Exécute `fn` de façon atomique quand le stockage le permet. Les appels imbriqués sont autorisés. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

/** Stockage en mémoire (tests, démonstration). Rien ne survit à l'arrêt du processus. */
export class MemoryRepository implements Repository {
  private latest: Measurement | null = null;
  private readonly seen: Record<Channel, LastSeen | null> = {
    sourceA: null,
    sourceB: null,
    load1: null,
    load2: null,
  };
  private readonly events: StateEvent[] = [];
  private nextMeasurementId = 1;
  private nextEventId = 1;

  addMeasurement(data: Omit<Measurement, 'id'>): Measurement {
    this.latest = { id: this.nextMeasurementId++, ...data };
    for (const channel of CHANNELS) {
      const value = data.values[channel];
      if (value !== null) this.seen[channel] = { at: data.receivedAt, value };
    }
    return this.latest;
  }

  addEvent(data: Omit<StateEvent, 'id'>): StateEvent {
    const event: StateEvent = { id: this.nextEventId++, ...data };
    this.events.push(event);
    return event;
  }

  latestMeasurement(): Measurement | null {
    return this.latest;
  }

  lastStates(): Reading {
    const states: Reading = { sourceA: null, sourceB: null, load1: null, load2: null };
    for (const event of this.events) states[event.channel] = event.to;
    return states;
  }

  lastSeen(): Record<Channel, LastSeen | null> {
    return { ...this.seen };
  }

  listEvents(limit: number, beforeId?: number): EventsPage {
    const candidates = beforeId === undefined ? this.events : this.events.filter((e) => e.id < beforeId);
    const page = candidates.slice(-limit).reverse();
    const oldest = page[page.length - 1];
    const hasMore = candidates.length > page.length;
    return { events: page, nextBefore: hasMore && oldest ? oldest.id : null };
  }

  /** Pas de retour arrière en mémoire : on exécute simplement `fn`. */
  transaction<T>(fn: () => T): T {
    return fn();
  }

  close(): void {}
}
