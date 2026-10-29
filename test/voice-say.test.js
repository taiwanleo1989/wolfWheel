// 手機內建語音（public/judge/voice.js 的 say）：唸的字跟錄音一樣套破音字表，畫面文字不變
import { test } from 'node:test';
import assert from 'node:assert/strict';

const said = [];
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
globalThis.window = { speechSynthesis: { getVoices: () => [], cancel() {}, speak: u => said.push(u.text) } };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { voice } = await import('../public/judge/voice.js');

test('手機內建語音也把「角色」唸成「腳色」（ㄐㄧㄠˇ，Leo 2026-10-17 的破音字表；夜班菜單 5A）', () => {
  voice.unlock();
  said.length = 0;
  voice.say('請確認角色身分。');
  assert.deepEqual(said, ['請確認腳色身分。']);
});
