import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { Monitor } from './monitor';
import { Repository } from './repository';
import { FakeClock } from './test-utils';

describe('API', () => {
  let clock: FakeClock;
  let app: FastifyInstance;

  beforeEach(() => {
    clock = new FakeClock();
    app = buildApp(new Monitor(new Repository(), { staleAfterMs: 15_000, clock: () => clock.now() }));
  });

  const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/measurements', payload: payload as object });

  describe('POST /api/measurements', () => {
    it('accepte une mesure complète', async () => {
      const res = await post({ sourceA: true, sourceB: false, load1: true, load2: false });
      expect(res.statusCode).toBe(201);
      expect(res.json().measurement.values).toEqual({ sourceA: true, sourceB: false, load1: true, load2: false });
    });

    it('accepte une mesure partielle et garde null pour les champs absents', async () => {
      const res = await post({ sourceA: true });
      expect(res.statusCode).toBe(201);
      expect(res.json().measurement.values).toEqual({ sourceA: true, sourceB: null, load1: null, load2: null });
    });

    it.each([
      ['un nombre 0', { sourceA: 0 }],
      ['un nombre 1', { load1: 1 }],
      ['une chaîne', { sourceB: 'true' }],
      ['une clé inconnue', { load3: true }],
      ['un horodatage invalide', { measuredAt: 'hier' }],
    ])('refuse %s avec un 400', async (_label, payload) => {
      const res = await post(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_payload');
    });

    it('refuse un JSON invalide', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/measurements',
        headers: { 'content-type': 'application/json' },
        payload: '{oups',
      });
      expect(res.statusCode).toBe(400);
    });

    it("n'enregistre rien quand la mesure est refusée", async () => {
      await post({ sourceA: 0 });
      const status = (await app.inject({ url: '/api/status' })).json();
      expect(status.freshness).toBe('never');
    });
  });

  describe('GET /api/status', () => {
    it('renvoie tout inconnu avant la première mesure', async () => {
      const status = (await app.inject({ url: '/api/status' })).json();
      expect(status.freshness).toBe('never');
      expect(status.lastMeasurement).toBeNull();
    });

    it('renvoie la dernière mesure, puis inconnu quand elle est trop ancienne', async () => {
      await post({ sourceA: true, load1: false });
      clock.advance(5000);
      let status = (await app.inject({ url: '/api/status' })).json();
      expect(status.freshness).toBe('fresh');
      expect(status.channels.sourceA).toBe(true);
      expect(status.channels.load1).toBe(false);

      clock.advance(11_000);
      status = (await app.inject({ url: '/api/status' })).json();
      expect(status.freshness).toBe('stale');
      expect(status.channels).toEqual({ sourceA: null, sourceB: null, load1: null, load2: null });
      expect(status.lastMeasurement.values.sourceA).toBe(true);
    });
  });

  describe('GET /api/events', () => {
    it('liste les événements du plus récent au plus ancien, avec pagination', async () => {
      for (const on of [true, false, true]) {
        await post({ load1: on });
        clock.advance(5000);
      }
      const page1 = (await app.inject({ url: '/api/events?limit=2' })).json();
      expect(page1.events.map((e: { to: boolean }) => e.to)).toEqual([true, false]);
      const page2 = (await app.inject({ url: `/api/events?limit=2&before=${page1.nextBefore}` })).json();
      expect(page2.events).toHaveLength(1);
      expect(page2.nextBefore).toBeNull();
    });

    it("inclut le passage à inconnu quand la mesure est périmée, sans nouvelle mesure", async () => {
      await post({ sourceA: true });
      clock.advance(60_000);
      const { events } = (await app.inject({ url: '/api/events' })).json();
      expect(events[0]).toMatchObject({ channel: 'sourceA', to: null, reason: 'stale' });
    });

    it.each(['limit=0', 'limit=1000', 'limit=abc', 'before=-3'])('refuse la requête %s', async (qs) => {
      expect((await app.inject({ url: `/api/events?${qs}` })).statusCode).toBe(400);
    });
  });
});
