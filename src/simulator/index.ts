import { initialTruth, nextTruth, toPayload } from './generator';

const url = process.env.API_URL ?? 'http://127.0.0.1:3000/api/measurements';
const intervalMs = Number(process.env.INTERVAL_MS ?? 5000);
// Probabilité de démarrer une coupure (aucun message pendant 4 à 6 cycles) pour voir l'état inconnu.
const outageProbability = Number(process.env.OUTAGE_PROBABILITY ?? 0.05);

let truth = initialTruth();
let silentCycles = 0;

async function tick(): Promise<void> {
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

  const payload = toPayload(truth, Math.random);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(res.status, JSON.stringify(payload));
  } catch (error) {
    console.error('API injoignable :', error instanceof Error ? error.message : error);
  }
}

console.log(`Simulateur du contrôleur → ${url} toutes les ${intervalMs} ms`);
void tick();
setInterval(() => void tick(), intervalMs);
