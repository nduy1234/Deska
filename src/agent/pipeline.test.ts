import { describe, expect, it } from 'vitest';
import { handleMakeTool } from '../../server/makeTool.js';
import { extractJson } from '../../server/llm.js';
import { DEFAULT_BEHAVIORS } from '../blocks/templates.js';
import { makeTool, type AgentStage, type RequestFn } from './pipeline.js';

const good = { archetype: 'dial', behavior: DEFAULT_BEHAVIORS.dial };
const broken = { archetype: 'dial', behavior: { version: 1, name: 'x', rules: [{ when: { on: 'wave' }, do: [] }] } };

function scripted(...replies: (unknown | Error)[]): RequestFn & { calls: unknown[] } {
  const calls: unknown[] = [];
  const fn = (async (body: unknown) => {
    calls.push(body);
    const r = replies.shift();
    if (r instanceof Error) throw r;
    return r;
  }) as RequestFn & { calls: unknown[] };
  fn.calls = calls;
  return fn;
}

describe('agent pipeline', () => {
  it('accepts valid model output after simulating it', async () => {
    const stages: AgentStage[] = [];
    const r = await makeTool('focus dial', scripted(good), (s) => stages.push(s));
    expect(r.source).toBe('agent');
    expect(r.archetype).toBe('dial');
    expect(r.sim.pass).toBe(true);
    expect(stages).toEqual(['thinking', 'testing']);
  });

  it('repairs once with the validator errors', async () => {
    const req = scripted(broken, good);
    const r = await makeTool('focus dial', req);
    expect(r.source).toBe('repaired');
    const second = req.calls[1] as { repair: { errors: string[] } };
    expect(second.repair.errors.join()).toMatch(/when\.on/);
  });

  it('falls back to the closest template after a failed repair', async () => {
    const r = await makeTool('a dial for focus', scripted(broken, broken));
    expect(r.source).toBe('template');
    expect(r.archetype).toBe('dial');
    expect(r.reason).toMatch(/twice/);
  });

  it('works offline', async () => {
    const r = await makeTool('pomodoro timer', scripted(new Error('offline')));
    expect(r.source).toBe('template');
    expect(r.archetype).toBe('hourglass');
  });

  it('never accepts graphs that fail simulation', async () => {
    const silent = {
      archetype: 'button',
      behavior: { version: 1, name: 'silent', rules: [{ when: { on: 'timerEnd' }, do: [{ do: 'stopTimer' }] }] },
    };
    const r = await makeTool('water counter', scripted(silent));
    expect(r.source).toBe('template');
    expect(r.reason).toMatch(/simulation failed/);
  });

  it('infers the archetype when the model gives a bogus one', async () => {
    const r = await makeTool('x', scripted({ archetype: 'spaceship', behavior: DEFAULT_BEHAVIORS.hourglass }));
    expect(r.archetype).toBe('hourglass');
  });
});

describe('server', () => {
  it('extracts JSON from fenced replies', () => {
    expect(extractJson('Sure!\n```json\n{"a":{"b":"}"}}\n```')).toEqual({ a: { b: '}' } });
    expect(extractJson('no json')).toBeNull();
  });

  it('reports no_llm without a key so the client uses templates', async () => {
    const r = await handleMakeTool({ intent: 'dial' }, {}, async () => new Response('{}'));
    expect(r.status).toBe(503);
    expect(r.json.error).toBe('no_llm');
  });

  it('calls Llama API natively and returns parsed JSON', async () => {
    let seen: { url: string; body: Record<string, unknown>; auth: string } | null = null;
    const fake = async (url: string, init: RequestInit) => {
      seen = {
        url,
        body: JSON.parse(String(init.body)),
        auth: (init.headers as Record<string, string>).authorization,
      };
      return Response.json({ completion_message: { content: { type: 'text', text: JSON.stringify(good) } } });
    };
    const r = await handleMakeTool({ intent: 'focus dial' }, { LLM_API_KEY: 'k' }, fake);
    expect(r.status).toBe(200);
    expect(r.json.output).toEqual(good);
    expect(seen!.url).toBe('https://api.llama.com/v1/chat/completions');
    expect(seen!.auth).toBe('Bearer k');
    expect(seen!.body.model).toBe('Llama-4-Maverick-17B-128E-Instruct-FP8');
  });

  it('mock provider exercises the repair path', async () => {
    const first = await handleMakeTool({ intent: 'test repair dial' }, { LLM_PROVIDER: 'mock' }, fetch);
    const second = await handleMakeTool(
      { intent: 'test repair dial', repair: { previous: first.json.output, errors: ['x'] } },
      { LLM_PROVIDER: 'mock' },
      fetch,
    );
    const req: RequestFn = async (b) => (b.repair ? second.json.output : first.json.output);
    const r = await makeTool('test repair dial', req);
    expect(r.source).toBe('repaired');
  });

  it('rejects empty intents', async () => {
    expect((await handleMakeTool({ intent: '  ' }, {}, fetch)).status).toBe(400);
  });
});
