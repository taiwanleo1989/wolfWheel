// 主機聲音的序號邏輯（public/judge/voice.js）：哪一句要唸、哪一句不唸
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};
const { voice } = await import('../public/judge/voice.js');
const spoken = [];
voice.speak = n => spoken.push(n.seq);
const line = (seq, clip = 'x') => ({ seq, text: clip, clips: [clip] });

test('直接重開：擋住舊局台詞，等到「請確認角色身分」才唸；重開失敗（伺服器回錯）就補唸最後一句（2026-10-22／23）', () => {
  spoken.length = 0;
  voice.resync();
  voice.onNarration(line(3));            // 剛連上：不唸
  voice.onNarration(line(4));
  assert.deepEqual(spoken, [4]);
  voice.holdUntil('checkRole');
  voice.onNarration(line(5, 'police'));  // 確認視窗那幾秒的舊局台詞
  voice.onNarration(line(6, 'wolfClose'));
  assert.deepEqual(spoken, [4], '舊局台詞不唸');
  voice.onNarration(line(7, 'checkRole'));
  assert.deepEqual(spoken, [4, 7]);
  // 重開失敗：擋著的時候伺服器回錯 → 補唸最後收到的那句
  voice.holdUntil('checkRole');
  voice.onNarration(line(8, 'wolfOpen'));
  voice.onNarration(line(9, 'wolfClose'));
  voice.release();
  assert.deepEqual(spoken, [4, 7, 9]);
  voice.onNarration(line(10));
  assert.deepEqual(spoken, [4, 7, 9, 10], '放開之後照常唸');
});

test('剛變成主機：從下一句開始唸，不會被別局的序號卡住（2026-10-22）', () => {
  spoken.length = 0;
  voice.expectFresh();
  voice.onNarration(line(40));
  assert.deepEqual(spoken, [40]);
  voice.onNarration(line(3)); // 別局的序號比較小
  assert.deepEqual(spoken, [40], '沒有 resync 會一直不唸');
  voice.resync();
  voice.onNarration(line(3));
  voice.onNarration(line(4));
  assert.deepEqual(spoken, [40, 4]);
});
