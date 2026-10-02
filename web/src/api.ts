import type { EventsPage, Status } from '../../src/shared/types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const fetchStatus = () => getJson<Status>('/api/status');
export const fetchEvents = (limit: number) => getJson<EventsPage>(`/api/events?limit=${limit}`);
