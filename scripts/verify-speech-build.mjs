import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Exercise the actual emitted Worker URL, not a mock of the source factory.
// This catches the Vinext import.meta.url -> file:///ROOT transformation that
// previously passed unit tests but prevented voices from starting in production.
const root = path.resolve('dist/client');
const page = new URL('https://podroom.example/');
const browser = {location: page};
let checked = 0;
for (const name of readdirSync(root, {recursive: true})) {
  if (!name.endsWith('.js')) continue;
  const filename = path.join(root, name);
  const code = readFileSync(filename, 'utf8');
  if (!code.includes('neural.worker-')) continue;
  const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function visit(node) {
    if (ts.isNewExpression(node) && node.expression.getText(source) === 'Worker') {
      const argument = node.arguments?.[0]?.getText(source);
      if (argument?.includes('neural.worker-')) {
        const value = runInNewContext(argument, {URL, window: browser, self: browser, location: page}, {timeout: 100});
        const resolved = new URL(String(value), page);
        assert.equal(resolved.protocol, 'https:', `AI voice worker must use HTTPS, got ${resolved.href}`);
        assert.equal(resolved.origin, page.origin, `AI voice worker must share the page's origin: ${resolved.href}`);
        const asset = path.resolve(root, '.' + decodeURIComponent(resolved.pathname));
        assert.ok(asset.startsWith(root + path.sep) && existsSync(asset), `Missing AI voice worker asset: ${resolved.pathname}`);
        checked++;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
assert.ok(checked > 0, 'No emitted AI voice Worker constructor was verified.');
console.log(`Verified ${checked} AI voice worker URL(s): same-origin HTTPS and packaged asset present.`);
