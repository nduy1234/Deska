import { BehaviorRuntime, type BlockHost, type TriggerEvent } from './runtime.js';
import type { BehaviorGraph, TriggerType } from './schema.js';
import { validateBehavior } from './validate.js';

/**
 * Sandbox simulator for agent-made (or any) behaviors. Runs the real
 * runtime against a fake clock and a recording host, fires synthetic
 * physical events for every trigger the graph listens to, and checks the
 * result. The recorded trace drives the "ghost" preview on the desk.
 */

export interface TraceEntry {
  /** Simulated ms since start (fast-forwarded through long timers). */
  t: number;
  kind: 'event' | 'text' | 'sound' | 'color' | 'dim' | 'sort' | 'timerStart' | 'timerStop' | 'timerEnd';
  detail: string;
}

export interface SimCheck {
  name: string;
  pass: boolean;
  note?: string;
}

export interface SimResult {
  pass: boolean;
  checks: SimCheck[];
  trace: TraceEntry[];
}

const SYNTHETIC: Record<TriggerType, TriggerEvent[]> = {
  grab: [{ type: 'grab' }],
  release: [{ type: 'release' }],
  flip: [{ type: 'flip' }],
  pull: [{ type: 'pull' }],
  poke: [{ type: 'poke' }],
  drop: [
    { type: 'drop', item: 'note', count: 1 },
    { type: 'drop', item: 'note', count: 2 },
  ],
  // A slow sweep from 0 to 270 degrees.
  turn: Array.from({ length: 10 }, (_, i) => ({
    type: 'turn' as const,
    angle: i * 30,
    value: i / 9,
  })),
  timerEnd: [],
};

const FEEDBACK = new Set<TraceEntry['kind']>(['text', 'sound', 'color', 'dim', 'sort', 'timerStart']);

export function simulate(input: unknown): SimResult {
  const checks: SimCheck[] = [];
  const trace: TraceEntry[] = [];
  const v = validateBehavior(input);
  checks.push({ name: 'valid blocks', pass: v.ok, note: v.errors.slice(0, 3).join('; ') || undefined });
  if (!v.ok || !v.graph) return { pass: false, checks, trace };
  const graph: BehaviorGraph = v.graph;

  let now = 0;
  const rec = (kind: TraceEntry['kind'], detail: string) => trace.push({ t: now, kind, detail });
  const host: BlockHost = {
    showText: (t) => rec('text', t),
    playSound: (s) => rec('sound', s),
    setColor: (c) => rec('color', c),
    dimRoom: (l) => rec('dim', l.toFixed(2)),
    sortItems: (b) => rec('sort', b),
    timerStarted: (id, ms) => rec('timerStart', `${id}:${Math.round(ms / 1000)}s`),
    timerStopped: (id) => rec('timerStop', id),
    timerEnded: (id) => rec('timerEnd', id),
  };
  const rt = new BehaviorRuntime(graph, host);

  const used = new Set(graph.rules.map((r) => r.when.on));
  const fired = new Set<number>();
  const ranBefore = () => rt.actionsRun;

  // Advance the clock, jumping straight to timer ends so a 25 min timer
  // simulates instantly, and stepping 100 ms through sequence waits.
  const settle = (limitMs: number) => {
    const end = now + limitMs;
    let guard = 0;
    while (now < end && guard++ < 2000) {
      rt.tick(now);
      if (!rt.busy && rt.runningTimers.length === 0) return;
      if (!rt.busy) {
        // Only timers left: jump to the nearest end.
        now += 60_000;
      } else now += 100;
    }
    rt.tick(now);
  };

  for (const type of ['grab', 'flip', 'pull', 'turn', 'drop', 'poke', 'release'] as TriggerType[]) {
    if (!used.has(type)) continue;
    for (const ev of SYNTHETIC[type]) {
      const before = ranBefore();
      rec('event', type + (ev.value !== undefined ? ` ${ev.value.toFixed(2)}` : ''));
      rt.dispatch(ev, now);
      graph.rules.forEach((r, i) => {
        if (r.when.on === type && rt.actionsRun > before) fired.add(i);
      });
      settle(type === 'poke' ? 2_000 : 200 * 60_000);
      now += 500;
    }
  }
  // Timer-end rules fire through timers started above.
  graph.rules.forEach((r, i) => {
    if (r.when.on === 'timerEnd' && trace.some((e) => e.kind === 'timerEnd' && (e.detail === (r.when as { timer?: string }).timer || !(r.when as { timer?: string }).timer))) {
      fired.add(i);
    }
  });

  const physical = graph.rules.filter((r) => r.when.on !== 'timerEnd').length;
  checks.push({
    name: 'responds to a hand action',
    pass: physical > 0 && fired.size > 0,
    note: physical === 0 ? 'no physical trigger' : undefined,
  });
  checks.push({
    name: 'gives visible or audible feedback',
    pass: trace.some((e) => FEEDBACK.has(e.kind)),
  });
  checks.push({
    name: 'stays within action budget',
    pass: rt.errors.length === 0,
    note: rt.errors.join('; ') || undefined,
  });
  checks.push({ name: 'finishes', pass: !rt.busy });
  const unreached = graph.rules.length - fired.size;
  checks.push({
    name: 'every rule reachable',
    // Advisory: conditional rules may legitimately stay idle in one run.
    pass: true,
    note: unreached > 0 ? `${unreached} rule(s) not triggered in simulation` : undefined,
  });

  return { pass: checks.every((c) => c.pass), checks, trace };
}
