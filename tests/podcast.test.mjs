import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPassages, cleanText, SAMPLE_TEXT } from '../lib/podcast.ts';
import { Narrator } from '../lib/narrator.ts';

function setup() {
  const history = [];
  const snapshots = [];
  const synth = {cancel() {}, resume() {}, getVoices() { return []; }, speak(u) { history.push(u); }};
  const player = new Narrator(synth, text => ({text}), state => snapshots.push(state));
  return {player, history, snapshots, state: () => snapshots.at(-1)};
}

test('long source text is preserved and bounded for speech', () => {
  for (const source of [SAMPLE_TEXT, 'An unpunctuated passage '.repeat(200), '🙂你好世界'.repeat(200), 'Hi. Why? Great!\nNext paragraph.', 'a'.repeat(2000)]) {
    const passages = splitPassages(source);
    assert.ok(passages.length);
    assert.ok(passages.every(p => p.length <= 220));
    assert.equal(passages.join('').replace(/\s/g,''), cleanText(source).replace(/\s/g,''));
    assert.ok(passages.every(p => !/[\uD800-\uDBFF]$/.test(p)));
  }
});
test('blank and punctuation-only input cannot create an empty episode', () => { assert.deepEqual(splitPassages(' \n\t'), []); assert.deepEqual(splitPassages('...!'), []); });
test('decimals and abbreviations retain their spoken meaning', () => {
  const passages = splitPassages('Dr. Smith measured 3.14 meters. The cost is $12.50.');
  assert.ok(passages.some(p => p.includes('3.14')));
  assert.ok(passages.some(p => p.includes('$12.50')));
});
test('narration only advances when the current utterance actually ends', () => {
  const {player,history,state}=setup(); player.prepare(['One.','Two.'],'',1); player.play();
  assert.equal(history.length,1); assert.equal(state().status,'starting'); history[0].onstart();
  assert.equal(state().status,'playing'); history[0].onend(); assert.equal(history.length,2); assert.equal(state().index,1);
  history[1].onend(); assert.equal(state().status,'ended'); player.dispose();
});
test('cancelled utterances cannot advance after pause or seek', () => {
  const {player,history,state}=setup(); player.prepare(['One.','Two.','Three.'],'',1); player.play(); const stale=history[0]; player.pause(); stale.onend();
  assert.equal(history.length,1); assert.equal(state().status,'paused');
  player.play(); const previous=history[1]; previous.onstart(); player.seek(2); previous.onend();
  assert.equal(history.at(-1).text,'Three.'); assert.equal(state().index,2); assert.equal(history.length,3); player.dispose();
});
test('replacing an episode invalidates old error and end events', () => {
  const {player,history,state}=setup(); player.prepare(['Old.','Wrong.'],'',1); player.play(); const stale=history[0]; player.prepare(['New.'],'',1);
  stale.onerror({error:'network'}); stale.onend(); assert.equal(state().status,'idle'); assert.equal(history.length,1);
  player.play(); assert.equal(history.at(-1).text,'New.'); player.dispose();
});
test('pause resumes at the last reported word instead of skipping source', () => {
  const {player,history}=setup(); player.prepare(['One two three.'],'',1); player.play(); history[0].onboundary({name:'word',charIndex:4}); player.pause(); player.play();
  assert.equal(history[1].text,'two three.'); history[1].onboundary({name:'word',charIndex:4}); player.pause(); player.play(); assert.equal(history[2].text,'three.'); player.dispose();
});
test('voice errors are visible and can be retried', () => {
  const {player,history,state}=setup(); player.prepare(['Read this.'],'',1); player.play(); history[0].onerror({error:'network'});
  assert.equal(state().status,'error'); assert.match(state().error,/connection/); player.play(); assert.equal(history[1].text,'Read this.'); player.dispose();
});
test('changing speed preserves the current passage and replay restarts', () => {
  const {player,history,state}=setup(); player.prepare(['One.','Two.'],'',1); player.play(); history[0].onstart(); player.setRate(1.5);
  assert.equal(history[1].rate,1.5); assert.equal(history[1].text,'One.'); history[1].onend(); history[2].onend(); assert.equal(state().status,'ended'); player.play(); assert.equal(history.at(-1).text,'One.'); player.dispose();
});
