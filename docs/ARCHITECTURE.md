# Deska — Architecture & Milestones

## Shape of the app

```
Quest Browser / IWER emulator
└── IWSDK World (ECS, Three.js, WebXR hands)
    ├── HandSystem        reads IWSDK hand joints + select state → per-hand pinch/poke/palm state
    ├── DeskSystem        builds desk + tray, anchors DeskRoot to seated head pose, palms-up recenter
    ├── ManipulateSystem  1-hand pinch = move, 2-hand pinch = sculpt (stretch / twist), squeeze = waist
    ├── ClaySystem        deform param vector → CPU-deformed geometry (only on change)
    ├── RecognizerSystem  deform params → archetype (hysteresis), glow + spatial label on lock-in
    ├── BehaviorSystem    runs block-graph JSON per tool: triggers → actions, variables
    ├── ToolSensors       turns physical motion into triggers (flip, turn, pull, poke, drop)
    ├── PersistSystem     IndexedDB snapshot on change / visibilitychange / XR end; daily growth
    ├── OnboardingSystem  60 s guided flow (ghost hands + arrows, no text walls)
    └── AgentSystem       mic button → intent → /api/make-tool → validate → simulate → ghost → confirm
Vercel
└── api/make-tool.ts      LLM proxy (provider/model via env, default Llama API), returns JSON only
```

Pure-TS modules (no IWSDK imports, unit-tested in Node with Vitest):
`src/sculpt/deform.ts`, `src/sculpt/recognizer.ts`, `src/blocks/*` (schema, validator,
runtime, simulator, templates), `src/persist/model.ts`, `src/agent/repair.ts`.

## Key decisions

| Decision | Why |
|---|---|
| Custom pinch manipulation instead of `TwoHandsGrabbable` | Sculpting needs per-axis stretch, twist, and waist squeeze; built-in grab only does uniform scale and would fight the gestures. We still use IWSDK's hand joints, pinch select state and hand visuals. `grabbing` feature off. |
| Desk built in code, scene JSON for environment only | Desk contents are dynamic and persisted; one `DeskRoot` entity anchored to the seated head pose keeps every tool within ~0.6 m reach. |
| Parametric deform (`{sx,sy,sz,waist,twist,taper}`) | Deterministic, serialisable, recognisable. No freeform mesh editing. |
| Procedural WebAudio sounds | No audio downloads → fast cold start; every hand action gets a sound. |
| Block graphs are data, never code | LLM output is validated JSON; runtime interprets a closed set of blocks. |
| Server proxy picks provider by env | `LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY`; default Llama API. Key never reaches client. |
| Offline-first | Starter tools, sculpting, recognizer, persistence and intent-card templates all work with no network. |

## Milestones (each = small commits, verified in IWER)

1. **M1 Desk + tray** — room, desk at seated height, tray (cube/cylinder/sphere), pinch-pull a primitive onto the desk, move it, recenter gesture, sounds.
2. **M2 Sculpting** — two-hand stretch per axis, squeeze waist, twist, clay geometry deform.
3. **M3 Recognizer** — archetype lock-in, glow + label.
4. **M4 Block library** — schema, validator, runtime, default behaviors, `docs/blocks.md`, unit tests.
5. **M5 Starter tools** — hourglass timer, jar + sticky notes sort, lever routine, dial focus/dim/ambient; one-handed mode.
6. **M6 Persistence** — IndexedDB, pause/resume, streak, daily "desk grows".
7. **M7 Agent** — mic/intent cards, Vercel function, validate → simulate → ghost preview → pinch-confirm, repair + template fallback.
8. **M8 Onboarding + polish** — 60 s flow, perf pass on Quest, a11y check.
9. **M9 Ship** — README, Vercel deploy, demo script, tagline, description.
10. **Stretch** — passthrough MR mode on real table.
