# Podroom

A responsive text-to-podcast studio with free, natural AI narration in the browser.

## Use

Paste text or import TXT, Markdown, text-based PDF, or DOCX files. Review the extracted text, choose a narrator and pace, and select **Create podcast**. Press play to listen. Use previous/next passage, the position slider, or transcript passages to seek. The sample text provides a quick first listen.

- Inputs are limited to 1,000,000 characters total, ten files per import, 50 MB per file, and 1,000 PDF pages. A split can contain up to 200 episodes. PDF imports show page progress and can be cancelled.
- UTF-8 and BOM-marked UTF-16 text files are supported. Scans require OCR elsewhere. Password-protected PDFs need to be unlocked first. Legacy DOC is not supported.
- Text, document extraction, and Kokoro AI narration run in the browser. Select **AI voices · Free** for English American/British voices, or **Device voices** for the system's available languages. Device voices marked Online may send text to their provider.
- Narration reads the supplied text with basic Markdown cleanup. It does not generate a conversational script or an audio download.
- Select **Save to library** after creating episodes to keep source text, episode order, voices, speed, and passage progress in your account. Open a saved item to resume on another device. Saved items can be archived and restored. Original uploaded files and generated audio are not stored.
- Keep the tab open while listening. Background and lock-screen playback are not guaranteed. Unsaved drafts disappear after refresh. Saved playback resumes at a passage boundary, not an exact audio timestamp.
- AI playback pauses within the current audio passage. Changing pace regenerates speech at the new speaking speed to preserve pitch, resuming at an approximate corresponding position. Device voices pause at the last reported word boundary or restart the current passage.

## Natural AI voices

Kokoro is the default engine. Choose Heart, Bella, Nicole, Michael, Puck, Emma, or George, create the episode, then press play. First use downloads approximately 120 MB of model, runtime, and voice assets on the standard path, or 350 MB with graphics acceleration; subsequent visits can reuse the browser's cache. The model and voice files come from Hugging Face, without uploading the source text. No account, API key, or per-use fee is required for the voice engine.

Speech is generated in a dedicated module worker with Kokoro-82M v1.0. It uses WebGPU with the recommended fp32 model when a graphics adapter is available, falling back to quantized q8 with single-threaded WASM. Cross-origin isolation is not required. If graphics initialization fails after downloading its model, the separate standard model must also download. The application generates the current passage and prefetches one ahead, retaining at most 12 MiB of sample data in its LRU cache plus the current playback buffer. It never renders an entire large document to audio in memory. Tokenizer overflow is split recursively instead of silently truncating speech.

Loading progress, cancellation, errors, and retry are visible in the player. Cancel terminates the worker; the next play reloads the engine. Speech generation speed depends on the device and may create gaps between passages. A modern browser with WebAssembly, module workers, and Web Audio is required. AI voices currently support English; device voices remain an explicit alternative. Background and lock-screen playback are not guaranteed.

Sources: [Kokoro.js](https://github.com/hexgrad/kokoro/tree/main/kokoro.js), [ONNX model](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), [ONNX Runtime configuration](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html).

## Multiple episodes from one document

1. Upload a document or paste its text.
2. Choose **Multiple episodes** and select episode/chapter headings, Markdown headings, or a literal separator line.
3. Click **Review episode split**. Check each episode, rename it if needed, and use **Merge with previous** to remove an incorrect boundary.
4. Click **Create episodes**, then select an episode from **Your episodes** to listen.

Automatic detection recognizes numbered headings such as `Episode 1: Title`, `Ep. 2`, and `Season 1, Episode 2: Title`. Unformatted title suffixes need punctuation after the number so ordinary prose does not become an episode. Chapter headings are used when episode headings are absent. Markdown mode uses the highest heading level that repeats. This is structural detection, not AI topic segmentation.

Introductions and contents text before the first real heading remain in the first episode. Only explicit custom separator lines are omitted. No markers means one episode with guidance to try another split method; the app never silently divides the document into arbitrary topics. Review is required after source or split settings change.

Episode selection stops the previous voice and resumes the selected episode from its last passage. Transcript rendering is paginated for long documents. Save the prepared episode list to your library to keep it across sessions.

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

It also copies the exact locked ONNX Runtime WASM modules into `public/speech-runtime`; these generated assets must be deployed alongside the worker bundle. Model weights remain downloaded on demand, rather than committed to Git or bundled into the Sites server. Model download and inference run only after play, not during page load.

The Sites manifest enables managed `DB` (D1) and `BUCKET` (R2) bindings. Sites provisions these resources during deployment; this setup does not require a separate Cloudflare signup or API key. D1 stores owner-scoped library metadata, episode settings, and listening progress; R2 stores immutable JSON containing source text and exact transcript passages. The existing Vite/Sites Worker build is retained.

Cloud saving is explicit. Text extraction and speech generation remain in the browser; **Save to library** uploads the prepared source and transcript. New source edits become a new saved copy after creating episodes again. Progress saves on passage changes, pause, completion, and speed changes, with visible retry errors and revision checks for competing devices. Archive retains the source and supports restore. There is no audio export or stored-audio playback pipeline yet.

Library endpoints require Sites-authenticated identity, reject cross-origin mutations, and return private non-cacheable responses. Stable save IDs and content fingerprints make retries safe. D1 metadata and episode rows are committed atomically after R2 upload. An ambiguous database failure may leave an unreferenced source object; it is retained to avoid deleting a successfully committed concurrent save.

For local storage tests, `npm test` uses ephemeral Miniflare D1/R2. For the app preview, build to emit binding configuration, then apply each new generated migration once with `node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_nervous_mystique.sql`. Local dev sign-in is provided by `/signin-with-chatgpt?return_to=/`; production identity is injected by Sites.

## Validation

Targeted tests exercise document-to-episode extraction, source preservation, heading/contents handling, custom separators, merge behavior, one-million-character and 200-episode limits, cancellation, playback completion, stale callbacks after pause/seek/replacement, pause offsets, errors, and speed changes. AI tests additionally cover lazy generation, prefetching, worker cancellation and retry, bounded voice/pace-aware caching, and phoneme overflow without source loss. Browser/mobile/background behavior and the optional WebMCP `set_source_text` integration were not interaction-tested in this build session.
