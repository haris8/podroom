import { MAX_CHARACTERS } from './podcast';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export async function extractFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than 10 MB. Try a smaller document.');
  if (!file.size) throw new Error('This file is empty.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  let text = '';
  if (['txt', 'md', 'markdown'].includes(extension ?? '')) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    try { text = new TextDecoder(encoding, {fatal: true}).decode(buffer); }
    catch { throw new Error('This text encoding could not be read. Save the file as UTF-8 text, or paste the text instead.'); }
    if (text.includes('\u0000')) throw new Error('This does not look like a text document. Try a TXT, Markdown, PDF, or DOCX file.');
  } else if (extension === 'docx') {
    const mammoth = await import('mammoth');
    try { text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value; }
    catch { throw new Error('This Word file could not be read. Try re-saving it as DOCX or paste its text.'); }
  } else if (extension === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: '/pdf/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf/standard_fonts/', wasmUrl: '/pdf/wasm/' });
    try {
      const doc = await task.promise;
      if (doc.numPages > 300) throw new Error('This PDF has more than 300 pages. Upload a smaller section.');
      const pages: string[] = [];
      let length = 0;
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
        length += pageText.length;
        if (length > MAX_CHARACTERS) throw new Error('The document is longer than 100,000 characters. Try a smaller section.');
        pages.push(pageText); page.cleanup();
      }
      text = pages.join('\n\n');
    } catch (error) {
      if (error instanceof Error && error.name === 'PasswordException') throw new Error('This PDF is password-protected. Upload an unlocked copy.');
      if (error instanceof Error && /smaller|100,000/.test(error.message)) throw error;
      throw new Error('This PDF could not be read. Try another PDF or paste its text.');
    } finally { await task.destroy(); }
  } else throw new Error('Choose a TXT, Markdown, PDF, or DOCX file. Older .doc files need to be saved as .docx first.');
  text = text.replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('No readable text was found. Scanned PDFs and images need text recognition first.');
  if (text.length > MAX_CHARACTERS) throw new Error('The document is longer than 100,000 characters. Try a smaller section.');
  return text;
}
