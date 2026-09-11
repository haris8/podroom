import type {PlaybackSnapshot, PlaybackStatus} from './narrator';
import type {SpeechSource} from './neural-client';

// Mirrors the device narrator so episode selection and transcript seeking use
// the same UI. Audio is generated lazily; only one passage is prefetched.
export class NeuralNarrator {
  private source: SpeechSource;
  private createContext: () => AudioContext;
  private update: (state: PlaybackSnapshot) => void;
  private context: AudioContext | null = null;
  private node: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private passages: string[] = [];
  private voice = '';
  private rate = 1;
  private index = 0;
  private offset = 0;
  private startedAt = 0;
  private status: PlaybackStatus = 'idle';
  private token = 0;
  private controller = new AbortController();

  constructor(source: SpeechSource, createContext: () => AudioContext, update: (state: PlaybackSnapshot) => void) {
    this.source = source; this.createContext = createContext; this.update = update;
  }
  private emit(status: PlaybackStatus, error = '') { this.status = status; this.update({status, index: this.index, error}); }
  private stop(retainOffset: boolean) {
    this.token++; this.controller.abort(); this.controller = new AbortController();
    if (this.node) {
      if (retainOffset && this.context) this.offset = Math.min(this.buffer?.duration ?? 0, this.offset + (this.context.currentTime - this.startedAt));
      this.node.onended = null;
      try { this.node.stop(); } catch { /* Already ended. */ }
      this.node.disconnect(); this.node = null;
    }
  }
  prepare(passages: string[], voice: string, rate: number) {
    this.stop(false); this.passages = passages; this.voice = voice; this.rate = rate; this.index = 0; this.offset = 0; this.buffer = null; this.emit('idle');
  }
  play() {
    if (!this.passages.length) return;
    if (this.status === 'ended') { this.index = 0; this.offset = 0; this.buffer = null; }
    this.stop(true);
    const token = this.token;
    const signal = this.controller.signal;
    this.emit('starting');
    // Resume synchronously from the play gesture, before loading the model.
    try {
      this.context ??= this.createContext();
      const resumed = this.context.resume();
      void this.start(token, signal, resumed);
    } catch { this.emit('error', 'Audio playback is unavailable. Try another browser.'); }
  }
  restore(index: number, completed: boolean) {
    this.stop(false); this.index = Math.max(0, Math.min(this.passages.length - 1, index)); this.offset = 0; this.buffer = null;
    this.emit(completed ? 'ended' : 'paused');
  }
  private async start(token: number, signal: AbortSignal, resumed: Promise<void>) {
    try {
      await resumed;
      if (token !== this.token) return;
      if (!this.buffer) {
        const result = await this.source.generate(this.passages[this.index], this.voice, signal, this.rate);
        if (token !== this.token) return;
        const buffer = this.context!.createBuffer(1, result.samples.length, result.sampleRate);
        buffer.copyToChannel(result.samples as Float32Array<ArrayBuffer>, 0);
        this.buffer = buffer;
      }
      if (token !== this.token) return;
      if (this.context!.state !== 'running') throw new Error('Press play again to allow audio in this tab.');
      const node = this.context!.createBufferSource();
      this.node = node; node.buffer = this.buffer; node.connect(this.context!.destination);
      node.onended = () => {
        if (token !== this.token) return;
        node.disconnect(); this.node = null; this.offset = 0; this.buffer = null;
        if (this.index + 1 < this.passages.length) { this.index++; this.play(); } else this.emit('ended');
      };
      this.startedAt = this.context!.currentTime;
      node.start(0, Math.min(this.offset, Math.max(0, this.buffer.duration - .001)));
      this.emit('playing');
      const next = this.passages[this.index + 1];
      if (next) void this.source.generate(next, this.voice, signal, this.rate).catch(() => {});
    } catch (error) {
      if (token !== this.token || signal.aborted) return;
      this.stop(true);
      this.emit('error', error instanceof Error ? error.message : 'Could not generate speech. Press play to retry.');
    }
  }
  pause() { this.stop(true); if (this.status !== 'ended') this.emit('paused'); }
  seek(index: number) {
    const wasPlaying = this.status === 'playing' || this.status === 'starting';
    this.stop(false); this.index = Math.max(0, Math.min(this.passages.length - 1, index)); this.offset = 0; this.buffer = null;
    if (wasPlaying) this.play(); else this.emit('paused');
  }
  setRate(rate: number) {
    if (this.rate === rate) return;
    const wasPlaying = this.status === 'playing' || this.status === 'starting';
    this.stop(true);
    // Regenerate at Kokoro's speaking pace so the voice keeps its natural pitch.
    // Retain an approximate position because duration can differ at a new pace.
    this.offset *= this.rate / rate; this.rate = rate; this.buffer = null;
    if (wasPlaying) this.play();
  }
  cancelLoading() { this.pause(); this.source.dispose(); }
  dispose() { this.stop(false); this.source.dispose(); void this.context?.close().catch(() => {}); this.context = null; this.buffer = null; }
}
