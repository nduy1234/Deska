import { handleMakeTool } from '../server/makeTool.js';

/** Vercel Function: LLM proxy for "make a tool". Provider/model/key from env. */
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return Response.json({ error: 'method not allowed' }, { status: 405 });
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'invalid json' }, { status: 400 });
    }
    const result = await handleMakeTool(body, process.env, fetch);
    return Response.json(result.json, {
      status: result.status,
      headers: { 'cache-control': 'no-store' },
    });
  },
};
