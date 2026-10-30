import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../sculpt/recognizer.js';
import { BehaviorRuntime, type BlockHost } from './runtime.js';
import { simulate } from './simulate.js';
import { closestTemplate, DEFAULT_BEHAVIORS, INTENT_TEMPLATES } from './templates.js';
import { validateBehavior } from './validate.js';

function recorder() {
  const log: string[] = [];
  const host: BlockHost = {
    showText: (t) => log.push(`text:${t}`),
    playSound: (s) => log.push(`sound:${s}`),
    setColor: (c) => log.push(`color:${c}`),
    dimRoom: (l) => log.push(`dim:${l.toFixed(2)}`),
    sortItems: (b) => log.push(`sort:${b}`),
    timerStarted: (id, ms) => log.push(`start:${id}:${ms}`),
    timerStopped: (id) => log.push(`stop:${id}`),
    timerEnded: (id) => log.push(`end:${id}`),
  };
  return { log, host };
}

describe('validator', () => {
  it('accepts every default and template behavior', () => {
    for (const a of ARCHETYPES) expect(validateBehavior(DEFAULT_BEHAVIORS[a]).errors, a).toEqual([]);
    for (const t of INTENT_TEMPLATES) expect(validateBehavior(t.behavior).errors, t.id).toEqual([]);
  });

  it('rejects unknown keys, triggers, actions and code-like payloads', () => {
    const r = validateBehavior({
      version: 1,
      name: 'x',
      rules: [
        { when: { on: 'hover' }, do: [{ do: 'eval', code: 'alert(1)' }] },
        { when: { on: 'flip' }, do: [{ do: 'showText', text: 'hi', onClick: 'x' }] },
      ],
      script: 'fetch()',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/unknown key "script"/);
    expect(r.errors.join('\n')).toMatch(/rules\[0\]\.when\.on/);
    expect(r.errors.join('\n')).toMatch(/rules\[0\]\.do\[0\]\.do/);
    expect(r.errors.join('\n')).toMatch(/unknown key "onClick"/);
  });

  it('rejects undeclared variables, out-of-range numbers and nested sequences', () => {
    const r = validateBehavior({
      version: 1,
      name: 'x',
      vars: { a: 1 },
      rules: [
        {
          when: { on: 'poke' },
          do: [
            { do: 'setValue', var: 'missing', add: 1 },
            { do: 'startTimer', minutes: 999 },
            { do: 'runSequence', steps: [{ action: { do: 'runSequence', steps: [{ wait: 1 }] } }] },
          ],
        },
      ],
    });
    expect(r.ok).toBe(false);
    const all = r.errors.join('\n');
    expect(all).toMatch(/not declared/);
    expect(all).toMatch(/minutes: must be within/);
    expect(all).toMatch(/cannot be nested/);
  });
});

describe('runtime', () => {
  it('hourglass: flip starts 25 min, timer end chimes and counts', () => {
    const { log, host } = recorder();
    const rt = new BehaviorRuntime(DEFAULT_BEHAVIORS.hourglass, host);
    rt.dispatch({ type: 'flip' }, 0);
    expect(log).toContain('start:focus:1500000');
    expect(log).toContain('text:Focus · 25 min');
    expect(rt.timerProgress('focus', 750_000)).toBeCloseTo(0.5);
    rt.tick(1_500_000);
    expect(log).toContain('sound:chime');
    expect(rt.vars.sessions).toBe(1);
  });

  it('dial: turning sets focus, dims the room, throttled by step', () => {
    const { log, host } = recorder();
    const rt = new BehaviorRuntime(DEFAULT_BEHAVIORS.dial, host);
    rt.dispatch({ type: 'turn', angle: 0, value: 0 }, 0);
    rt.dispatch({ type: 'turn', angle: 3, value: 0.01 }, 10); // below 6° step
    rt.dispatch({ type: 'turn', angle: 180, value: 0.66 }, 20);
    expect(log.filter((l) => l.startsWith('dim:'))).toEqual(['dim:0.00', 'dim:0.66']);
    expect(log).toContain('text:Focus 66%');
  });

  it('lever: sequence waits between steps', () => {
    const { log, host } = recorder();
    const rt = new BehaviorRuntime(DEFAULT_BEHAVIORS.lever, host);
    rt.dispatch({ type: 'pull' }, 0);
    expect(log).toContain('text:Good morning');
    expect(log).not.toContain('text:Water · stretch · breathe');
    rt.tick(2_100);
    expect(log).toContain('text:Water · stretch · breathe');
    rt.tick(6_200);
    rt.tick(10_300);
    expect(log.some((l) => l.startsWith('start:warmup'))).toBe(true);
    expect(rt.busy).toBe(false);
  });

  it('restores vars and running timers from a snapshot', () => {
    const { host } = recorder();
    const a = new BehaviorRuntime(DEFAULT_BEHAVIORS.hourglass, host);
    a.dispatch({ type: 'flip' }, 0);
    const snap = a.snapshot(60_000);
    const b = new BehaviorRuntime(DEFAULT_BEHAVIORS.hourglass, host, snap, 1_000_000);
    expect(b.runningTimers).toEqual(['focus']);
    expect(b.timerProgress('focus', 1_000_000 + 1_440_000)).toBeCloseTo(1);
  });

  it('caps runaway action counts', () => {
    const { host } = recorder();
    const many = Array.from({ length: 12 }, () => ({ do: 'playSound' as const, sound: 'tap' as const }));
    const rt = new BehaviorRuntime(
      { version: 1, name: 'loud', rules: Array.from({ length: 16 }, () => ({ when: { on: 'poke' as const }, do: many })) },
      host,
    );
    rt.dispatch({ type: 'poke' }, 0);
    expect(rt.actionsRun).toBe(64);
    expect(rt.errors).toContain('action budget exceeded');
  });
});

describe('simulator', () => {
  it('passes every starter behavior', () => {
    for (const a of ARCHETYPES) {
      const r = simulate(DEFAULT_BEHAVIORS[a]);
      expect(r.checks.filter((c) => !c.pass), a).toEqual([]);
    }
  });

  it('fails a graph with no physical trigger', () => {
    const r = simulate({
      version: 1,
      name: 'ghost',
      rules: [{ when: { on: 'timerEnd' }, do: [{ do: 'playSound', sound: 'tap' }] }],
    });
    expect(r.pass).toBe(false);
  });

  it('fast-forwards the hourglass to its chime', () => {
    const r = simulate(DEFAULT_BEHAVIORS.hourglass);
    expect(r.trace.some((e) => e.kind === 'sound' && e.detail === 'chime')).toBe(true);
  });
});

describe('templates', () => {
  it('maps spoken intents to the closest template', () => {
    expect(closestTemplate('make a dial that sets my focus level').id).toBe('focus-dial');
    expect(closestTemplate('I want a pomodoro timer').id).toBe('pomodoro');
    expect(closestTemplate('count my glasses of water').id).toBe('water');
    expect(closestTemplate('end of day shutdown lever').id).toBe('shutdown');
  });
});
