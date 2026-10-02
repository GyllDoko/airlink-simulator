import type { Channel, ChannelState, StateEvent } from '../../src/shared/types';

export const CHANNEL_LABELS: Record<Channel, string> = {
  sourceA: 'Source A',
  sourceB: 'Source B',
  load1: 'Charge 1',
  load2: 'Charge 2',
};

export function isSource(channel: Channel): boolean {
  return channel === 'sourceA' || channel === 'sourceB';
}

/** `null` → « Inconnu ». Jamais « Indisponible » ni « Inactive » : ce serait inventer une valeur. */
export function describeState(channel: Channel, state: ChannelState): string {
  if (state === null) return 'Inconnu';
  if (isSource(channel)) return state ? 'Disponible' : 'Indisponible';
  return state ? 'Active' : 'Inactive';
}

export function formatAge(ageMs: number | null): string {
  if (ageMs === null) return 'Aucune mesure reçue';
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `il y a ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min ${seconds % 60} s`;
  const hours = Math.floor(minutes / 60);
  return `il y a ${hours} h ${minutes % 60} min`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function describeReason(event: StateEvent): string {
  return event.reason === 'stale' ? 'mesure trop ancienne' : 'mesure reçue';
}
