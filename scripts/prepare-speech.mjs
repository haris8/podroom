import {cpSync, mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

// Resolve the runtime used by the locked Transformers package, including nested
// installations. Its JavaScript and WASM binaries must be the same version.
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const transformers = require.resolve('@huggingface/transformers');
const runtime = createRequire(transformers).resolve('onnxruntime-web/wasm');
const source = path.dirname(runtime);
const target = path.resolve('public/speech-runtime');
mkdirSync(target, {recursive: true});
for (const name of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) cpSync(path.join(source, name), path.join(target, name));
const version = JSON.parse(readFileSync(path.join(source, '../package.json'), 'utf8')).version;
console.log(`AI voice runtime ${version} prepared.`);
