import { CHANNELS, type Channel } from '../shared/types';

export type Truth = Record<Channel, boolean>;
export type Rng = () => number;

export interface FaultRates {
  /** Probabilité qu'un élément change d'état à chaque cycle. */
  flip: number;
  /** Probabilité qu'un champ soit absent du message. */
  omit: number;
  /** Probabilité qu'un champ soit envoyé explicitement à null. */
  nullValue: number;
}

export const DEFAULT_RATES: FaultRates = { flip: 0.1, omit: 0.05, nullValue: 0.03 };

export function initialTruth(): Truth {
  return { sourceA: true, sourceB: true, load1: true, load2: false };
}

export function nextTruth(prev: Truth, rng: Rng, rates: FaultRates = DEFAULT_RATES): Truth {
  const next = { ...prev };
  for (const channel of CHANNELS) {
    if (rng() < rates.flip) next[channel] = !next[channel];
  }
  return next;
}

/** Construit le message du contrôleur, avec des champs parfois absents ou nuls. */
export function toPayload(truth: Truth, rng: Rng, rates: FaultRates = DEFAULT_RATES): Record<string, boolean | null> {
  const payload: Record<string, boolean | null> = {};
  for (const channel of CHANNELS) {
    const roll = rng();
    if (roll < rates.omit) continue;
    payload[channel] = roll < rates.omit + rates.nullValue ? null : truth[channel];
  }
  return payload;
}
