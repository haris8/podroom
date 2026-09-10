export type PlaybackStatus = 'idle' | 'starting' | 'playing' | 'paused' | 'ended' | 'error';
export type PlaybackSnapshot = { status: PlaybackStatus; index: number; error: string };

export class Narrator {
  private synth: SpeechSynthesis;
  private createUtterance: (text: string) => SpeechSynthesisUtterance;
  private update: (state: PlaybackSnapshot) => void;
  private passages: string[] = [];
  private voice = '';
  private rate = 1;
  private index = 0;
  private offset = 0;
  private token = 0;
  private status: PlaybackStatus = 'idle';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private utterance: SpeechSynthesisUtterance | null = null;

  constructor(synth: SpeechSynthesis, createUtterance: (text: string) => SpeechSynthesisUtterance, update: (state: PlaybackSnapshot) => void) {
    this.synth = synth; this.createUtterance = createUtterance; this.update = update;
  }
  private emit(status: PlaybackStatus, error = '') { this.status = status; this.update({status, index: this.index, error}); }
  private cancel() { this.token++; clearTimeout(this.timer); this.synth.cancel(); this.utterance = null; }
  prepare(passages: string[], voice: string, rate: number) {
    this.cancel(); this.passages = passages; this.voice = voice; this.rate = rate; this.index = 0; this.offset = 0; this.emit('idle');
  }
  play() {
    if (!this.passages.length) return;
    if (this.status === 'ended') { this.index = 0; this.offset = 0; }
    this.cancel();
    const token = this.token;
    const startOffset = this.offset;
    const u = this.createUtterance(this.passages[this.index].slice(startOffset));
    const voice = this.synth.getVoices().find(v => v.voiceURI === this.voice);
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = this.rate;
    this.utterance = u;
    this.emit('starting');
    const fail = (message: string) => { if (token !== this.token) return; this.cancel(); this.emit('error', message); };
    u.onstart = () => {
      if (token !== this.token) return;
      clearTimeout(this.timer); this.emit('playing');
      this.timer = setTimeout(() => fail('The voice stopped responding. Press play to retry, or create the episode with another voice.'), Math.max(45000, u.text.length * 700 / this.rate));
    };
    u.onboundary = e => { if (token === this.token && e.name === 'word') this.offset = startOffset + e.charIndex; };
    u.onend = () => {
      if (token !== this.token) return;
      clearTimeout(this.timer); this.offset = 0;
      if (this.index + 1 < this.passages.length) { this.index++; this.play(); }
      else { this.utterance = null; this.emit('ended'); }
    };
    u.onerror = e => {
      if (token !== this.token) return;
      const message = e.error === 'not-allowed' ? 'Your browser needs permission to play speech. Press play again, or open the app in Chrome, Edge, or Safari.'
        : e.error === 'network' ? 'This voice needs a connection. Reconnect and press play, or choose a device voice.'
        : 'This voice could not play. Try another narrator, then create the episode again.';
      fail(message);
    };
    this.timer = setTimeout(() => fail('The voice did not start. Try play again, or select a different narrator.'), 12000);
    try { this.synth.resume(); this.synth.speak(u); } catch { fail('Speech is unavailable. Try another browser or voice.'); }
  }
  pause() {
    // Cancel and retain the latest word boundary; avoids native pause deadlocks on mobile engines.
    this.cancel(); this.emit('paused');
  }
  seek(index: number) {
    const wasPlaying = this.status === 'playing' || this.status === 'starting';
    this.cancel(); this.index = Math.max(0, Math.min(this.passages.length - 1, index)); this.offset = 0;
    if (wasPlaying) this.play(); else this.emit('paused');
  }
  setRate(rate: number) { this.rate = rate; if (this.status === 'playing' || this.status === 'starting') this.play(); }
  dispose() { this.cancel(); }
}
