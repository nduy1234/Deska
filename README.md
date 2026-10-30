# Deska

**Pinch clay into tools that work.** Deska is a seated, hands-only VR workbench.
Squeeze a cube into an hourglass and it becomes your focus timer. Turn a dial to
dim the room. Ask Deska for a tool, and an agent builds one from safe blocks,
tests it, and hands it to you. The desk remembers everything and grows a little
every day.

Built with the [Immersive Web SDK](https://iwsdk.dev) for Quest Browser.
Entry for the Meta VR Start Developer Competition 2026 (Productivity, New Experience).

- No controllers, ever: pinch, squeeze, flip, turn, pull and poke with your hands.
- Seated, everything within a two-foot reach. Hold both palms up for a second to recenter the desk.
- Works with no AI and no network. The agent only speeds things up.

## What's on the desk

| Thing | How you use it |
|---|---|
| Clay tray | Pinch a cube, cylinder or sphere and pull it onto the desk. Drop clay back on the tray to remove it. |
| Sculpting | Two-hand pinch and pull apart to stretch. Wring both wrists to twist. Close a hand around clay to squeeze its waist. |
| Hourglass | Squeezed clay locks in as an hourglass. Flip it to start a 25-minute focus timer; it chimes at the end. Poke it to pause. |
| Jar | Pinch notes off the pad (red, amber, green) and drop them in. Pinch-tap the jar to sort by priority. |
| Lever | Pinch the top and pull it toward you to run the morning routine. |
| Dial | Pinch and turn your wrist like a knob to set your focus level. The room dims and the ambient sound settles. |
| Orb | Poke it and say what you want ("make a dial that sets my focus level"). Without speech, pick an intent card. A ghost of the tool runs its own test; pinch the ghost to keep it. |
| Plant and gifts | The plant grows a leaf for every day in a row. Each new day leaves a gift box that unlocks a new clay shape or a tool upgrade. |

## Quick start

Requirements: Node 20.19+ / 22.12+ / 24+, npm.

```bash
npm install
cp .env.example .env.local   # optional: only needed for the AI agent
npm run dev
```

`npm run dev` starts the IWSDK dev server (https://localhost:8081) and opens a
managed Chromium window running **IWER**, IWSDK's WebXR emulator. Click
**Enter Deska**, then switch the emulator to hand input. IWER controls are
documented at https://iwsdk.dev/guides/02-testing-experience.html#iwer-controls.

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server + emulator window |
| `npm run typecheck` | TypeScript check (run before testing; type errors can stop systems silently) |
| `npm test` | Unit tests: deform, recognizer, blocks, simulator, persistence, agent pipeline, server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build |

### URL switches (for testing)

| Switch | Effect |
|---|---|
| `?reset` | Clear the saved desk and start fresh, as a first-time visitor |
| `?day=N` | Pretend it is N days later (streak, plant and daily gift) |
| `?onboard` | Replay the guided first-five-minutes flow |
| `?onehand=1` | One-handed mode: a single pinch stretches and twists clay against the desk |

## Environment variables (AI agent)

The agent calls one serverless function, `api/make-tool.ts`. The provider is
chosen by environment variable, and the key never reaches the browser.

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `llama` | `llama` (Llama API, native), `openai` (any OpenAI-compatible host), `anthropic`, or `mock` (deterministic, no key) |
| `LLM_MODEL` | provider default | `Llama-4-Maverick-17B-128E-Instruct-FP8` for llama |
| `LLM_API_KEY` | none | Provider key. `LLAMA_API_KEY` also works for llama. |
| `LLM_BASE_URL` | none | For `openai` hosts, e.g. `https://api.llama.com/compat/v1` |

Never prefix these with `VITE_`; that would ship them to the client. With no
key, the function returns `503 no_llm` and the desk uses its built-in recipes
instead. Locally, put the variables in `.env.local` (git-ignored); the dev
server serves the same handler at `/api/make-tool`.

## Deploy to Vercel

The repo includes `vercel.json` (Vite preset, `dist/` output, long-cache assets,
and a microphone permission for speech).

**Dashboard**
1. Import the GitHub repo at https://vercel.com/new. The settings come from `vercel.json`.
2. Under *Settings → Environment Variables*, add `LLM_API_KEY` (plus `LLM_PROVIDER` / `LLM_MODEL` if you change them).
3. Deploy. The site is static `dist/`, and `api/make-tool.ts` becomes a Node function.

**CLI**
```bash
npm i -g vercel
vercel link
vercel env add LLM_API_KEY production
vercel --prod
```

Check the deployment:
```bash
curl -X POST https://<your-app>.vercel.app/api/make-tool -H 'content-type: application/json' -d '{"intent":"a dial that sets my focus level"}'
```

## Test on Quest

**Deployed build:** open the Vercel URL in Meta Quest Browser and tap **Enter Deska**.
Put the controllers down; hand tracking takes over.

**Local dev build:** with the Quest on the same Wi-Fi as your computer:
```bash
npx @iwsdk/cli dev status
```
Open one of the `runtimeUrls.network` addresses (e.g. `https://192.168.x.x:8081`)
in Quest Browser and accept the local certificate warning. Over USB, the
`iwsdk-native-xr-test` skill and `@meta-quest/metavr` can drive the headset.

**Quest checklist**
- Desk appears in front of you at seated height within ~5 s.
- Palms up for a second recenters the desk.
- Pinch-pull a cube, squeeze it, flip it, and the timer starts with a ring and a countdown.
- Take the headset off and put it back on (or exit and re-enter): the desk and running timers are still there.
- Airplane mode: everything still works; the orb offers intent cards and uses built-in recipes.

## Emulator test scripts

`scripts/emu.sh` drives IWER from the shell. Start the dev server with
`npx @iwsdk/cli dev up --allow-browser-automation` first.

```bash
source scripts/emu.sh
emu_enter                      # enter XR with hands
emu_pull cube 0 1.3 -0.3       # pinch a tray cube and place it on the desk
emu_eval '__deska.deskState.snapshot.streak'
```

`window.__deska` exists only in dev builds.

## How it's built

- **IWSDK ECS.** Systems run in this order: hands → desk → manipulation → tools → agent → growth → onboarding → persistence.
  See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Sculpting is parametric.** Each clay object is a primitive plus a deform vector
  (`sx, sy, sz, waist, twist, taper`). The recognizer maps that vector to an archetype.
- **Behaviors are JSON block graphs** with a strict validator and an interpreter. See [docs/blocks.md](docs/blocks.md).
- **The agent never runs model code.** Model output must pass the validator and the
  sandbox simulator. Otherwise it is repaired once, then replaced by the closest template.
- **Persistence:** IndexedDB with a localStorage fallback. The desk saves after
  changes, when the page is hidden, and when the XR session ends.
- **Cheap to render:** procedural geometry, WebAudio-synthesized sounds, no downloaded
  models or audio. About 45 draw calls, and 72 Hz with foveation on Quest.

## Project layout

```
api/make-tool.ts        Vercel Function (LLM proxy)
server/                 provider-agnostic LLM call + make-tool handler
src/core/               hands, desk, clay, manipulation, notes, events, components
src/sculpt/             deform math + archetype recognizer (pure, tested)
src/blocks/             block schema, validator, runtime, simulator, templates (pure, tested)
src/tools/              ToolSystem: sensors, runtime host, labels, timer ring, jar
src/agent/              agent pipeline (tested) + orb / cards / ghost preview
src/persist/            snapshot model (tested), IndexedDB, growth (plant + gifts)
src/onboarding/         first-five-minutes flow
src/feedback/           sounds, labels, room mood
docs/                   architecture, block schema, demo script, submission text
```

## Accessibility

Every starter tool works with one hand (see the table in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).
Pinch targets have about 3.5 cm of slop around each object, and they glow as your fingers close.
Every hand action has a sound and a visual response, because hand tracking has no haptics.

## Privacy

The desk lives in your browser's storage. The only data that leaves the device is
the intent text you send when you ask the orb for a tool, and only when an LLM is configured.

## License

MIT. See [LICENSE](LICENSE).
