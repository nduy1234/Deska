/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Serves /api/make-tool during development with the same handler the
 * Vercel Function uses, reading LLM_* vars from .env.local.
 */
function devApi(): Plugin {
  return {
    name: 'deska-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/make-tool', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let raw = '';
        for await (const chunk of req) raw += chunk;
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(raw);
        } catch {
          /* handled as missing intent */
        }
        const { handleMakeTool } = await server.ssrLoadModule('/server/makeTool.ts');
        const env = loadEnv(server.config.mode, process.cwd(), '');
        const result = await handleMakeTool(body, env, fetch);
        res.statusCode = result.status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(result.json));
      });
    },
  };
}

export default defineConfig({
  plugins: [iwsdkDev(), devApi()],
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
