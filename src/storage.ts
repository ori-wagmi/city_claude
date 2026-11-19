/**
 * Local-only persistence (localStorage). Nothing is sent anywhere.
 *
 * - The world is stored compactly as {seed, preset, ops}: the generator is
 *   deterministic, so replaying the ops log rebuilds the exact same map.
 * - Real-name placements are stored per wallet address and tagged with the
 *   worldId they belong to; a new world (regenerate / preset / reset) makes
 *   them stale and they are dropped.
 */

export type WorldOp = { t: 'add'; s: number } | { t: 'regen'; u: number; s: number };

export interface SavedWorld {
  v: 2;
  worldId: string;
  seed: number;
  preset: number;
  ops: WorldOp[];
}

export interface Placement {
  namehash: string;
  name: string;
  x: number;
  y: number;
  /** uid of the landmass the plot belongs to */
  land: number;
  t: number;
}

const WORLD_KEY = 'hlcity2:world';
const PLACE_PREFIX = 'hlcity2:placements:';
const LAST_WALLET_KEY = 'hlcity2:lastWallet';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}
function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadWorld(): SavedWorld | null {
  const w = read<SavedWorld>(WORLD_KEY);
  if (!w || w.v !== 2 || typeof w.worldId !== 'string' || !Number.isInteger(w.seed) || !Number.isInteger(w.preset) || !Array.isArray(w.ops)) return null;
  return w;
}
export const saveWorld = (w: SavedWorld) => write(WORLD_KEY, w);

const placeKey = (address: string) => PLACE_PREFIX + address.toLowerCase();

function placementKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PLACE_PREFIX)) keys.push(k);
    }
  } catch {
    /* ignore */
  }
  return keys;
}

function isPlacement(p: unknown): p is Placement {
  const q = p as Placement;
  return !!q && typeof q.namehash === 'string' && typeof q.name === 'string' && Number.isInteger(q.x) && Number.isInteger(q.y) && Number.isInteger(q.land);
}

/** This wallet's placements for the given world (stale-world records are ignored). */
export function loadPlacements(address: string, worldId: string): Placement[] {
  const d = read<{ worldId?: string; items?: unknown[] }>(placeKey(address));
  if (!d || d.worldId !== worldId || !Array.isArray(d.items)) return [];
  return d.items.filter(isPlacement);
}

export function savePlacements(address: string, worldId: string, items: Placement[]): boolean {
  return write(placeKey(address), { worldId, items });
}

/** Destructive world reset: forget every wallet's placements. */
export function clearAllPlacements(): void {
  for (const k of placementKeys()) remove(k);
}

/** Landmass regenerated/removed: drop every wallet's placements on those landmasses. */
export function clearPlacementsOn(worldId: string, landUids: Set<number>): void {
  for (const k of placementKeys()) {
    const d = read<{ worldId?: string; items?: unknown[] }>(k);
    if (!d || d.worldId !== worldId || !Array.isArray(d.items)) {
      remove(k);
      continue;
    }
    write(k, { worldId, items: d.items.filter((p) => isPlacement(p) && !landUids.has(p.land)) });
  }
}

/** Drop every wallet's placements that sit on tiles no longer valid (e.g. a bridge road was carved). */
export function prunePlacements(worldId: string, valid: (p: Placement) => boolean): void {
  for (const k of placementKeys()) {
    const d = read<{ worldId?: string; items?: unknown[] }>(k);
    if (!d || d.worldId !== worldId || !Array.isArray(d.items)) continue;
    const items = d.items.filter(isPlacement);
    const kept = items.filter(valid);
    if (kept.length !== items.length) write(k, { worldId, items: kept });
  }
}

export const getLastWallet = () => read<string>(LAST_WALLET_KEY);
export function setLastWallet(id: string | null) {
  if (id) write(LAST_WALLET_KEY, id);
  else remove(LAST_WALLET_KEY);
}
