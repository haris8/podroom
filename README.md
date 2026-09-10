# Podroom

A responsive text-to-podcast studio with in-app browser narration.

## Use

Paste text or import TXT, Markdown, text-based PDF, or DOCX files. Review the extracted text, choose a narrator and pace, and select **Create podcast**. Press play to listen. Use previous/next passage, the position slider, or transcript passages to seek. The sample text provides a quick first listen.

- Inputs are limited to 1,000,000 characters total, ten files per import, 50 MB per file, and 1,000 PDF pages. A split can contain up to 200 episodes. PDF imports show page progress and can be cancelled.
- UTF-8 and BOM-marked UTF-16 text files are supported. Scans require OCR elsewhere. Password-protected PDFs need to be unlocked first. Legacy DOC is not supported.
- Text and document extraction run in the browser. Online speech voices may send text to their provider. Voice availability depends on browser/device.
- Narration reads the supplied text in full, with basic Markdown cleanup. It does not generate a conversational script or an audio download.
- Keep the tab open while listening. Background and lock-screen playback are not guaranteed. Text, episodes, and playback state are temporary and disappear after refresh.
- Pause retains the last reported word boundary; voices without boundary events resume the current passage.

## Multiple episodes from one document

1. Upload a document or paste its text.
2. Choose **Multiple episodes** and select episode/chapter headings, Markdown headings, or a literal separator line.
3. Click **Review episode split**. Check each episode, rename it if needed, and use **Merge with previous** to remove an incorrect boundary.
4. Click **Create episodes**, then select an episode from **Your episodes** to listen.

Automatic detection recognizes numbered headings such as `Episode 1: Title`, `Ep. 2`, and `Season 1, Episode 2: Title`. Unformatted title suffixes need punctuation after the number so ordinary prose does not become an episode. Chapter headings are used when episode headings are absent. Markdown mode uses the highest heading level that repeats. This is structural detection, not AI topic segmentation.

Introductions and contents text before the first real heading remain in the first episode. Only explicit custom separator lines are omitted. No markers means one episode with guidance to try another split method; the app never silently divides the document into arbitrary topics. Review is required after source or split settings change.

Episode selection stops the previous voice and resumes the selected episode from its last passage. Transcript rendering is paginated for long documents. The episode list and progress remain temporary for the open tab, just like the existing single-episode workflow.

## Development

Requires Node 22.13 or newer. On Windows use `npm.cmd` instead of the PowerShell shim.

```sh
npm ci
npm run dev
npm test
npx tsc --noEmit
npm run build
```

The postinstall/prebuild task copies PDF.js worker, character maps, fonts, and WebAssembly resources from the installed version into `public/pdf`. Keep these generated files aligned with the locked dependency version.

The Sites manifest identifies the private deployment. No external API key, D1 database, or R2 bucket is required. The existing Vite/Sites Worker build is retained.

## Validation

Targeted tests exercise document-to-episode extraction, source preservation, heading/contents handling, custom separators, merge behavior, one-million-character and 200-episode limits, cancellation, playback completion, stale callbacks after pause/seek/replacement, pause offsets, errors, and speed changes. Real speech output, mobile/background behavior, and the optional WebMCP `set_source_text` integration require a supported browser and were not interaction-tested in this build session.
