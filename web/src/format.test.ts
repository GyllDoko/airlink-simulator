import { describe, expect, it } from 'vitest';
import { describeState, formatAge } from './format';

describe('describeState', () => {
  it('affiche « Inconnu » pour null, jamais un état négatif', () => {
    expect(describeState('sourceA', null)).toBe('Inconnu');
    expect(describeState('load1', null)).toBe('Inconnu');
  });

  it('distingue false (vrai état) de null (inconnu)', () => {
    expect(describeState('sourceB', false)).toBe('Indisponible');
    expect(describeState('load2', false)).toBe('Inactive');
    expect(describeState('sourceB', true)).toBe('Disponible');
    expect(describeState('load2', true)).toBe('Active');
  });
});

describe('formatAge', () => {
  it('gère l’absence de mesure', () => {
    expect(formatAge(null)).toBe('Aucune mesure reçue');
  });
  it('formate secondes, minutes et heures', () => {
    expect(formatAge(0)).toBe('il y a 0 s');
    expect(formatAge(4999)).toBe('il y a 4 s');
    expect(formatAge(125_000)).toBe('il y a 2 min 5 s');
    expect(formatAge(3_900_000)).toBe('il y a 1 h 5 min');
  });
});
