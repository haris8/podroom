import { MAX_CHARACTERS } from './podcast';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_PAGES = 1000;
type ImportOptions = {signal?: AbortSignal; onProgress?: (message: string) => void};
export async function extractFile(file: File, options: ImportOptions = {}): Promise<string> {
  const check = () => { if (options.signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError'); };
  check();
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than 50 MB. Try a smaller document.');
  if (!file.size) throw new Error('This file is empty.');
  options.onProgress?.(`Reading ${file.name}…`);
  const extension = file.name.split('.').pop()?.toLowerCase();
  let text = '';
  if (['txt', 'md', 'markdown'].includes(extension ?? '')) {
    const buffer = await file.arrayBuffer(); check();
    const bytes = new Uint8Array(buffer);
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    try { text = new TextDecoder(encoding, {fatal: true}).decode(buffer); }
    catch { throw new Error('This text encoding could not be read. Save the file as UTF-8 text, or paste the text instead.'); }
    if (text.includes('\u0000')) throw new Error('This does not look like a text document. Try a TXT, Markdown, PDF, or DOCX file.');
  } else if (extension === 'docx') {
    const mammoth = await import('mammoth'); check();
    try { text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value; }
    catch { check(); throw new Error('This Word file could not be read. Try re-saving it as DOCX or paste its text.'); }
    check();
  } else if (extension === 'pdf') {
    const pdfjs = await import('pdfjs-dist'); check();
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf/pdf.worker.min.mjs';
    const bytes = new Uint8Array(await file.arrayBuffer()); check();
    const task = pdfjs.getDocument({ data: bytes, cMapUrl: '/pdf/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf/standard_fonts/', wasmUrl: '/pdf/wasm/' });
    const abort = () => { void task.destroy().catch(() => {}); };
    options.signal?.addEventListener('abort', abort, {once:true});
    try {
      const doc = await task.promise; check();
      if (doc.numPages > MAX_PDF_PAGES) throw new Error('This PDF has more than 1,000 pages. Upload a smaller section.');
      const pages: string[] = [];
      let length = 0;
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        check(); options.onProgress?.(`${file.name} · page ${pageNumber} of ${doc.numPages}`);
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent(); check();
        const pageText = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
        length += pageText.length + (pages.length ? 2 : 0);
        if (length > MAX_CHARACTERS) throw new Error('The document is longer than 1,000,000 characters. Try a smaller section.');
        pages.push(pageText); page.cleanup();
        // Let the progress message and cancellation control remain responsive.
        if (pageNumber % 5 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      text = pages.join('\n\n');
    } catch (error) {
      check();
      if (error instanceof Error && error.name === 'PasswordException') throw new Error('This PDF is password-protected. Upload an unlocked copy.');
      if (error instanceof Error && /smaller|1,000,000/.test(error.message)) throw error;
      throw new Error('This PDF could not be read. Try another PDF or paste its text.');
    } finally { options.signal?.removeEventListener('abort', abort); await task.destroy(); }
  } else throw new Error('Choose a TXT, Markdown, PDF, or DOCX file. Older .doc files need to be saved as .docx first.');
  check(); text = text.replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('No readable text was found. Scanned PDFs and images need text recognition first.');
  if (text.length > MAX_CHARACTERS) throw new Error('The document is longer than 1,000,000 characters. Try a smaller section.');
  return text;
}
