import { useEffect, useState } from 'react';
import type { Channel, ChannelState, EventsPage, Reading, Status } from '../../src/shared/types';
import { fetchEvents, fetchStatus } from './api';
import {
  CHANNEL_LABELS,
  describeReason,
  describeState,
  formatAge,
  formatDateTime,
} from './format';

const POLL_MS = 2000;
const EVENTS_LIMIT = 100;
const ALL_UNKNOWN: Reading = { sourceA: null, sourceB: null, load1: null, load2: null };

interface Snapshot {
  status: Status;
  events: EventsPage;
}

function usePolling(intervalMs: number) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        // Le statut d'abord : la lecture de l'historique rattrape un éventuel passage à inconnu.
        const status = await fetchStatus();
        const events = await fetchEvents(EVENTS_LIMIT);
        if (cancelled) return;
        setSnapshot({ status, events });
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'erreur inconnue');
      }
    };
    void tick();
    const id = setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return { snapshot, error };
}

function stateClass(state: ChannelState): string {
  return state === null ? 'unknown' : state ? 'on' : 'off';
}

function Tile({ channel, state }: { channel: Channel; state: ChannelState }) {
  return (
    <li className={`tile ${stateClass(state)}`}>
      <span className="glyph" aria-hidden="true" />
      <span className="tile-label">{CHANNEL_LABELS[channel]}</span>
      <span className="tile-state">{describeState(channel, state)}</span>
    </li>
  );
}

export function App() {
  const { snapshot, error } = usePolling(POLL_MS);
  const status = snapshot?.status;
  // Si l'API est injoignable, les valeurs affichées ne sont plus garanties : on affiche « Inconnu ».
  const channels = error || !status ? ALL_UNKNOWN : status.channels;
  const last = status?.lastMeasurement ?? null;

  return (
    <main>
      <header>
        <h1>Supervision énergie</h1>
        {error ? (
          <p className="banner alert" role="alert">
            API injoignable ({error}). Les états sont affichés comme inconnus.
          </p>
        ) : status?.freshness === 'stale' ? (
          <p className="banner warn" role="status">
            Aucune mesure depuis plus de {Math.round(status.staleAfterMs / 1000)} s : états inconnus.
          </p>
        ) : status?.freshness === 'never' ? (
          <p className="banner warn" role="status">
            Aucune mesure reçue pour le moment.
          </p>
        ) : null}
      </header>

      <section aria-labelledby="sources">
        <h2 id="sources">Sources</h2>
        <ul className="tiles">
          <Tile channel="sourceA" state={channels.sourceA} />
          <Tile channel="sourceB" state={channels.sourceB} />
        </ul>
      </section>

      <section aria-labelledby="loads">
        <h2 id="loads">Charges</h2>
        <ul className="tiles">
          <Tile channel="load1" state={channels.load1} />
          <Tile channel="load2" state={channels.load2} />
        </ul>
      </section>

      <section aria-labelledby="last">
        <h2 id="last">Dernière mesure</h2>
        {last ? (
          <p className="last">
            <strong>{formatDateTime(last.receivedAt)}</strong>
            <span>{error ? 'état de la dernière réponse reçue' : formatAge(status?.ageMs ?? null)}</span>
            <span className="values">
              {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => (
                <span key={c}>
                  {CHANNEL_LABELS[c]} : {describeState(c, last.values[c])}
                </span>
              ))}
            </span>
          </p>
        ) : (
          <p className="empty">{snapshot ? 'Le contrôleur n’a encore rien envoyé.' : 'Chargement…'}</p>
        )}
      </section>

      <section aria-labelledby="history">
        <h2 id="history">Historique des événements</h2>
        {snapshot && snapshot.events.events.length === 0 ? (
          <p className="empty">Aucun changement d’état enregistré.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Heure</th>
                  <th>Élément</th>
                  <th>Changement</th>
                  <th>Cause</th>
                </tr>
              </thead>
              <tbody>
                {snapshot?.events.events.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateTime(e.at)}</td>
                    <td>{CHANNEL_LABELS[e.channel]}</td>
                    <td>
                      {describeState(e.channel, e.from)} → <strong>{describeState(e.channel, e.to)}</strong>
                    </td>
                    <td>{describeReason(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {snapshot?.events.nextBefore != null && (
          <p className="empty">Les {EVENTS_LIMIT} événements les plus récents sont affichés.</p>
        )}
      </section>
    </main>
  );
}
