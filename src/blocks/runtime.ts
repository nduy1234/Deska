import type {
  Action,
  BehaviorGraph,
  Condition,
  Rule,
  Scalar,
  SequenceStep,
  SoundName,
  TriggerType,
  Value,
} from './schema.js';

/**
 * Block graph interpreter. Pure: time is passed in, effects go through a
 * host interface. The live desk, the agent's sandbox simulator and unit
 * tests all run this same class.
 */

export interface BlockHost {
  showText(text: string, seconds: number): void;
  playSound(sound: SoundName): void;
  setColor(color: string): void;
  dimRoom(level: number): void;
  sortItems(by: string): void;
  timerStarted(timer: string, durationMs: number): void;
  timerStopped(timer: string): void;
  timerEnded(timer: string): void;
}

export interface TriggerEvent {
  type: TriggerType;
  /** turn: 0..1 position. */
  value?: number;
  /** turn: degrees. */
  angle?: number;
  /** drop: items now inside. */
  count?: number;
  item?: string;
  timer?: string;
}

export interface RuntimeSnapshot {
  vars: Record<string, Scalar>;
  /** Remaining ms per running timer. */
  timers: Record<string, number>;
}

interface RunningSequence {
  steps: SequenceStep[];
  index: number;
  waitUntil: number;
  event: TriggerEvent;
}

const DEFAULT_TIMER = 'main';
const ACTION_BUDGET = 64;
const MAX_SEQUENCES = 4;

export class BehaviorRuntime {
  readonly vars: Record<string, Scalar>;
  private timers = new Map<string, { end: number; duration: number }>();
  private sequences: RunningSequence[] = [];
  private lastTurn = new Map<number, number>();
  private budget = ACTION_BUDGET;
  /** Count of actions executed, for the simulator's checks. */
  actionsRun = 0;
  errors: string[] = [];

  constructor(
    readonly graph: BehaviorGraph,
    private host: BlockHost,
    restore?: RuntimeSnapshot,
    now = 0,
  ) {
    this.vars = { ...(graph.vars ?? {}), ...(restore?.vars ?? {}) };
    for (const [id, remaining] of Object.entries(restore?.timers ?? {})) {
      if (remaining > 0) this.timers.set(id, { end: now + remaining, duration: remaining });
    }
  }

  dispatch(ev: TriggerEvent, now: number): void {
    this.budget = ACTION_BUDGET;
    this.graph.rules.forEach((rule, i) => {
      if (!this.matches(rule, i, ev)) return;
      if (rule.if && !this.test(rule.if)) return;
      for (const a of rule.do) this.run(a, ev, now);
    });
  }

  /** Advance timers and sequences. Call every frame (or per sim step). */
  tick(now: number): void {
    for (const [id, t] of Array.from(this.timers)) {
      if (now >= t.end) {
        this.timers.delete(id);
        this.host.timerEnded(id);
        this.dispatch({ type: 'timerEnd', timer: id }, now);
      }
    }
    for (const seq of this.sequences) {
      this.budget = ACTION_BUDGET;
      this.advance(seq, now);
    }
    this.sequences = this.sequences.filter((s) => s.index < s.steps.length);
  }

  private advance(seq: RunningSequence, now: number): void {
    while (seq.index < seq.steps.length && now >= seq.waitUntil) {
      const step = seq.steps[seq.index];
      if (step.wait && seq.waitUntil === -1) {
        seq.waitUntil = now + step.wait * 1000;
        continue;
      }
      if (step.action) this.run(step.action, seq.event, now);
      seq.index += 1;
      seq.waitUntil = -1;
    }
  }

  timerProgress(id: string, now: number): number | null {
    const t = this.timers.get(id);
    if (!t) return null;
    return Math.min(1, Math.max(0, 1 - (t.end - now) / t.duration));
  }

  get runningTimers(): string[] {
    return Array.from(this.timers.keys());
  }

  get busy(): boolean {
    return this.sequences.length > 0;
  }

  snapshot(now: number): RuntimeSnapshot {
    const timers: Record<string, number> = {};
    for (const [id, t] of this.timers) timers[id] = Math.max(0, t.end - now);
    return { vars: { ...this.vars }, timers };
  }

  private matches(rule: Rule, index: number, ev: TriggerEvent): boolean {
    const w = rule.when;
    if (w.on !== ev.type) return false;
    if (w.on === 'drop' && w.item && w.item !== 'any' && w.item !== ev.item) return false;
    if (w.on === 'timerEnd' && (w.timer ?? DEFAULT_TIMER) !== (ev.timer ?? DEFAULT_TIMER)) return false;
    if (w.on === 'turn') {
      const step = w.step ?? 15;
      const angle = ev.angle ?? 0;
      const last = this.lastTurn.get(index);
      if (last !== undefined && Math.abs(angle - last) < step) return false;
      this.lastTurn.set(index, angle);
    }
    return true;
  }

  private test(c: Condition): boolean {
    const a = this.vars[c.var];
    const b = c.value;
    switch (c.op) {
      case 'eq':
        return a === b;
      case 'ne':
        return a !== b;
      case 'lt':
        return Number(a) < Number(b);
      case 'le':
        return Number(a) <= Number(b);
      case 'gt':
        return Number(a) > Number(b);
      case 'ge':
        return Number(a) >= Number(b);
    }
  }

  private resolve(v: Value, ev: TriggerEvent): Scalar {
    if (typeof v === 'object' && v !== null) {
      if ('var' in v) return this.vars[v.var] ?? 0;
      return ev[v.event] ?? 0;
    }
    return v;
  }

  private num(v: Value, ev: TriggerEvent, lo: number, hi: number): number {
    const n = Number(this.resolve(v, ev));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
  }

  /** "{name}" → value, "{name%}" → percent of a 0..1 value. */
  format(text: string): string {
    return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)(%?)\}/g, (_, name: string, pct: string) => {
      const v = this.vars[name];
      if (v === undefined) return '';
      if (typeof v !== 'number') return String(v);
      if (pct) return `${Math.round(v * 100)}%`;
      return Math.abs(v) >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1);
    });
  }

  private run(a: Action, ev: TriggerEvent, now: number): void {
    if (this.budget-- <= 0) {
      if (!this.errors.includes('action budget exceeded')) this.errors.push('action budget exceeded');
      return;
    }
    this.actionsRun += 1;
    switch (a.do) {
      case 'startTimer': {
        const id = a.timer ?? DEFAULT_TIMER;
        const ms = this.num(a.minutes, ev, 0.05, 180) * 60_000;
        this.timers.set(id, { end: now + ms, duration: ms });
        this.host.timerStarted(id, ms);
        break;
      }
      case 'stopTimer': {
        const id = a.timer ?? DEFAULT_TIMER;
        if (this.timers.delete(id)) this.host.timerStopped(id);
        break;
      }
      case 'setValue': {
        if (a.add !== undefined) this.vars[a.var] = Number(this.vars[a.var] ?? 0) + a.add;
        else if (a.value !== undefined) this.vars[a.var] = this.resolve(a.value, ev);
        break;
      }
      case 'showText':
        this.host.showText(this.format(a.text), a.seconds ?? 3);
        break;
      case 'playSound':
        this.host.playSound(a.sound);
        break;
      case 'setColor':
        this.host.setColor(a.color);
        break;
      case 'dimRoom':
        this.host.dimRoom(this.num(a.level, ev, 0, 1));
        break;
      case 'sortItems':
        this.host.sortItems(a.by ?? 'priority');
        break;
      case 'runSequence':
        if (this.sequences.length >= MAX_SEQUENCES) this.sequences.shift();
        const seq: RunningSequence = { steps: a.steps, index: 0, waitUntil: -1, event: ev };
        this.sequences.push(seq);
        this.advance(seq, now);
        break;
    }
  }
}
