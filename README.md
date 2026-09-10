# Podroom

A responsive text-to-podcast studio with in-app browser narration.

## Use

Paste text or import TXT, Markdown, text-based PDF, or DOCX files. Review the extracted text, choose a narrator and pace, and select **Create podcast**. Press play to listen. Use previous/next passage, the position slider, or transcript passages to seek. The sample text provides a quick first listen.

- Inputs are limited to 100,000 characters total, ten files per import, 10 MB per file, and 300 PDF pages.
- UTF-8 and BOM-marked UTF-16 text files are supported. Scans require OCR elsewhere. Password-protected PDFs need to be unlocked first. Legacy DOC is not supported.
- Text and document extraction run in the browser. Online speech voices may send text to their provider. Voice availability depends on browser/device.
- Narration reads the supplied text in full, with basic Markdown cleanup. It does not generate a conversational script or an audio download.
- Keep the tab open while listening. Background and lock-screen playback are not guaranteed. Text, episodes, and playback state are temporary and disappear after refresh.
- Pause retains the last reported word boundary; voices without boundary events resume the current passage.

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

Targeted tests exercise long-text preservation, decimal handling, playback completion, stale callbacks after pause/seek/replacement, pause offsets, errors, and speed changes. Real speech output, mobile/background behavior, and the optional WebMCP `set_source_text` integration require a supported browser and were not interaction-tested in this build session.
