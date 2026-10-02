import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EventsPage, Measurement, StateEvent } from '../shared/types';

type LogLine =
  | { type: 'measurement'; data: Measurement }
  | { type: 'event'; data: StateEvent };

/**
 * Stockage en mémoire, avec journal JSONL optionnel pour survivre à un redémarrage.
 *
 * - Les événements sont tous conservés (en mémoire et dans le journal).
 * - Seule la dernière mesure est gardée en mémoire ; le journal, lui, les garde toutes.
 */
export class Repository {
  private latest: Measurement | null = null;
  private events: StateEvent[] = [];
  private nextMeasurementId = 1;
  private nextEventId = 1;

  constructor(private readonly file?: string) {
    if (file) this.load(file);
  }

  addMeasurement(data: Omit<Measurement, 'id'>): Measurement {
    const measurement: Measurement = { id: this.nextMeasurementId++, ...data };
    this.latest = measurement;
    this.persist({ type: 'measurement', data: measurement });
    return measurement;
  }

  addEvent(data: Omit<StateEvent, 'id'>): StateEvent {
    const event: StateEvent = { id: this.nextEventId++, ...data };
    this.events.push(event);
    this.persist({ type: 'event', data: event });
    return event;
  }

  latestMeasurement(): Measurement | null {
    return this.latest;
  }

  allEvents(): readonly StateEvent[] {
    return this.events;
  }

  listEvents(limit: number, beforeId?: number): EventsPage {
    const candidates =
      beforeId === undefined ? this.events : this.events.filter((e) => e.id < beforeId);
    const page = candidates.slice(-limit).reverse();
    const oldest = page[page.length - 1];
    const hasMore = candidates.length > page.length;
    return { events: page, nextBefore: hasMore && oldest ? oldest.id : null };
  }

  private persist(line: LogLine): void {
    if (this.file) appendFileSync(this.file, JSON.stringify(line) + '\n');
  }

  private load(file: string): void {
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file)) return;
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      if (!raw.trim()) continue;
      let line: LogLine;
      try {
        line = JSON.parse(raw) as LogLine;
      } catch {
        console.warn('Ligne illisible ignorée dans le journal :', raw.slice(0, 80));
        continue;
      }
      if (line.type === 'measurement') {
        this.latest = line.data;
        this.nextMeasurementId = line.data.id + 1;
      } else {
        this.events.push(line.data);
        this.nextEventId = line.data.id + 1;
      }
    }
  }
}
