import type { BehaviorGraph } from '../blocks/schema.js';
import { simulate, type SimResult } from '../blocks/simulate.js';
import { closestTemplate } from '../blocks/templates.js';
import { validateBehavior } from '../blocks/validate.js';
import { ARCHETYPES, type Archetype } from '../sculpt/recognizer.js';

/**
 * Agent pipeline: intent → model JSON → validate → (repair once) → simulate
 * → result, with the closest offline template as the safety net at every
 * step. Pure apart from the injected request function, so it is tested
 * without a network.
 */

export type AgentStage = 'thinking' | 'repairing' | 'testing' | 'fallback';

export interface AgentRequest {
  intent: string;
  repair?: { previous: unknown; errors: string[] };
}

/** Resolves to the server's `output`, or throws on network / server failure. */
export type RequestFn = (body: AgentRequest) => Promise<unknown>;

export interface AgentResult {
  archetype: Archetype;
  behavior: BehaviorGraph;
  source: 'agent' | 'repaired' | 'template';
  /** Why a template was used, if it was. */
  reason?: string;
  sim: SimResult;
}

/** Pick an archetype for a graph whose model-supplied one is missing or bogus. */
export function inferArchetype(g: BehaviorGraph): Archetype {
  const on = new Set(g.rules.map((r) => r.when.on));
  if (on.has('turn')) return 'dial';
  if (on.has('flip')) return 'hourglass';
  if (on.has('pull')) return 'lever';
  if (on.has('drop')) return 'jar';
  if (on.has('poke')) return 'button';
  return 'block';
}

function unpack(output: unknown): { archetype: unknown; behavior: unknown } {
  if (output && typeof output === 'object' && 'behavior' in output) {
    const o = output as { archetype?: unknown; behavior?: unknown };
    return { archetype: o.archetype, behavior: o.behavior };
  }
  // Some models return the bare graph.
  return { archetype: undefined, behavior: output };
}

function pickArchetype(claimed: unknown, g: BehaviorGraph): Archetype {
  const inferred = inferArchetype(g);
  if (typeof claimed === 'string' && (ARCHETYPES as readonly string[]).includes(claimed)) {
    // Trust the model unless its shape can't fire the graph's main trigger.
    const a = claimed as Archetype;
    return inferred !== 'block' && a !== inferred && (a === 'block' || a === 'button') ? inferred : a;
  }
  return inferred;
}

function template(intent: string, reason: string): AgentResult {
  const t = closestTemplate(intent);
  return { archetype: t.archetype, behavior: t.behavior, source: 'template', reason, sim: simulate(t.behavior) };
}

export async function makeTool(
  intent: string,
  request: RequestFn,
  onStage: (s: AgentStage) => void = () => {},
): Promise<AgentResult> {
  onStage('thinking');
  let output: unknown;
  try {
    output = await request({ intent });
  } catch (err) {
    onStage('fallback');
    return template(intent, err instanceof Error && err.message === 'no_llm' ? 'no model configured' : 'offline');
  }

  let { archetype, behavior } = unpack(output);
  let v = validateBehavior(behavior);
  let source: AgentResult['source'] = 'agent';

  if (!v.ok) {
    onStage('repairing');
    try {
      const repaired = await request({ intent, repair: { previous: output, errors: v.errors } });
      ({ archetype, behavior } = unpack(repaired));
      v = validateBehavior(behavior);
      source = 'repaired';
    } catch {
      /* fall through to template */
    }
    if (!v.ok) {
      onStage('fallback');
      return template(intent, 'model output failed validation twice');
    }
  }

  onStage('testing');
  const graph = v.graph!;
  const sim = simulate(graph);
  if (!sim.pass) {
    onStage('fallback');
    const failed = sim.checks.filter((c) => !c.pass).map((c) => c.name).join(', ');
    return template(intent, `simulation failed: ${failed}`);
  }
  return { archetype: pickArchetype(archetype, graph), behavior: graph, source, sim };
}

/** Browser request function for /api/make-tool with a timeout. */
export function httpRequest(url = '/api/make-tool', timeoutMs = 20_000): RequestFn {
  return async (body) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const j = (await res.json().catch(() => ({}))) as { output?: unknown; error?: string };
      if (!res.ok) throw new Error(j.error ?? `http ${res.status}`);
      return j.output;
    } finally {
      clearTimeout(timer);
    }
  };
}
