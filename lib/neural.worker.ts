import {KokoroTTS} from 'kokoro-js';
import {env} from '@huggingface/transformers';
import {generateCompletePassage, protectTokenizer} from './neural-generation';
import {NEURAL_VOICES, type NeuralVoice, type SpeechRequest, type SpeechResponse} from './neural-voices';

// Only imported by a browser module worker. Never runs inside the Sites server.
const workerScope = self as unknown as {onmessage: ((event: MessageEvent<SpeechRequest>) => void) | null; postMessage: (message: SpeechResponse, transfer?: Transferable[]) => void; location: Location};
env.allowLocalModels = false;
env.backends.onnx.wasm!.wasmPaths = new URL('/speech-runtime/', workerScope.location.href).href;
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;

let model: KokoroTTS | null = null;
let working = false;
workerScope.onmessage = async ({data}) => {
  if (working) { workerScope.postMessage({id: data.id, type: 'error', message: 'The voice is busy. Press play again.'}); return; }
  working = true;
  const {id, text, voice, speed} = data;
  try {
    if (typeof text !== 'string' || !text.trim() || text.length > 220 || !NEURAL_VOICES.some(item => item.id === voice) || ![.75, 1, 1.25, 1.5, 2].includes(speed)) throw new Error('Invalid voice, pace, or passage.');
    if (!model) {
      workerScope.postMessage({id, type: 'progress', message: 'Loading AI voices… First use downloads about 120 MB.'});
      model = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8', device: 'wasm',
        progress_callback: progress => {
          if (progress.status === 'progress' && progress.file.endsWith('.onnx')) workerScope.postMessage({id, type: 'progress', message: `Downloading AI voice model… ${Math.round(progress.progress)}%`});
          else if (progress.status === 'done' && progress.file.endsWith('.onnx')) workerScope.postMessage({id, type: 'progress', message: 'Starting the AI voice engine…'});
        },
      });
      protectTokenizer(model);
    }
    workerScope.postMessage({id, type: 'progress', message: 'Generating speech…'});
    const samples = await generateCompletePassage(model, text, voice as NeuralVoice, speed);
    workerScope.postMessage({id, type: 'audio', samples, sampleRate: 24000}, [samples.buffer as ArrayBuffer]);
  } catch {
    workerScope.postMessage({id, type: 'error', message: 'AI speech could not load or generate. Check your connection and press play to retry. If it keeps failing, select Device voices and create again.'});
  } finally { working = false; }
};
