/**
 * Provider-agnostic chat call. The provider and model come from env vars;
 * the key never leaves the server.
 *
 *   LLM_PROVIDER  llama (default) | openai | anthropic | mock
 *   LLM_MODEL     model id (provider default if unset)
 *   LLM_API_KEY   provider key (LLAMA_API_KEY also accepted for llama)
 *   LLM_BASE_URL  override for openai-compatible hosts (e.g. https://api.llama.com/compat/v1)
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmEnv {
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
  LLM_API_KEY?: string;
  LLAMA_API_KEY?: string;
  LLM_BASE_URL?: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const DEFAULT_MODELS: Record<string, string> = {
  llama: 'Llama-4-Maverick-17B-128E-Instruct-FP8',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-5-5',
};

export class LlmUnavailable extends Error {}

export function providerOf(env: LlmEnv): string {
  return (env.LLM_PROVIDER || 'llama').toLowerCase();
}

export async function chat(
  env: LlmEnv,
  messages: ChatMessage[],
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<string> {
  const provider = providerOf(env);
  const key = env.LLM_API_KEY || (provider === 'llama' ? env.LLAMA_API_KEY : undefined);
  if (provider === 'mock') throw new LlmUnavailable('mock handled by caller');
  if (!key) throw new LlmUnavailable(`no API key for provider "${provider}"`);
  const model = env.LLM_MODEL || DEFAULT_MODELS[provider];
  if (!model) throw new LlmUnavailable(`unknown provider "${provider}"`);

  if (provider === 'llama') {
    const res = await fetchImpl('https://api.llama.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, max_completion_tokens: 1200, temperature: 0.2 }),
      signal,
    });
    if (!res.ok) throw new Error(`llama ${res.status}`);
    const j = (await res.json()) as { completion_message?: { content?: { text?: string } | string } };
    const c = j.completion_message?.content;
    return typeof c === 'string' ? c : (c?.text ?? '');
  }

  if (provider === 'openai') {
    const base = (env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, max_tokens: 1200, temperature: 0.2 }),
      signal,
    });
    if (!res.ok) throw new Error(`openai ${res.status}`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? '';
  }

  if (provider === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, system, messages: rest, max_tokens: 1200, temperature: 0.2 }),
      signal,
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const j = (await res.json()) as { content?: { type: string; text?: string }[] };
    return j.content?.find((c) => c.type === 'text')?.text ?? '';
  }

  throw new LlmUnavailable(`unknown provider "${provider}"`);
}

/** First balanced top-level JSON object in a model reply (handles ```json fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
