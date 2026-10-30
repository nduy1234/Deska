import type { DeformParams, Primitive } from '../sculpt/deform.js';

/**
 * Persisted desk model. Pure: no IndexedDB, no IWSDK. Streak and daily
 * growth logic lives here so it is unit tested with fixed dates.
 */

export const SNAPSHOT_VERSION = 1;

export interface SavedObject {
  uid: string;
  kind: 'clay' | 'note';
  primitive?: Primitive;
  deform?: DeformParams;
  priority?: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  tool?: { archetype: string; behavior: string; state: string; items: string; level: number };
}

export interface DeskSnapshot {
  version: typeof SNAPSHOT_VERSION;
  objects: SavedObject[];
  /** Local calendar day (YYYY-MM-DD) of the last visit. */
  lastDay: string;
  /** Consecutive days visited, including today. */
  streak: number;
  /** Distinct days visited in total (drives the growth schedule). */
  daysVisited: number;
  /** Growth ids already opened. */
  unlocks: string[];
  /** A growth gift waiting on the desk, unopened. */
  pendingGift: string | null;
  roomLevel: number;
  onboardingDone: boolean;
}

export function emptySnapshot(): DeskSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    objects: [],
    lastDay: '',
    streak: 0,
    daysVisited: 0,
    unlocks: [],
    pendingGift: null,
    roomLevel: 0,
    onboardingDone: false,
  };
}

/** Local YYYY-MM-DD for a date (the user's day, not UTC). */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

export type GrowthItem =
  | { id: string; kind: 'primitive'; primitive: Primitive; label: string }
  | { id: string; kind: 'upgrade'; archetype: string; level: number; label: string };

/** One gift per new day visited, in this order. */
export const GROWTH: GrowthItem[] = [
  { id: 'cone', kind: 'primitive', primitive: 'cone', label: 'New clay: cone' },
  { id: 'hourglass-2', kind: 'upgrade', archetype: 'hourglass', level: 2, label: 'Hourglass learns breaks' },
  { id: 'capsule', kind: 'primitive', primitive: 'capsule', label: 'New clay: capsule' },
  { id: 'dial-2', kind: 'upgrade', archetype: 'dial', level: 2, label: 'Dial warms the room' },
  { id: 'jar-2', kind: 'upgrade', archetype: 'jar', level: 2, label: 'Jar names your top note' },
];

export interface VisitResult {
  snapshot: DeskSnapshot;
  /** First visit on a new calendar day. */
  newDay: boolean;
  /** Gift placed on the desk for today, if any. */
  gift: GrowthItem | null;
}

/**
 * Record a visit on `today`. Streaks forgive nothing but the same day;
 * the desk itself never shrinks, so a broken streak only resets the plant.
 */
export function visit(prev: DeskSnapshot, today: string): VisitResult {
  const s: DeskSnapshot = { ...prev, objects: prev.objects, unlocks: [...prev.unlocks] };
  if (s.lastDay === today) return { snapshot: s, newDay: false, gift: null };

  const firstEver = s.lastDay === '';
  const gap = firstEver ? 0 : daysBetween(s.lastDay, today);
  if (gap < 0) {
    // Clock went backwards: treat as same day, don't grant anything.
    return { snapshot: s, newDay: false, gift: null };
  }
  s.streak = gap === 1 ? s.streak + 1 : 1;
  s.daysVisited += 1;
  s.lastDay = today;

  let gift: GrowthItem | null = null;
  if (!firstEver && !s.pendingGift) {
    gift = GROWTH.find((g) => !s.unlocks.includes(g.id)) ?? null;
    if (gift) s.pendingGift = gift.id;
  }
  return { snapshot: s, newDay: true, gift };
}

export function openGift(s: DeskSnapshot): GrowthItem | null {
  const g = GROWTH.find((x) => x.id === s.pendingGift) ?? null;
  if (g && !s.unlocks.includes(g.id)) s.unlocks.push(g.id);
  s.pendingGift = null;
  return g;
}

export function unlockedPrimitives(s: DeskSnapshot): Primitive[] {
  const base: Primitive[] = ['cube', 'cylinder', 'sphere'];
  for (const g of GROWTH) {
    if (g.kind === 'primitive' && s.unlocks.includes(g.id)) base.push(g.primitive);
  }
  return base;
}

export function toolLevel(s: DeskSnapshot, archetype: string): number {
  let level = 1;
  for (const g of GROWTH) {
    if (g.kind === 'upgrade' && g.archetype === archetype && s.unlocks.includes(g.id)) {
      level = Math.max(level, g.level);
    }
  }
  return level;
}

/** Defensive parse of whatever IndexedDB handed back. */
export function parseSnapshot(raw: unknown): DeskSnapshot {
  const base = emptySnapshot();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<DeskSnapshot>;
  if (r.version !== SNAPSHOT_VERSION) return base;
  return {
    ...base,
    ...r,
    objects: Array.isArray(r.objects) ? r.objects.filter(isSavedObject) : [],
    unlocks: Array.isArray(r.unlocks) ? r.unlocks.filter((u) => typeof u === 'string') : [],
  };
}

function isSavedObject(o: unknown): o is SavedObject {
  if (!o || typeof o !== 'object') return false;
  const x = o as SavedObject;
  return (
    typeof x.uid === 'string' &&
    (x.kind === 'clay' || x.kind === 'note') &&
    Array.isArray(x.position) &&
    x.position.length === 3 &&
    x.position.every(Number.isFinite) &&
    Array.isArray(x.quaternion) &&
    x.quaternion.length === 4 &&
    x.quaternion.every(Number.isFinite)
  );
}
