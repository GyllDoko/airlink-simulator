import { describe, expect, it } from 'vitest';
import { initialTruth, nextTruth, toPayload } from './generator';

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
