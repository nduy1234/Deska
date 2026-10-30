import { describe, expect, it } from 'vitest';
import {
  dayKey,
  daysBetween,
  emptySnapshot,
  GROWTH,
  openGift,
  parseSnapshot,
  toolLevel,
  unlockedPrimitives,
  visit,
} from './model.js';

describe('days', () => {
  it('uses the local calendar day and counts gaps across months', () => {
    expect(dayKey(new Date(2026, 9, 31, 23, 59))).toBe('2026-10-31');
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(daysBetween('2026-11-01', '2026-11-18')).toBe(17);
  });
});

describe('visit / streak / growth', () => {
  it('first visit starts a streak with no gift', () => {
    const r = visit(emptySnapshot(), '2026-11-01');
    expect(r.newDay).toBe(true);
    expect(r.gift).toBeNull();
    expect(r.snapshot.streak).toBe(1);
  });

  it('same day again changes nothing', () => {
    const a = visit(emptySnapshot(), '2026-11-01').snapshot;
    const b = visit(a, '2026-11-01');
    expect(b.newDay).toBe(false);
    expect(b.snapshot.streak).toBe(1);
  });

  it('next day grows the streak and leaves a gift; opening it unlocks', () => {
    const a = visit(emptySnapshot(), '2026-11-01').snapshot;
    const b = visit(a, '2026-11-02');
    expect(b.snapshot.streak).toBe(2);
    expect(b.gift?.id).toBe(GROWTH[0].id);
    expect(b.snapshot.pendingGift).toBe(GROWTH[0].id);
    const g = openGift(b.snapshot);
    expect(g?.id).toBe('cone');
    expect(unlockedPrimitives(b.snapshot)).toContain('cone');
  });

  it('a missed day resets the streak but still grows the desk', () => {
    const a = visit(emptySnapshot(), '2026-11-01').snapshot;
    const b = visit(a, '2026-11-05');
    expect(b.snapshot.streak).toBe(1);
    expect(b.gift).not.toBeNull();
  });

  it('an unopened gift is not replaced by another', () => {
    let s = visit(emptySnapshot(), '2026-11-01').snapshot;
    s = visit(s, '2026-11-02').snapshot;
    const r = visit(s, '2026-11-03');
    expect(r.gift).toBeNull();
    expect(r.snapshot.pendingGift).toBe('cone');
  });

  it('upgrades raise tool level in order', () => {
    let s = visit(emptySnapshot(), '2026-11-01').snapshot;
    for (let d = 2; d <= 3; d++) {
      s = visit(s, `2026-11-0${d}`).snapshot;
      openGift(s);
    }
    expect(toolLevel(s, 'hourglass')).toBe(2);
    expect(toolLevel(s, 'dial')).toBe(1);
  });

  it('ignores clocks moving backwards', () => {
    const a = visit(emptySnapshot(), '2026-11-05').snapshot;
    const b = visit(a, '2026-11-04');
    expect(b.newDay).toBe(false);
    expect(b.snapshot.lastDay).toBe('2026-11-05');
  });
});

describe('parseSnapshot', () => {
  it('drops malformed objects and unknown versions', () => {
    expect(parseSnapshot({ version: 99 }).objects).toEqual([]);
    const s = parseSnapshot({
      ...emptySnapshot(),
      objects: [
        { uid: 'a', kind: 'clay', position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        { uid: 'b', kind: 'clay', position: [0, NaN, 0], quaternion: [0, 0, 0, 1] },
        { uid: 'c', kind: 'robot', position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      ],
    });
    expect(s.objects.map((o) => o.uid)).toEqual(['a']);
  });
});
