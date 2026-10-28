// 主機播錄音（public/judge/voice.js 的 playClips）：用假的聲音系統跑，看排隊的句子停不停得掉
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 假時鐘：setTimeout 排進清單，runUntil 到點就跑
const timers = [];
let clock = 0;
let frozen = null; // 聲音系統被暫停：音訊時鐘停在這裡（毫秒）
globalThis.setTimeout = (fn, ms) => { timers.push({ at: clock + ms, fn }); return timers.length; };
globalThis.clearTimeout = () => {};
function runUntil(t) { clock = t; timers.sort((a, b) => a.at - b.at); while (timers.length && timers[0].at <= t) timers.shift().fn(); }

const sources = [];
class Node { connect(x) { return x ?? this; } }
class Src extends Node { stopped = false; start(t) { this.t = t; } stop() { this.stopped = true; } }
class Ctx {
  state = 'running'; sampleRate = 8000; destination = new Node();
  get currentTime() { return (frozen ?? clock) / 1000; }
  createBuffer() { return { getChannelData: () => new Float32Array(10) }; }
  createBufferSource() { const s = new Src(); sources.push(s); return s; }
  createGain() { const g = new Node(); g.gain = { value: 1, setTargetAtTime() {} }; return g; }
  createMediaElementSource() { return new Node(); }
  createDynamicsCompressor() { const c = new Node(); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) c[k] = {}; return c; }
  resume() { return Promise.resolve(); }
  decodeAudioData(d, ok) { ok({ duration: 1.5 }); }
}
globalThis.window = { AudioContext: Ctx };
globalThis.Audio = class { play() { return Promise.resolve(); } pause() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.fetch = async u => (u.includes('manifest') ? { ok: true, json: async () => ({ files: { a: { file: 'a.mp3' }, b: { file: 'b.mp3' } } }) } : { arrayBuffer: async () => new ArrayBuffer(1) });
const { voice } = await import('../public/judge/voice.js');

test('兩句排隊時，前一句唸完後按「再唸一次」／直接重開（stop），排在後面那句也要停掉（2026-10-29 夜班）', async () => {
  voice.unlock();
  await new Promise(r => setImmediate(r));
  await voice.speak({ seq: 1, text: 'A', clips: ['a'] }); // A：0.05～1.59 秒
  runUntil(500);
  await voice.speak({ seq: 2, text: 'B', clips: ['b'] }); // B 接在 A 後面：1.59～3.13 秒
  const b = sources.at(-1);
  assert.ok(b.t > 1.5, 'B 排在 A 後面');
  runUntil(1700); // A 唸完的清理跑過了
  voice.stop();
  assert.equal(b.stopped, true, 'B 被停掉');
});

test('唸到一半聲音系統被暫停：收尾計時器跑過之後，補唸前的 stop() 還停得掉剩下的半句（2026-10-29 夜班獨立審查）', async () => {
  await voice.speak({ seq: 3, text: 'A', clips: ['a'] });
  const a = sources.at(-1);
  runUntil(clock + 500); frozen = clock; // 唸到一半被暫停
  runUntil(clock + 5000);                // 牆上時鐘照走，這句的收尾計時器跑過
  voice.stop();
  assert.equal(a.stopped, true, 'A 剩下的部分被停掉');
  frozen = null;
});
