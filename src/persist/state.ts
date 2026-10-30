import { dayKey, emptySnapshot, type DeskSnapshot } from './model.js';

/**
 * Live desk snapshot shared by persistence, growth, tools and onboarding.
 * `loaded` flips once IndexedDB has been read and the desk restored.
 */
export const deskState: {
  snapshot: DeskSnapshot;
  loaded: boolean;
  /** Set when this load was the first visit of a new day. */
  newDay: boolean;
  dirty: boolean;
} = { snapshot: emptySnapshot(), loaded: false, newDay: false, dirty: false };

/** Day offset for testing the daily growth: `?day=3` pretends it is 3 days later. */
const dayOffset = (() => {
  try {
    return Number(new URLSearchParams(location.search).get('day') ?? 0) || 0;
  } catch {
    return 0;
  }
})();

export function today(): string {
  return dayKey(new Date(Date.now() + dayOffset * 86_400_000));
}

export function markDirty(): void {
  deskState.dirty = true;
}
