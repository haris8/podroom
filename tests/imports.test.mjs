import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import JSZip from 'jszip';
import test from 'node:test';
import assert from 'node:assert/strict';
import {splitEpisodes,MAX_CHARACTERS} from '../lib/podcast.ts';
mkdirSync('work',{recursive:true});
const output=resolve('work/extract-import-tests.mjs');
await build({entryPoints:[resolve('lib/extract-file.ts')],bundle:true,platform:'browser',format:'esm',outfile:output,external:['pdfjs-dist']});
const {extractFile,MAX_FILE_BYTES}=await import(pathToFileURL(output).href);
const source='Episode 1: Begin\nThis is the first episode.\n\nEpisode 2: Continue\nThis is the second episode.';

test('uploaded TXT preserves headings and creates two episode drafts',async()=>{const text=await extractFile(new File([source],'series.txt'));assert.equal(text,source);assert.equal(splitEpisodes(text).drafts.length,2);});
test('uploaded DOCX preserves paragraphs and episode boundaries',async()=>{const zip=new JSZip();zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+source.split('\n').map(line=>'<w:p><w:r><w:t>'+line+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>');const text=await extractFile(new File([await zip.generateAsync({type:'uint8array'})],'series.docx'));const drafts=splitEpisodes(text).drafts;assert.equal(drafts.length,2);assert.match(drafts[1].text,/second episode/);assert.equal(drafts.map(d=>d.text).join(''),text);});
test('the raised text limit accepts one million characters and rejects overflow',async()=>{const text='a'.repeat(MAX_CHARACTERS);assert.equal((await extractFile(new File([text],'large.txt'))).length,MAX_CHARACTERS);await assert.rejects(extractFile(new File([text+'a'],'too-long.txt')),/1,000,000/);});
test('oversized files are rejected before reading their bytes',async()=>{let read=false;await assert.rejects(extractFile({name:'large.pdf',size:MAX_FILE_BYTES+1,arrayBuffer(){read=true;throw Error('must not read');}}),/50 MB/);assert.equal(read,false);});
test('cancelling an import prevents returning its extracted text',async()=>{const controller=new AbortController();await assert.rejects(extractFile(new File([source],'series.txt'),{signal:controller.signal,onProgress(){controller.abort();}}),{name:'AbortError'});});
