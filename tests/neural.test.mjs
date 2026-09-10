import test from 'node:test';
import assert from 'node:assert/strict';
import {NeuralNarrator} from '../lib/neural-narrator.ts';
import {NeuralSpeechClient} from '../lib/neural-client.ts';
import {protectTokenizer, generateCompletePassage} from '../lib/neural-generation.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const requests = [], nodes = [], states = [];
  const context = {
    state: 'running', currentTime: 0, destination: {}, resume: async () => {}, close: async () => {},
    createBuffer: (_channels, length, sampleRate) => ({duration: length / sampleRate, copyToChannel() {}}),
    createBufferSource() {
      const node = {playbackRate: {value: 1}, onended: null, connect() {}, disconnect() {}, start(_when, offset) {this.offset = offset;}, stop() {this.stopped = true;}};
      nodes.push(node); return node;
    },
  };
  const source = {generate(text, voice, signal, speed) {return new Promise((resolve,reject) => requests.push({text,voice,signal,speed,resolve,reject}));}, dispose() {}};
  const player = new NeuralNarrator(source, () => context, state => states.push(state));
  const resolve = i => requests[i].resolve({samples: new Float32Array(240000), sampleRate: 24000});
  return {player, context, requests, nodes, states, resolve, state: () => states.at(-1)};
}

test('AI narration is lazy, prefetches one passage, and advances on actual audio completion', async () => {
  const f=fixture(); f.player.prepare(['One.','Two.','Three.'],'af_heart',1);
  assert.equal(f.requests.length,0); f.player.play(); await tick(); assert.equal(f.requests.length,1);
  f.resolve(0); await tick(); assert.equal(f.state().status,'playing'); assert.equal(f.requests.length,2);
  assert.equal(f.requests[1].text,'Two.'); f.nodes[0].onended(); await tick();
  assert.equal(f.state().index,1); assert.equal(f.requests.at(-1).text,'Two.'); f.player.dispose();
});
test('pausing during generation never plays a late audio result', async () => {
  const f=fixture(); f.player.prepare(['One.'],'af_heart',1); f.player.play(); await tick(); f.player.pause();
  f.resolve(0); await tick(); assert.equal(f.nodes.length,0); assert.equal(f.state().status,'paused'); f.player.dispose();
});
test('AI pace is synthesized at natural pitch, and pause retains its position', async () => {
  const f=fixture(); f.player.prepare(['One.'],'af_heart',1); f.player.play(); await tick(); f.resolve(0); await tick();
  f.context.currentTime=2; f.player.setRate(2); await tick(); assert.equal(f.requests[1].speed,2); f.resolve(1); await tick();
  assert.equal(f.nodes[1].playbackRate.value,1); assert.equal(f.nodes[1].offset,1);
  f.context.currentTime=3; f.player.pause(); f.player.play(); await tick(); assert.equal(f.nodes[2].offset,2);
  assert.equal(f.requests.length,2); f.player.dispose();
});
test('seeking invalidates both delayed generation and old audio end callbacks', async () => {
  const f=fixture(); f.player.prepare(['One.','Two.','Three.'],'af_heart',1); f.player.play(); await tick(); f.resolve(0); await tick();
  const staleEnd=f.nodes[0].onended; f.player.seek(2); await tick(); staleEnd();
  assert.equal(f.state().index,2); assert.equal(f.requests.at(-1).text,'Three.');
  f.resolve(f.requests.length-1); await tick(); assert.equal(f.state().status,'playing'); f.player.dispose();
});
test('switching an episode cannot play audio from the old episode', async () => {
  const f=fixture(); f.player.prepare(['Old.'],'af_heart',1); f.player.play(); await tick();
  f.player.prepare(['New.'],'bf_emma',1); f.player.play(); await tick(); f.resolve(0); await tick(); assert.equal(f.nodes.length,0);
  f.resolve(1); await tick(); assert.equal(f.nodes.length,1); assert.equal(f.requests[1].voice,'bf_emma'); f.player.dispose();
});
test('AI generation errors can be retried; replay starts the first passage', async () => {
  const f=fixture(); f.player.prepare(['One.'],'af_heart',1); f.player.play(); await tick();
  f.requests[0].reject(new Error('Network failed')); await tick(); assert.match(f.state().error,/Network/);
  f.player.play(); await tick(); f.resolve(1); await tick(); f.nodes[0].onended(); assert.equal(f.state().status,'ended'); f.player.pause(); assert.equal(f.state().status,'ended');
  f.player.play(); await tick(); assert.equal(f.state().index,0); assert.equal(f.requests.at(-1).text,'One.'); f.player.dispose();
});

function workerFixture(maxBytes=64) {
  const workers=[];
  const client=new NeuralSpeechClient(()=>{},()=>{
    const worker={sent:[],postMessage(message){this.sent.push(message);},terminate(){this.terminated=true;}};
    workers.push(worker); return worker;
  },maxBytes);
  const signal=new AbortController().signal;
  const reply=(worker=workers.at(-1),samples=new Float32Array(8))=>worker.onmessage({data:{id:worker.sent.at(-1).id,type:'audio',samples,sampleRate:24000}});
  return {client,workers,signal,reply};
}
test('worker requests serialize and cache by voice/text, with bounded LRU eviction', async () => {
  const f=workerFixture(64);
  for(const text of ['one','two']){const p=f.client.generate(text,'af_heart',f.signal);await tick();f.reply();await p;}
  const worker=f.workers[0]; assert.equal(worker.sent.length,2);
  await f.client.generate('one','af_heart',f.signal);assert.equal(worker.sent.length,2);
  let p=f.client.generate('three','af_heart',f.signal);await tick();f.reply();await p;
  p=f.client.generate('two','af_heart',f.signal);await tick();assert.equal(worker.sent.length,4);f.reply();await p;
  p=f.client.generate('two','bf_emma',f.signal);await tick();assert.equal(worker.sent.length,5);f.reply();await p;f.client.dispose();
});
test('cancelled queued requests never start inference; late replies cannot revive disposed workers', async () => {
  const f=workerFixture();const abort=new AbortController();
  const first=f.client.generate('one','af_heart',f.signal);const second=f.client.generate('two','af_heart',abort.signal);
  const rejected=assert.rejects(second,{name:'AbortError'});await tick();abort.abort();assert.equal(f.workers[0].sent.length,1);
  f.reply();await first;await rejected;
  const third=f.client.generate('three','af_heart',f.signal);const disposed=assert.rejects(third,{name:'AbortError'});await tick();const old=f.workers[0];f.client.dispose();await disposed;f.reply(old);
  const fourth=f.client.generate('four','af_heart',f.signal);await tick();assert.equal(f.workers.length,2);f.reply();await fourth;f.client.dispose();
});
test('worker failures reset the engine and allow a clean retry', async () => {
  const f=workerFixture();let p=f.client.generate('one','af_heart',f.signal);const rejected=assert.rejects(p,/stopped/);await tick();f.workers[0].onerror();await rejected;
  p=f.client.generate('one','af_heart',f.signal);await tick();assert.equal(f.workers.length,2);f.reply();await p;f.client.dispose();
});

test('a blocked worker URL reports a loading problem and can be retried', async () => {
  const states=[]; let attempts=0; let worker;
  const client=new NeuralSpeechClient(state=>states.push(state),()=>{
    if(++attempts===1)throw new DOMException('Worker origin mismatch','SecurityError');
    worker={postMessage(message){this.message=message;},terminate(){}}; return worker;
  });
  const signal=new AbortController().signal;
  await assert.rejects(client.generate('Hello.','af_heart',signal),/voice files were blocked/);
  assert.doesNotMatch(states.at(-1).message,/unavailable in this browser/);
  const retry=client.generate('Hello.','af_heart',signal);await tick();
  worker.onmessage({data:{id:worker.message.id,type:'audio',samples:new Float32Array(8),sampleRate:24000}});
  await retry;assert.equal(states.at(-1).status,'ready');client.dispose();
});
test('phoneme limits cause recursive splitting instead of silently dropping source', async () => {
  const narrated=[];
  const tts={tokenizer(text,options){assert.equal(options.truncation,false);return {input_ids:{dims:[1,text.length>12?600:20]}};},async generate(text){this.tokenizer(text,{truncation:true});narrated.push(text);return {sampling_rate:24000,audio:new Float32Array([.2,.3])};}};
  protectTokenizer(tts);
  const source='This passage 123456789123456789 needs smaller pieces.';
  const audio=await generateCompletePassage(tts,source,'af_heart');
  assert.equal(narrated.join(''),source);assert.equal(audio.length,narrated.length*2);assert.ok(narrated.length>1);
});
