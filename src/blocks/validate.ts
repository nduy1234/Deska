import {
  ACTIONS,
  EVENT_FIELDS,
  ITEMS,
  LIMITS,
  OPS,
  SCHEMA_VERSION,
  SORT_KEYS,
  SOUNDS,
  TRIGGERS,
  type BehaviorGraph,
} from './schema.js';

/**
 * Strict validator for behavior graphs. Unknown keys, wrong types and
 * out-of-range numbers are all errors: model output either matches the
 * contract exactly or it is repaired / replaced, never "mostly run".
 */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  graph?: BehaviorGraph;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isScalar = (v: unknown) =>
  typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

class Checker {
  errors: string[] = [];
  vars = new Set<string>();

  err(path: string, msg: string): void {
    if (this.errors.length < 24) this.errors.push(`${path}: ${msg}`);
  }

  keys(o: Obj, path: string, allowed: string[], required: string[] = []): void {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) this.err(path, `unknown key "${k}"`);
    for (const k of required) if (!(k in o)) this.err(path, `missing "${k}"`);
  }

  oneOf<T extends string>(v: unknown, list: readonly T[], path: string): void {
    if (typeof v !== 'string' || !list.includes(v as T)) {
      this.err(path, `must be one of ${list.join('|')}`);
    }
  }

  num(v: unknown, path: string, min: number, max: number): void {
    if (typeof v !== 'number' || !Number.isFinite(v)) this.err(path, 'must be a number');
    else if (v < min || v > max) this.err(path, `must be within ${min}..${max}`);
  }

  str(v: unknown, path: string, max: number): void {
    if (typeof v !== 'string') this.err(path, 'must be a string');
    else if (v.length === 0 || v.length > max) this.err(path, `length must be 1..${max}`);
  }

  varName(v: unknown, path: string, mustExist = true): void {
    if (typeof v !== 'string' || !NAME.test(v)) this.err(path, 'invalid variable name');
    else if (mustExist && !this.vars.has(v)) this.err(path, `variable "${v}" is not declared in vars`);
  }

  value(v: unknown, path: string, numeric?: [number, number]): void {
    if (isObj(v)) {
      if ('var' in v) {
        this.keys(v, path, ['var']);
        this.varName(v.var, `${path}.var`);
      } else if ('event' in v) {
        this.keys(v, path, ['event']);
        this.oneOf(v.event, EVENT_FIELDS, `${path}.event`);
      } else this.err(path, 'object value must be {var} or {event}');
      return;
    }
    if (!isScalar(v)) this.err(path, 'must be a number, string, boolean, {var} or {event}');
    else if (numeric) this.num(v, path, numeric[0], numeric[1]);
  }

  trigger(t: unknown, path: string): void {
    if (!isObj(t)) return this.err(path, 'must be an object');
    this.oneOf(t.on, TRIGGERS, `${path}.on`);
    switch (t.on) {
      case 'turn':
        this.keys(t, path, ['on', 'step']);
        if ('step' in t) this.num(t.step, `${path}.step`, 1, 180);
        break;
      case 'drop':
        this.keys(t, path, ['on', 'item']);
        if ('item' in t) this.oneOf(t.item, ITEMS, `${path}.item`);
        break;
      case 'timerEnd':
        this.keys(t, path, ['on', 'timer']);
        if ('timer' in t) this.varName(t.timer, `${path}.timer`, false);
        break;
      default:
        this.keys(t, path, ['on']);
    }
  }

  condition(c: unknown, path: string): void {
    if (!isObj(c)) return this.err(path, 'must be an object');
    this.keys(c, path, ['var', 'op', 'value'], ['var', 'op', 'value']);
    this.varName(c.var, `${path}.var`);
    this.oneOf(c.op, OPS, `${path}.op`);
    if (!isScalar(c.value)) this.err(`${path}.value`, 'must be a scalar');
  }

  action(a: unknown, path: string, inSequence: boolean): void {
    if (!isObj(a)) return this.err(path, 'must be an object');
    this.oneOf(a.do, ACTIONS, `${path}.do`);
    switch (a.do) {
      case 'startTimer':
        this.keys(a, path, ['do', 'timer', 'minutes'], ['minutes']);
        if ('timer' in a) this.varName(a.timer, `${path}.timer`, false);
        this.value(a.minutes, `${path}.minutes`, [LIMITS.timerMinutesMin, LIMITS.timerMinutesMax]);
        break;
      case 'stopTimer':
        this.keys(a, path, ['do', 'timer']);
        if ('timer' in a) this.varName(a.timer, `${path}.timer`, false);
        break;
      case 'setValue':
        this.keys(a, path, ['do', 'var', 'value', 'add'], ['var']);
        this.varName(a.var, `${path}.var`);
        if ('value' in a === 'add' in a) this.err(path, 'needs exactly one of "value" or "add"');
        if ('value' in a) this.value(a.value, `${path}.value`);
        if ('add' in a) this.num(a.add, `${path}.add`, -1e6, 1e6);
        break;
      case 'showText':
        this.keys(a, path, ['do', 'text', 'seconds'], ['text']);
        this.str(a.text, `${path}.text`, LIMITS.textLength);
        if ('seconds' in a) this.num(a.seconds, `${path}.seconds`, 0.5, LIMITS.textSecondsMax);
        break;
      case 'playSound':
        this.keys(a, path, ['do', 'sound'], ['sound']);
        this.oneOf(a.sound, SOUNDS, `${path}.sound`);
        break;
      case 'setColor':
        this.keys(a, path, ['do', 'color'], ['color']);
        if (typeof a.color !== 'string' || !COLOR.test(a.color)) this.err(`${path}.color`, 'must be #rrggbb');
        break;
      case 'dimRoom':
        this.keys(a, path, ['do', 'level'], ['level']);
        this.value(a.level, `${path}.level`, [0, 1]);
        break;
      case 'sortItems':
        this.keys(a, path, ['do', 'by']);
        if ('by' in a) this.oneOf(a.by, SORT_KEYS, `${path}.by`);
        break;
      case 'runSequence': {
        this.keys(a, path, ['do', 'steps'], ['steps']);
        if (inSequence) this.err(path, 'runSequence cannot be nested');
        const steps = a.steps;
        if (!Array.isArray(steps) || steps.length === 0) {
          this.err(`${path}.steps`, 'must be a non-empty array');
          break;
        }
        if (steps.length > LIMITS.sequenceSteps) this.err(`${path}.steps`, `at most ${LIMITS.sequenceSteps} steps`);
        steps.forEach((s, i) => {
          const sp = `${path}.steps[${i}]`;
          if (!isObj(s)) return this.err(sp, 'must be an object');
          this.keys(s, sp, ['wait', 'action']);
          if (!('wait' in s) && !('action' in s)) this.err(sp, 'needs "wait" or "action"');
          if ('wait' in s) this.num(s.wait, `${sp}.wait`, 0, LIMITS.waitMax);
          if ('action' in s) this.action(s.action, `${sp}.action`, true);
        });
        break;
      }
    }
  }
}

export function validateBehavior(input: unknown): ValidationResult {
  const c = new Checker();
  if (!isObj(input)) return { ok: false, errors: ['root: must be an object'] };
  c.keys(input, 'root', ['version', 'name', 'vars', 'rules'], ['version', 'name', 'rules']);
  if (input.version !== SCHEMA_VERSION) c.err('version', `must be ${SCHEMA_VERSION}`);
  c.str(input.name, 'name', LIMITS.nameLength);

  if ('vars' in input) {
    if (!isObj(input.vars)) c.err('vars', 'must be an object');
    else {
      const entries = Object.entries(input.vars);
      if (entries.length > LIMITS.vars) c.err('vars', `at most ${LIMITS.vars} variables`);
      for (const [k, v] of entries) {
        if (!NAME.test(k)) c.err(`vars.${k}`, 'invalid variable name');
        else if (!isScalar(v)) c.err(`vars.${k}`, 'must be a scalar');
        else c.vars.add(k);
      }
    }
  }

  const rules = input.rules;
  if (!Array.isArray(rules) || rules.length === 0) c.err('rules', 'must be a non-empty array');
  else {
    if (rules.length > LIMITS.rules) c.err('rules', `at most ${LIMITS.rules} rules`);
    rules.forEach((r, i) => {
      const p = `rules[${i}]`;
      if (!isObj(r)) return c.err(p, 'must be an object');
      c.keys(r, p, ['when', 'if', 'do'], ['when', 'do']);
      c.trigger(r.when, `${p}.when`);
      if ('if' in r) c.condition(r.if, `${p}.if`);
      if (!Array.isArray(r.do) || r.do.length === 0) c.err(`${p}.do`, 'must be a non-empty array');
      else {
        if (r.do.length > LIMITS.actionsPerRule) c.err(`${p}.do`, `at most ${LIMITS.actionsPerRule} actions`);
        r.do.forEach((a, j) => c.action(a, `${p}.do[${j}]`, false));
      }
    });
  }

  if (c.errors.length) return { ok: false, errors: c.errors };
  // Deep copy so callers never share structure with untrusted input.
  return { ok: true, errors: [], graph: JSON.parse(JSON.stringify(input)) as BehaviorGraph };
}
