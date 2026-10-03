import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Monitor } from "./monitor";
import { MemoryRepository, type Repository } from "./repository";
import { SqliteRepository } from "./sqlite-repository";
import { FakeClock } from "./test-utils";

const STALE_AFTER = 15_000;

// La logique métier doit se comporter de la même façon quel que soit le stockage.
const backends: Array<[string, () => Repository]> = [
  ["mémoire", () => new MemoryRepository()],
  ["SQLite", () => new SqliteRepository(":memory:")],
];

describe.each(backends)("Monitor (%s)", (_name, createRepository) => {
  let clock: FakeClock;
  let repo: Repository;
  let monitor: Monitor;

  beforeEach(() => {
    clock = new FakeClock();
    repo = createRepository();
    monitor = new Monitor(repo, {
      staleAfterMs: STALE_AFTER,
      clock: () => clock.now(),
    });
  });
  afterEach(() => repo.close());

  describe("valeurs manquantes", () => {
    it("transforme une valeur absente en null, jamais en false ni en 0", () => {
      const { measurement } = monitor.ingest({ sourceA: true });
      expect(measurement.values).toEqual({
        sourceA: true,
        sourceB: null,
        load1: null,
        load2: null,
      });
      expect(measurement.values.sourceB).not.toBe(false);
      expect(measurement.values.sourceB).not.toBe(0);
    });

    it("conserve false tel quel (false est une vraie valeur)", () => {
      const { measurement } = monitor.ingest({ sourceA: false, load1: false });
      expect(measurement.values.sourceA).toBe(false);
      expect(measurement.values.load1).toBe(false);
    });

    it("traite un null explicite comme inconnu", () => {
      const { measurement } = monitor.ingest({ sourceA: null });
      expect(measurement.values.sourceA).toBeNull();
    });

    it("accepte une mesure vide : tout est inconnu", () => {
      const { measurement } = monitor.ingest({});
      expect(Object.values(measurement.values)).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });
  });

  describe("événements", () => {
    it("enregistre le premier état connu comme passage inconnu → valeur", () => {
      const { events } = monitor.ingest({ sourceA: true, sourceB: false });
      expect(events.map((e) => [e.channel, e.from, e.to, e.reason])).toEqual([
        ["sourceA", null, true, "measurement"],
        ["sourceB", null, false, "measurement"],
      ]);
    });

    it("n'enregistre rien quand l'état ne change pas", () => {
      monitor.ingest({ sourceA: true });
      clock.advance(5000);
      expect(monitor.ingest({ sourceA: true }).events).toEqual([]);
    });

    it("enregistre un changement d'état", () => {
      monitor.ingest({ load1: true });
      clock.advance(5000);
      const { events } = monitor.ingest({ load1: false });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        channel: "load1",
        from: true,
        to: false,
      });
    });

    it("enregistre le passage à inconnu quand une valeur disparaît", () => {
      monitor.ingest({ sourceA: true });
      clock.advance(5000);
      const { events } = monitor.ingest({});
      expect(events[0]).toMatchObject({
        channel: "sourceA",
        from: true,
        to: null,
        reason: "measurement",
      });
    });
  });

  describe("fraîcheur", () => {
    it("indique « never » et tout inconnu avant la première mesure", () => {
      const status = monitor.getStatus();
      expect(status.freshness).toBe("never");
      expect(status.lastMeasurement).toBeNull();
      expect(Object.values(status.channels)).toEqual([null, null, null, null]);
    });

    it("reste frais jusqu’au seuil inclus", () => {
      monitor.ingest({ sourceA: true, load1: false });
      clock.advance(STALE_AFTER);
      const status = monitor.getStatus();
      expect(status.freshness).toBe("fresh");
      expect(status.channels.sourceA).toBe(true);
      expect(status.channels.load1).toBe(false);
    });

    it("passe tout à inconnu juste après le seuil, sans effacer la dernière mesure", () => {
      monitor.ingest({ sourceA: true, load1: false });
      clock.advance(STALE_AFTER + 1);
      const status = monitor.getStatus();
      expect(status.freshness).toBe("stale");
      expect(Object.values(status.channels)).toEqual([null, null, null, null]);
      expect(status.lastMeasurement?.values.sourceA).toBe(true);
      expect(status.ageMs).toBe(STALE_AFTER + 1);
    });

    it("enregistre l'événement « stale » à l'instant où la mesure est devenue périmée", () => {
      monitor.ingest({ sourceA: true });
      clock.advance(60_000);
      const events = monitor.sweep();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        channel: "sourceA",
        from: true,
        to: null,
        reason: "stale",
      });
      expect(events[0]?.at).toBe("2026-01-01T12:00:15.000Z");
    });

    it("sweep est idempotent", () => {
      monitor.ingest({ sourceA: true });
      clock.advance(60_000);
      expect(monitor.sweep()).toHaveLength(1);
      expect(monitor.sweep()).toEqual([]);
    });

    it("n'enregistre pas d'événement stale pour un élément déjà inconnu", () => {
      monitor.ingest({ sourceA: true });
      clock.advance(60_000);
      expect(monitor.sweep().map((e) => e.channel)).toEqual(["sourceA"]);
    });

    it("reprise : stale puis nouvelle mesure donnent inconnu → valeur dans le bon ordre", () => {
      monitor.ingest({ sourceA: true });
      clock.advance(60_000);
      const { events } = monitor.ingest({ sourceA: true });
      expect(events.map((e) => [e.from, e.to, e.reason])).toEqual([
        [true, null, "stale"],
        [null, true, "measurement"],
      ]);
    });
  });

  describe("historique", () => {
    it("pagine du plus récent au plus ancien", () => {
      for (let i = 0; i < 5; i++) {
        monitor.ingest({ load1: i % 2 === 0 });
        clock.advance(5000);
      }
      const first = monitor.listEvents(2);
      expect(first.events.map((e) => e.id)).toEqual([5, 4]);
      expect(first.nextBefore).toBe(4);
      const last = monitor.listEvents(10, first.nextBefore ?? undefined);
      expect(last.events.map((e) => e.id)).toEqual([3, 2, 1]);
      expect(last.nextBefore).toBeNull();
    });
  });
});

describe("Monitor : redémarrage avec SQLite", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "airlink-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("retrouve événements, dernière mesure et état suivi, sans faux événements", () => {
    const file = join(dir, "airlink.db");
    const clock = new FakeClock();
    const options = { staleAfterMs: STALE_AFTER, clock: () => clock.now() };

    const firstRepo = new SqliteRepository(file);
    new Monitor(firstRepo, options).ingest({ sourceA: true, load1: false });
    firstRepo.close();

    const secondRepo = new SqliteRepository(file);
    const after = new Monitor(secondRepo, options);
    expect(after.getStatus().channels).toMatchObject({
      sourceA: true,
      load1: false,
    });
    expect(after.listEvents(10).events).toHaveLength(2);

    clock.advance(5000);
    expect(after.ingest({ sourceA: true, load1: false }).events).toEqual([]);
    expect(after.ingest({ sourceA: false }).events[0]).toMatchObject({ id: 3 });
    secondRepo.close();
  });

  it("enregistre le passage à inconnu après un arrêt plus long que le seuil", () => {
    const file = join(dir, "airlink.db");
    const clock = new FakeClock();
    const options = { staleAfterMs: STALE_AFTER, clock: () => clock.now() };

    const firstRepo = new SqliteRepository(file);
    new Monitor(firstRepo, options).ingest({ sourceA: true });
    firstRepo.close();

    clock.advance(10 * 60_000); // le serveur était arrêté
    const secondRepo = new SqliteRepository(file);
    const after = new Monitor(secondRepo, options);
    expect(after.getStatus().freshness).toBe("stale");
    expect(after.sweep()[0]).toMatchObject({
      channel: "sourceA",
      to: null,
      reason: "stale",
    });
    secondRepo.close();
  });
});
