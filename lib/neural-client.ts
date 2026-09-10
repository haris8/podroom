import type {SpeechAudio, SpeechRequest, SpeechResponse, VoiceProgress} from './neural-voices';

export type SpeechSource = {generate: (text: string, voice: string, signal: AbortSignal, speed?: number) => Promise<SpeechAudio>; dispose: () => void};
const aborted = () => new DOMException('Cancelled', 'AbortError');

export class NeuralSpeechClient implements SpeechSource {
  private worker: Worker | null = null;
  private nextId = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private active: {id: number; resolve: (audio: SpeechAudio) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>} | null = null;
  private cache = new Map<string, SpeechAudio>();
  private bytes = 0;
  private revision = 0;
  private update: (progress: VoiceProgress) => void;
  private createWorker: () => Worker;
  private maxBytes: number;

  constructor(update: (progress: VoiceProgress) => void, createWorker: () => Worker, maxBytes = 12 * 1024 * 1024) {
    this.update = update; this.createWorker = createWorker; this.maxBytes = maxBytes;
  }
  generate(text: string, voice: string, signal: AbortSignal, speed = 1): Promise<SpeechAudio> {
    const revision = this.revision;
    const key = `${voice}\0${speed}\0${text}`;
    const run = async () => {
      if (signal.aborted || revision !== this.revision) throw aborted();
      const cached = this.cache.get(key);
      if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
      const result = await this.request(text, voice, speed);
      if (revision !== this.revision) throw aborted();
      if (result.samples.byteLength <= this.maxBytes) {
        while (this.bytes + result.samples.byteLength > this.maxBytes && this.cache.size) {
          const first = this.cache.keys().next().value!;
          this.bytes -= this.cache.get(first)!.samples.byteLength; this.cache.delete(first);
        }
        this.cache.set(key, result); this.bytes += result.samples.byteLength;
      }
      if (signal.aborted) throw aborted();
      return result;
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }
  private request(text: string, voice: string, speed: number): Promise<SpeechAudio> {
    return new Promise((resolve, reject) => {
      try {
        if (!this.worker) {
          this.worker = this.createWorker();
          this.worker.onmessage = (event: MessageEvent<SpeechResponse>) => {
            const message = event.data;
            const active = this.active;
            if (!active || message.id !== active.id) return;
            if (message.type === 'progress') { this.update({status: 'loading', message: message.message}); return; }
            clearTimeout(active.timer); this.active = null;
            if (message.type === 'error') {
              this.update({status: 'error', message: message.message});
              this.worker?.terminate(); this.worker = null; active.reject(new Error(message.message));
            } else if (!(message.samples instanceof Float32Array) || !message.samples.length || message.sampleRate !== 24000) {
              const error = 'The AI voice returned unusable audio. Press play to retry.';
              this.update({status: 'error', message: error}); active.reject(new Error(error));
            } else {
              this.update({status: 'ready', message: 'AI voice ready'});
              active.resolve({samples: message.samples, sampleRate: message.sampleRate});
            }
          };
          this.worker.onerror = () => this.fail('The AI voice engine stopped. Press play to retry, or create with a device voice.');
          this.worker.onmessageerror = () => this.fail('The AI voice could not return audio. Press play to retry.');
        }
        const id = ++this.nextId;
        this.active = {id, resolve, reject, timer: setTimeout(() => this.fail('Voice loading took too long. Check your connection, then press play to retry.'), 240000)};
        this.worker.postMessage({id, text, voice, speed} satisfies SpeechRequest);
      } catch { this.fail('AI voices are unavailable in this browser. Try a recent Chrome, Edge, Firefox, or Safari, or select Device voices.'); reject(new Error('AI voices are unavailable in this browser.')); }
    });
  }
  private fail(message: string) {
    if (this.active) { clearTimeout(this.active.timer); this.active.reject(new Error(message)); this.active = null; }
    this.worker?.terminate(); this.worker = null; this.update({status: 'error', message});
  }
  dispose() {
    this.revision++;
    if (this.active) { clearTimeout(this.active.timer); this.active.reject(aborted()); this.active = null; }
    this.worker?.terminate(); this.worker = null; this.cache.clear(); this.bytes = 0;
    this.update({status: 'idle', message: ''});
  }
}
