import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const source = path.resolve('node_modules/pdfjs-dist');
const target = path.resolve('public/pdf');
mkdirSync(target, {recursive: true});
cpSync(path.join(source, 'build/pdf.worker.min.mjs'), path.join(target, 'pdf.worker.min.mjs'));
for (const name of ['cmaps', 'standard_fonts', 'wasm']) cpSync(path.join(source, name), path.join(target, name), {recursive: true});
console.log('PDF reader assets prepared.');
