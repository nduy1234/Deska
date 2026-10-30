// Evaluate DESKA_EVAL (an expression string) in the running app page and print JSON.
// Usage: DESKA_EVAL='__deska.hands.right.curl' npx @iwsdk/cli browser run scripts/eval.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function run({ page, frame, workspaceRoot }) {
  const expr = readFileSync(join(workspaceRoot, 'scripts', '.eval.txt'), 'utf8');
  const target = frame ?? page;
  const result = await target.evaluate(
    (src) => {
      const v = (0, eval)(src);
      return JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x)));
    },
    expr,
  );
  console.log(JSON.stringify(result, null, 1));
  return result;
}
