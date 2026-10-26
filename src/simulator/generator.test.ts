import { describe, expect, it } from 'vitest';
import {
  SOURCE_A_DROPOUT_CYCLE,
  initialTruth,
  nextTruth,
  sourceADropoutPayload,
  sourceAPhase,
  toPayload,
} from './generator';

describe('simulateur', () => {
  it("n'omet ni ne change rien quand le hasard est toujours élevé", () => {
    const truth = initialTruth();
    expect(nextTruth(truth, () => 0.99)).toEqual(truth);
    expect(toPayload(truth, () => 0.99)).toEqual(truth);
  });

  it('omet les champs quand le hasard est très bas', () => {
    expect(toPayload(initialTruth(), () => 0)).toEqual({});
  });

  it('envoie null explicitement (pas false) pour une valeur nulle', () => {
    const payload = toPayload(initialTruth(), () => 0.06);
    expect(Object.values(payload)).toEqual([null, null, null, null]);
  });
});

describe('scénario « sourceA disparaît »', () => {
  const truth = { sourceA: true, sourceB: false, load1: true, load2: false };
  const others = { sourceB: false, load1: true, load2: false };

  it('envoie les 4 éléments hors des absences', () => {
    for (const step of [0, 1, 2, 5, 6]) {
      expect(sourceADropoutPayload(truth, step)).toEqual(truth);
    }
  });

  it('omet sourceA (absent, ni null ni false) et garde les autres pendant les absences', () => {
    for (const step of [3, 4, 7, 8, 9, 10, 11]) {
      const payload = sourceADropoutPayload(truth, step);
      expect('sourceA' in payload).toBe(false);
      expect(payload).toEqual(others);
    }
  });

  it('une absence courte (10 s) puis une absence longue (25 s) à 5 s par message', () => {
    const phases = Array.from({ length: SOURCE_A_DROPOUT_CYCLE }, (_, step) => sourceAPhase(step));
    expect(phases.filter((p) => p === 'short-gap')).toHaveLength(2);
    expect(phases.filter((p) => p === 'long-gap')).toHaveLength(5);
  });

  it('recommence le cycle', () => {
    expect(sourceAPhase(SOURCE_A_DROPOUT_CYCLE)).toBe('present');
    expect(sourceAPhase(SOURCE_A_DROPOUT_CYCLE + 3)).toBe('short-gap');
  });
});
