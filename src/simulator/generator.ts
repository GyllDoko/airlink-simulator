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

/**
 * Scénario « sourceA disparaît » : un cycle de 12 messages (60 s à 5 s par message).
 * - `present` : les 4 éléments sont envoyés.
 * - `short-gap` : sourceA absent 2 messages (10 s) — le backend doit garder son dernier état.
 * - `long-gap` : sourceA absent 5 messages (25 s) — le backend doit le passer à inconnu après 15 s.
 * sourceB, load1 et load2 sont toujours envoyés.
 */
export const SOURCE_A_DROPOUT_CYCLE = 12;
export type SourceAPhase = 'present' | 'short-gap' | 'long-gap';

export function sourceAPhase(step: number): SourceAPhase {
  const position = step % SOURCE_A_DROPOUT_CYCLE;
  if (position === 3 || position === 4) return 'short-gap';
  if (position >= 7) return 'long-gap';
  return 'present';
}

/** Message de l'étape `step` : sourceA est omis (champ absent, pas `null`) pendant les absences. */
export function sourceADropoutPayload(truth: Truth, step: number): Record<string, boolean | null> {
  const payload: Record<string, boolean | null> = { ...truth };
  if (sourceAPhase(step) !== 'present') delete payload.sourceA;
  return payload;
}
