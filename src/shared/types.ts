/** Les quatre éléments suivis par le contrôleur. */
export const CHANNELS = ['sourceA', 'sourceB', 'load1', 'load2'] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * État d'un élément.
 * - Source : `true` = disponible, `false` = indisponible
 * - Charge : `true` = active, `false` = inactive
 * - `null` = INCONNU (valeur absente ou mesure trop ancienne). Ce n'est jamais `false`.
 */
export type ChannelState = boolean | null;
export type Reading = Record<Channel, ChannelState>;

export interface Measurement {
  id: number;
  /** Horodatage de réception par le backend (ISO 8601, UTC). Sert au calcul de fraîcheur. */
  receivedAt: string;
  /** Horodatage fourni par le contrôleur, s'il y en a un. Informatif uniquement. */
  measuredAt: string | null;
  values: Reading;
}

export type EventReason = 'measurement' | 'stale';

/** Changement d'état d'un élément. */
export interface StateEvent {
  id: number;
  at: string;
  channel: Channel;
  from: ChannelState;
  to: ChannelState;
  /** `measurement` : issu d'une mesure. `stale` : passé à inconnu car la mesure est trop ancienne. */
  reason: EventReason;
}

export type Freshness = 'never' | 'fresh' | 'stale';

export interface Status {
  now: string;
  staleAfterMs: number;
  freshness: Freshness;
  ageMs: number | null;
  lastMeasurement: Measurement | null;
  /** États courants : tous `null` si aucune mesure ou mesure trop ancienne. */
  channels: Reading;
}

export interface EventsPage {
  /** Du plus récent au plus ancien. */
  events: StateEvent[];
  /** Curseur à passer en `before` pour la page suivante, `null` s'il n'y en a plus. */
  nextBefore: number | null;
}
