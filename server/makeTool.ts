import { BLOCK_SPEC } from '../src/blocks/schema.js';
import { closestTemplate } from '../src/blocks/templates.js';
import {
  chat,
  extractJson,
  LlmUnavailable,
  providerOf,
  type ChatMessage,
  type FetchLike,
  type LlmEnv,
} from './llm.js';

/**
 * POST /api/make-tool
 *   { intent: string, repair?: { previous: unknown, errors: string[] } }
 * → 200 { output: unknown }       model JSON (unvalidated; the client validates)
 * → 503 { error: 'no_llm' }       no provider configured: client uses templates
 * → 4xx/5xx { error }
 *
 * The server only ever returns data. Nothing the model writes is executed
 * here or on the client; the client accepts block JSON that passes the
 * strict validator and the sandbox simulator.
 */

export const SYSTEM_PROMPT = `You are Deska's tool smith. A person at a VR desk asks for a small productivity tool.
Turn their intent into a physical desk tool built ONLY from Deska blocks.

Reply with ONLY one JSON object, no prose, no code fences:
{"archetype": "hourglass"|"lever"|"jar"|"dial"|"button"|"block", "behavior": <behavior graph>}

Archetype = how the hand uses it:
- dial: turned like a knob ("turn" trigger, event.value 0..1)
- hourglass: flipped over to start/stop timers ("flip")
- lever: pulled to run a routine ("pull", often runSequence)
- jar: sticky notes dropped in ("drop"), poked to sort ("poke")
- button: poked to count or toggle ("poke")

${BLOCK_SPEC}

Rules:
- Use only the triggers, actions and fields listed. Never invent keys.
- Declare every variable you read or write in "vars" with a starting value.
- Every physical trigger should give feedback (playSound and/or showText).
- Keep it small: at most 6 rules. Texts at most 64 characters.

Example for "a dial that sets my focus level":
{"archetype":"dial","behavior":{"version":1,"name":"Focus dial","vars":{"focus":0.3},"rules":[{"when":{"on":"turn","step":6},"do":[{"do":"setValue","var":"focus","value":{"event":"value"}},{"do":"dimRoom","level":{"var":"focus"}},{"do":"playSound","sound":"detent"},{"do":"showText","text":"Focus {focus%}","seconds":1.5}]}]}}`;

export interface MakeToolBody {
  intent?: unknown;
  repair?: { previous?: unknown; errors?: unknown };
}

export interface MakeToolResult {
  status: number;
  json: Record<string, unknown>;
}

const MAX_INTENT = 200;

export async function handleMakeTool(
  body: MakeToolBody,
  env: LlmEnv,
  fetchImpl: FetchLike,
): Promise<MakeToolResult> {
  const intent = typeof body.intent === 'string' ? body.intent.trim().slice(0, MAX_INTENT) : '';
  if (!intent) return { status: 400, json: { error: 'missing intent' } };

  if (providerOf(env) === 'mock') return { status: 200, json: { output: mockReply(intent, !!body.repair) } };

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Intent: ${intent}` },
  ];
  if (body.repair) {
    const errors = Array.isArray(body.repair.errors)
      ? body.repair.errors.filter((e): e is string => typeof e === 'string').slice(0, 10)
      : [];
    messages.push(
      { role: 'assistant', content: JSON.stringify(body.repair.previous ?? null).slice(0, 6000) },
      {
        role: 'user',
        content: `That JSON failed validation:\n- ${errors.join('\n- ')}\nReturn the corrected JSON object only.`,
      },
    );
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const text = await chat(env, messages, fetchImpl, ctrl.signal);
    return { status: 200, json: { output: extractJson(text) } };
  } catch (err) {
    if (err instanceof LlmUnavailable) return { status: 503, json: { error: 'no_llm' } };
    return { status: 502, json: { error: 'llm_failed' } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deterministic stand-in for demos and emulator tests (LLM_PROVIDER=mock).
 * "test repair" in the intent returns broken JSON first to exercise repair.
 */
function mockReply(intent: string, repairing: boolean): unknown {
  const t = closestTemplate(intent);
  if (/test repair/i.test(intent) && !repairing) {
    return { archetype: t.archetype, behavior: { ...t.behavior, rules: [{ when: { on: 'wave' }, do: [] }] } };
  }
  return { archetype: t.archetype, behavior: { ...t.behavior, name: `${t.behavior.name} (agent)`.slice(0, 40) } };
}
