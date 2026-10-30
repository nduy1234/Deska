/**
 * Deska block schema. A tool's behavior is a JSON graph of typed blocks:
 * rules that map a physical trigger to a list of actions, plus variables.
 * The runtime interprets this closed vocabulary; nothing here is ever
 * executed as code, which is what makes model-generated behaviors safe.
 *
 * Documented for humans in docs/blocks.md and sent verbatim (BLOCK_SPEC)
 * to the LLM so both read the same contract.
 */

export const SCHEMA_VERSION = 1;

export const TRIGGERS = [
  'grab',
  'release',
  'flip',
  'turn',
  'pull',
  'poke',
  'drop',
  'timerEnd',
] as const;
export type TriggerType = (typeof TRIGGERS)[number];

export const ACTIONS = [
  'startTimer',
  'stopTimer',
  'setValue',
  'showText',
  'playSound',
  'setColor',
  'dimRoom',
  'sortItems',
  'runSequence',
] as const;
export type ActionType = (typeof ACTIONS)[number];

export const SOUNDS = ['chime', 'tap', 'lock', 'sparkle', 'whoosh', 'detent', 'place'] as const;
export type SoundName = (typeof SOUNDS)[number];

export const ITEMS = ['note', 'any'] as const;
export const EVENT_FIELDS = ['value', 'angle', 'count'] as const;
export const SORT_KEYS = ['priority', 'color', 'age'] as const;
export const OPS = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const;

export type Scalar = number | string | boolean;
/** A literal, a variable read, or a field of the triggering event. */
export type Value = Scalar | { var: string } | { event: (typeof EVENT_FIELDS)[number] };

export type Trigger =
  | { on: 'grab' | 'release' | 'flip' | 'pull' | 'poke' }
  /** `step`: emit every N degrees of rotation (default 15). */
  | { on: 'turn'; step?: number }
  | { on: 'drop'; item?: (typeof ITEMS)[number] }
  | { on: 'timerEnd'; timer?: string };

export interface Condition {
  var: string;
  op: (typeof OPS)[number];
  value: Scalar;
}

export type Action =
  | { do: 'startTimer'; timer?: string; minutes: Value }
  | { do: 'stopTimer'; timer?: string }
  | { do: 'setValue'; var: string; value?: Value; add?: number }
  | { do: 'showText'; text: string; seconds?: number }
  | { do: 'playSound'; sound: SoundName }
  | { do: 'setColor'; color: string }
  /** level 0 = bright room, 1 = dimmest. Also lowers ambient sound. */
  | { do: 'dimRoom'; level: Value }
  | { do: 'sortItems'; by?: (typeof SORT_KEYS)[number] }
  /** Steps run in order; `wait` seconds pause before the step's action. */
  | { do: 'runSequence'; steps: SequenceStep[] };

export interface SequenceStep {
  wait?: number;
  action?: Exclude<Action, { do: 'runSequence' }>;
}

export interface Rule {
  when: Trigger;
  if?: Condition;
  do: Action[];
}

export interface BehaviorGraph {
  version: typeof SCHEMA_VERSION;
  name: string;
  vars?: Record<string, Scalar>;
  rules: Rule[];
}

export const LIMITS = {
  rules: 16,
  actionsPerRule: 12,
  sequenceSteps: 12,
  vars: 16,
  nameLength: 40,
  textLength: 64,
  timerMinutesMin: 0.05,
  timerMinutesMax: 180,
  waitMax: 30,
  textSecondsMax: 30,
} as const;

/** Compact contract given to the LLM (and mirrored in docs/blocks.md). */
export const BLOCK_SPEC = `Behavior graph JSON (version 1):
{ "version": 1, "name": string(<=40), "vars": { name: number|string|boolean } (<=16),
  "rules": [ { "when": Trigger, "if"?: Condition, "do": [Action] (<=12) } ] (<=16) }
Trigger (what the user physically does to the object):
  {"on":"grab"} {"on":"release"} {"on":"flip"} {"on":"pull"} {"on":"poke"}
  {"on":"turn","step"?:degrees}  event.value = 0..1 turn position, event.angle = degrees
  {"on":"drop","item"?:"note"|"any"}  event.count = items inside
  {"on":"timerEnd","timer"?:id}
Condition: {"var":name,"op":"eq"|"ne"|"lt"|"le"|"gt"|"ge","value":scalar}
Value: literal | {"var":name} | {"event":"value"|"angle"|"count"}
Action:
  {"do":"startTimer","timer"?:id,"minutes":Value(0.05..180)}  {"do":"stopTimer","timer"?:id}
  {"do":"setValue","var":name,"value"?:Value,"add"?:number}
  {"do":"showText","text":string(<=64, may use {varName}),"seconds"?:number}
  {"do":"playSound","sound":"chime"|"tap"|"lock"|"sparkle"|"whoosh"|"detent"|"place"}
  {"do":"setColor","color":"#rrggbb"}
  {"do":"dimRoom","level":Value(0 bright..1 dim)}
  {"do":"sortItems","by"?:"priority"|"color"|"age"}
  {"do":"runSequence","steps":[{"wait"?:seconds(<=30),"action"?:Action(not runSequence)}](<=12)}`;
