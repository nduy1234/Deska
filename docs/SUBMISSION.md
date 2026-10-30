# Submission text drafts

## Tagline (≤ 140 characters)

> Pinch clay into tools that work: squeeze a cube into an hourglass and it's your focus timer. A hands-only VR desk that grows every day.

Alternates:
- Sculpt your productivity tools by hand. Squeeze clay, flip it, and it works. Ask Deska, and its agent builds and tests one for you.
- A VR desk where shapes become tools: hourglass timers, focus dials, sorting jars. Hands only. Grows every day you return.

## Description (< 500 words)

**Inspiration**

Productivity apps in VR usually bring along their flat 2D panels. We
wanted a desk you use the way you use clay: with your hands, without menus.
We kept asking one question: what if the shape of an object *was* its function?
A squeezed waist reads as an hourglass, so it should be a timer. A tall stick
reads as a lever, so pulling it should run something. Deska grew out of that idea.

**What it does**

You sit at a warm, softly lit desk within a two-foot reach. You pinch a cube from
the clay tray and pull it onto the desk. Stretch it with two hands, wring it to
twist it, or close your hand around it to squeeze its waist. When the shape
reads as a tool, it locks in with a glow, a label and a chime, and then it works.
Flip the hourglass for a 25-minute focus session. Turn the dial and the room dims
while the ambient sound settles. Drop color-coded sticky notes into the jar and tap
to sort them. Pull the lever to run your morning routine.

Poke the orb and say what you need, like "a dial that sets my focus level". Deska's
agent writes the behavior from a small library of typed blocks. The client
validates it and runs it in a sandbox with simulated hand events. A translucent
ghost of the tool then plays that test on your desk with a pass/fail check, and
you pinch the ghost to keep it. The agent never runs code. If the model's output
is invalid, Deska repairs it once and otherwise falls back to the closest recipe.
Without a network, everything still works, and the orb offers intent cards instead.

The desk persists. A little plant grows a leaf for every day in a row, and each new
day leaves a gift box that unlocks a new clay shape or upgrades a tool. Your
hourglass learns to schedule breaks, and your dial learns to warm the room.

**How we built it**

Deska is built on Meta's Immersive Web SDK in TypeScript and runs in Quest Browser
with hand tracking. Sculpting is parametric: a primitive plus a deform vector
(stretch, waist, twist, taper), which a recognizer maps to archetypes. Behaviors
are JSON block graphs with a strict validator and a pure interpreter. The live desk,
the agent's sandbox and our unit tests all run the same code. One Vercel
function proxies the LLM (Llama API by default) so no key reaches the client.
Everything is procedural: there are no downloaded models or audio files, every
sound is synthesized, and the scene stays around 45 draw calls. The desk loads
in about a second and saves to IndexedDB whenever you pause.

**What's next**

Mixed reality mode that places the desk on your real table; sharing tools as
block JSON so friends can trade them; calendar and task integrations as new
trigger blocks; and multiplayer desks for body-doubling focus sessions.

---
Word count (description body, headings excluded): 487 of 500. Tagline: 135 of 140 characters.
