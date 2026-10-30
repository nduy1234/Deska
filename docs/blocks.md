# Deska block schema (v1)

Every tool on the desk runs a **behavior graph**: JSON made of typed blocks.
Rules map a physical trigger (what your hand does to the object) to a list of
actions. Graphs are data only. The runtime (`src/blocks/runtime.ts`) interprets
a closed set of blocks, so nothing is ever executed as code. That includes graphs
written by the AI agent.

- Types: `src/blocks/schema.ts` (`BLOCK_SPEC` is the exact contract sent to the LLM)
- Validator: `src/blocks/validate.ts`
- Runtime: `src/blocks/runtime.ts`
- Sandbox simulator: `src/blocks/simulate.ts`
- Defaults and intent templates: `src/blocks/templates.ts`

## Shape

```json
{
  "version": 1,
  "name": "Focus dial",
  "vars": { "focus": 0.3 },
  "rules": [
    {
      "when": { "on": "turn", "step": 6 },
      "if":   { "var": "focus", "op": "lt", "value": 1 },
      "do": [
        { "do": "setValue", "var": "focus", "value": { "event": "value" } },
        { "do": "dimRoom", "level": { "var": "focus" } },
        { "do": "showText", "text": "Focus {focus%}" }
      ]
    }
  ]
}
```

| Field | Rule |
|---|---|
| `version` | must be `1` |
| `name` | 1–40 chars |
| `vars` | up to 16 variables; names `[A-Za-z_][A-Za-z0-9_]{0,23}`; values number/string/boolean |
| `rules` | 1–16 rules, each with 1–12 actions |
| `if` (optional) | `{var, op, value}`; `op` is `eq ne lt le gt ge` |

**Values.** Anywhere a `Value` is accepted, you can use a literal, `{"var": name}`,
or `{"event": "value" | "angle" | "count"}`, which reads a field of the event
that fired the rule.

## Triggers (`when.on`)

| Trigger | Fired when | Event fields |
|---|---|---|
| `grab` | a hand pinches the tool | |
| `release` | the hand lets go | |
| `flip` | the tool comes to rest upside down (or upright again) | |
| `turn` | the tool is rotated about its vertical axis; `step` (1–180°, default 15) throttles it | `value` 0..1, `angle` in degrees |
| `pull` | the tool is pulled toward you and released (a lever throw) | |
| `poke` | a fingertip pokes it, or a quick pinch-tap | |
| `drop` | an item is dropped onto or into it; `item`: `note` or `any` | `count` items inside |
| `timerEnd` | a timer it started ends; `timer` id (default `main`) | |

## Actions (`do`)

| Action | Fields | Effect |
|---|---|---|
| `startTimer` | `timer?` id, `minutes` Value (0.05–180) | starts or restarts a timer; the tool shows its progress |
| `stopTimer` | `timer?` | stops it |
| `setValue` | `var`, exactly one of `value` (Value) or `add` (number) | updates a declared variable |
| `showText` | `text` (≤64, `{var}` / `{var%}` placeholders), `seconds?` (0.5–30) | small spatial label above the tool |
| `playSound` | `sound`: `chime tap lock sparkle whoosh detent place` | soft procedural sound |
| `setColor` | `color` `#rrggbb` | tints the tool |
| `dimRoom` | `level` Value 0 (bright) – 1 (dim) | dims the room light and lowers or warms the ambient sound |
| `sortItems` | `by?`: `priority color age` | sorts the items inside (for example, notes in the jar) |
| `runSequence` | `steps`: up to 12 `{wait?: seconds ≤30, action?: Action}` | runs steps in order with pauses; cannot be nested |

## Safety rules

- Strict validation. Unknown keys, unknown triggers or actions, undeclared
  variables, and out-of-range numbers are all errors. Agent output is repaired
  once, then replaced by the closest template. It never runs half-valid.
- Each dispatch has a budget of 64 actions. At most 4 sequences run at once.
- The simulator fires synthetic events for every trigger used and fast-forwards
  through timers. Before a tool is offered, it checks that the tool responds to a
  hand action, gives feedback, stays within budget, and finishes.

## Starter behaviors

| Archetype | Behavior |
|---|---|
| hourglass | `flip`: 25 min `focus` timer · `poke`: pause · `timerEnd`: chime + session count |
| jar | `drop note`: count · `poke`: sort by priority color |
| lever | `pull`: morning routine sequence → 5 min warm-up timer |
| dial | `turn`: focus level → dim room + ambient |
| button | `poke`: tally |
| block | `grab`: tap |
