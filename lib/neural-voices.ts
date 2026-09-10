export const NEURAL_VOICES = [
  {id: 'af_heart', name: 'Heart', accent: 'American', description: 'Warm'},
  {id: 'af_bella', name: 'Bella', accent: 'American', description: 'Clear'},
  {id: 'af_nicole', name: 'Nicole', accent: 'American', description: 'Soft'},
  {id: 'am_michael', name: 'Michael', accent: 'American', description: 'Steady'},
  {id: 'am_puck', name: 'Puck', accent: 'American', description: 'Lively'},
  {id: 'bf_emma', name: 'Emma', accent: 'British', description: 'Gentle'},
  {id: 'bm_george', name: 'George', accent: 'British', description: 'Measured'},
] as const;

export type NeuralVoice = typeof NEURAL_VOICES[number]['id'];
export const DEFAULT_NEURAL_VOICE: NeuralVoice = 'af_heart';
export type SpeechEngine = 'neural' | 'device';
export type VoiceProgress = {status: 'idle' | 'loading' | 'ready' | 'error'; message: string};
export type SpeechAudio = {samples: Float32Array; sampleRate: number};
export type SpeechRequest = {id: number; text: string; voice: string; speed: number};
export type SpeechResponse = {id: number} & (
  | {type: 'progress'; message: string}
  | {type: 'audio'; samples: Float32Array; sampleRate: number}
  | {type: 'error'; message: string}
);
