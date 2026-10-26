import { initialTruth, nextTruth, sourceADropoutPayload, sourceAPhase, toPayload } from './generator';

const url = process.env.API_URL ?? 'http://127.0.0.1:3000/api/measurements';
const intervalMs = Number(process.env.INTERVAL_MS ?? 5000);
// Probabilité de démarrer une coupure (aucun message pendant 4 à 6 cycles) pour voir l'état inconnu.
const outageProbability = Number(process.env.OUTAGE_PROBABILITY ?? 0.05);

// `source-a` : scénario où seul sourceA disparaît. `random` : ancienne simulation aléatoire.
const MODES = ['source-a', 'random'] as const;
type Mode = (typeof MODES)[number];
const rawMode = process.env.SIM_MODE || 'source-a';
if (!MODES.includes(rawMode as Mode)) {
  throw new Error(`SIM_MODE doit valoir ${MODES.join(' ou ')} (reçu : "${rawMode}")`);
}
const mode = rawMode as Mode;

let truth = initialTruth();
let silentCycles = 0;
let step = 0;

async function send(payload: Record<string, boolean | null>, note = ''): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(res.status, JSON.stringify(payload), note);
  } catch (error) {
    console.error('API injoignable :', error instanceof Error ? error.message : error);
  }
}

async function tickRandom(): Promise<void> {
  truth = nextTruth(truth, Math.random);

  if (silentCycles > 0) {
    silentCycles--;
    console.log('(coupure simulée : aucun message)');
    return;
  }
  if (Math.random() < outageProbability) {
    silentCycles = 4 + Math.floor(Math.random() * 3);
    console.log('Début d’une coupure simulée');
    return;
  }

  await send(toPayload(truth, Math.random));
}

const PHASE_NOTES = {
  present: '',
  'short-gap': '(sourceA absent : dernier état maintenu)',
  'long-gap': '(sourceA absent : inconnu attendu après 15 s)',
};

async function tickSourceA(): Promise<void> {
  // Les autres éléments continuent de vivre ; sourceA reste fixe pour ne voir que connu ↔ inconnu.
  truth = { ...nextTruth(truth, Math.random), sourceA: true };
  const current = step++;
  await send(sourceADropoutPayload(truth, current), PHASE_NOTES[sourceAPhase(current)]);
}

const tick = mode === 'random' ? tickRandom : tickSourceA;

console.log(`Simulateur du contrôleur (mode ${mode}) → ${url} toutes les ${intervalMs} ms`);
void tick();
setInterval(() => void tick(), intervalMs);
