import type { Entity } from '@iwsdk/core';
import type { Side } from './hands.js';

/**
 * Physical desk events. Manipulation and tool sensors emit them; the block
 * runtime, onboarding and persistence listen. Kept tiny and synchronous.
 */
export type DeskEvent =
  | { type: 'grab'; entity: Entity; side: Side }
  | { type: 'release'; entity: Entity; side: Side }
  | { type: 'settled'; entity: Entity; flipped: boolean }
  | { type: 'spawned'; entity: Entity }
  | { type: 'removed'; entity: Entity; uid: string }
  | { type: 'sculpted'; entity: Entity }
  | { type: 'archetype'; entity: Entity; archetype: string }
  | { type: 'poke'; entity: Entity; side: Side };

type Listener = (e: DeskEvent) => void;
const listeners = new Set<Listener>();

export const deskEvents = {
  on(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(e: DeskEvent): void {
    for (const fn of listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error('[deska] listener failed', err);
      }
    }
  },
};
