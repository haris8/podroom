import type {KokoroTTS, GenerateOptions} from 'kokoro-js';

class PassageTooLong extends Error {}

// Kokoro normally truncates tokens silently. Intercept its public tokenizer so
// unusually verbose phonemes (numbers, URLs) can be split without losing text.
export function protectTokenizer(tts: KokoroTTS) {
  tts.tokenizer = new Proxy(tts.tokenizer, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, [args[0], {...args[1], truncation: false}]);
      if (result.input_ids.dims.at(-1) > 512) throw new PassageTooLong();
      return result;
    },
  });
}

export async function generateCompletePassage(tts: Pick<KokoroTTS, 'generate'>, text: string, voice: GenerateOptions['voice'], speed = 1): Promise<Float32Array> {
  try {
    const result = await tts.generate(text, {voice, speed});
    if (result.sampling_rate !== 24000 || !result.audio.length || !result.audio.every(Number.isFinite)) throw new Error('No playable speech was generated.');
    return result.audio;
  } catch (error) {
    if (!(error instanceof PassageTooLong) || text.length < 2) throw error;
    const middle = Math.floor(text.length / 2);
    const boundary = text.lastIndexOf(' ', middle);
    let split = boundary > text.length / 4 ? boundary : middle;
    if (/[\uD800-\uDBFF]/.test(text[split - 1])) split++;
    if (split >= text.length) throw new Error('This passage cannot be pronounced. Edit it or use a device voice.');
    const first = await generateCompletePassage(tts, text.slice(0, split), voice, speed);
    const second = await generateCompletePassage(tts, text.slice(split), voice, speed);
    const joined = new Float32Array(first.length + second.length);
    joined.set(first); joined.set(second, first.length);
    return joined;
  }
}
