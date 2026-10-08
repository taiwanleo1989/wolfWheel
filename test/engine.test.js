import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/lobby.js';
import * as G from '../src/game.js';
import * as E from '../src/engine.js';
import * as R from '../public/shared/roles.js';

// 固定順序發牌：rand(n)=n-1 讓洗牌不動，座位依 ROLE_ORDER 拿角色
//   狼王守衛：1–3 狼人、4 狼王、5 預言家、6 女巫、7 獵人、8 守衛、9–12 平民
const noShuffle = n => n - 1;
const minRand = () => 0;          // 隨機等待取最短
const id = n => 'p' + n;

function newGame(preset = 'lang-wang-shou-wei', rules = {}) {
  const p = R.PRESETS.find(x => x.id === preset);
  let r = L.newRoom('1234', p.players, 'host', 0);
  for (let n = 1; n <= p.players; n++) r = L.claimSeat(r, id(n), n, new Set()).room;
  r = G.setSetup(r, { preset, counts: p.counts, rules }).room;
  r = G.startDeal(r, noShuffle).room;
  return E.startGame(r, 0, minRand).room;
}
const everyone = r => new Set(Object.values(r.seats));
// 把鬧鐘一路撥到「輪到某個角色」或天亮為止
function runUntil(r, pred) {
  for (let i = 0; i < 50 && !pred(r); i++) {
    if (!r.game.timer) break;
    r = E.advance(r, r.game.timer.at, minRand).room;
  }
  return r;
}
const stepIs = step => r => r.phase === 'night' && r.game.night.stage === 'acting' && r.game.night.steps[r.game.night.idx] === step;
const isDay = r => r.phase !== 'night';
function act(r, seat, payload) {
  const res = E.nightAction(r, id(seat), payload, everyone(r), r.game.timer?.at ?? 1e9, minRand);
  assert.equal(res.ok, true, res.error);
  return res.room;
}
// 快轉到某個角色的回合；途中其他活著的角色都做「不動作」
function toStep(r, target) {
  for (let i = 0; i < 20; i++) {
    r = runUntil(r, x => x.phase !== 'night' || (x.game.night.stage === 'acting' && !x.game.timer));
    if (r.phase !== 'night' || stepIs(target)(r)) return r;
    const step = r.game.night.steps[r.game.night.idx];
    const who = E.actors(r.game, step);
    if (step === 'guard') r = act(r, who[0], { target: 0 });
    if (step === 'wolf') for (const w of who) r = act(r, w, { target: 0 });
    if (step === 'witch') r = act(r, who[0], { use: 'none' });
    if (step === 'seer') {
      const t = Object.keys(r.game.alive).map(Number).find(s => r.game.alive[s] && s !== who[0]);
      r = act(r, who[0], { target: t }); r = act(r, who[0], { done: true });
    }
  }
  return r;
}
// 跑完一整晚：每一步給一個動作（沒給就跳過）
function playNight(r, { guard = 0, wolf = 0, witch = { use: 'none' }, seer = null } = {}) {
  r = runUntil(r, stepIs('guard')); if (r.game.night && E.actors(r.game, 'guard').length) r = act(r, 8, { target: guard });
  r = runUntil(r, stepIs('wolf')); for (const w of E.actors(r.game, 'wolf')) r = act(r, w, { target: wolf });
  r = runUntil(r, stepIs('witch')); if (E.actors(r.game, 'witch').length) r = act(r, 6, witch);
  r = runUntil(r, stepIs('seer'));
  if (E.actors(r.game, 'seer').length) { r = act(r, 5, { target: seer ?? 1 }); r = act(r, 5, { done: true }); }
  return runUntil(r, isDay);
}

test('黑夜順序：守衛 → 狼人 → 女巫 → 預言家；板子沒有的角色整段跳過', () => {
  assert.deepEqual(newGame().game.night.steps, ['guard', 'wolf', 'witch', 'seer']);
  assert.deepEqual(newGame('yu-nv-lie-bai').game.night.steps, ['wolf', 'witch', 'seer']);
});

test('第一句台詞是天黑請閉眼，接著輪到守衛睜眼', () => {
  let r = newGame();
  assert.match(r.game.narration.text, /天黑請閉眼/);
  r = toStep(r, 'guard');
  assert.match(r.game.narration.text, /守衛請睜眼/);
});

test('狼人要全部選同一個才算數', () => {
  let r = toStep(newGame(), 'wolf');
  r = act(r, 1, { target: 9 });
  r = act(r, 2, { target: 10 });
  assert.equal(r.game.night.stage, 'acting', '意見不一致不能結束');
  for (const w of [1, 2, 3, 4]) r = act(r, w, { target: 9 });
  assert.equal(r.game.night.stage, 'pause');
  assert.equal(r.game.night.wolfTarget, 9);
});

test('狼刀沒人救 → 天亮死亡；女巫救 → 平安夜', () => {
  let r = playNight(newGame(), { wolf: 9 });
  assert.equal(r.game.alive[9], false);
  assert.match(r.game.log.at(-1).text, /死亡的是 9 號/);
  r = playNight(newGame(), { wolf: 9, witch: { use: 'save' } });
  assert.equal(r.game.alive[9], true);
  assert.match(r.game.log.at(-1).text, /平安夜/);
});

test('守衛守到 → 活；同守同救 → 死（奶穿）', () => {
  assert.equal(playNight(newGame(), { guard: 9, wolf: 9 }).game.alive[9], true);
  assert.equal(playNight(newGame(), { guard: 9, wolf: 9, witch: { use: 'save' } }).game.alive[9], false);
});

test('守衛不能連續兩晚守同一人', () => {
  let r = playNight(newGame(), { guard: 9, wolf: 10 });
  r = E.nextNight(r, 1e6).room;
  r = toStep(r, 'guard');
  assert.equal(E.nightAction(r, id(8), { target: 9 }, everyone(r), 0, minRand).ok, false);
  assert.equal(E.nightAction(r, id(8), { target: 11 }, everyone(r), 0, minRand).ok, true);
});

test('女巫自救：預設只有第一晚可以', () => {
  let r = toStep(newGame(), 'wolf');
  for (const w of [1, 2, 3, 4]) r = act(r, w, { target: 6 });
  r = toStep(r, 'witch');
  assert.equal(E.privateGame(r, 6).action.canSave, true);
  // 第二晚被刀：不能自救（解藥若還在）
  let r2 = playNight(newGame(), { wolf: 9 });
  r2 = E.nextNight(r2, 1e6).room;
  r2 = toStep(r2, 'wolf');
  for (const w of [1, 2, 3, 4]) r2 = act(r2, w, { target: 6 });
  r2 = toStep(r2, 'witch');
  assert.equal(E.privateGame(r2, 6).action.canSave, false);
  assert.equal(E.nightAction(r2, id(6), { use: 'save' }, everyone(r2), 0, minRand).ok, false);
});

test('女巫：解藥用掉後看不到誰被殺；不能毒自己；一晚只用一瓶', () => {
  let r = playNight(newGame(), { wolf: 9, witch: { use: 'save' } });
  r = E.nextNight(r, 1e6).room;
  r = toStep(r, 'wolf');
  for (const w of [1, 2, 3, 4]) r = act(r, w, { target: 10 });
  r = toStep(r, 'witch');
  const a = E.privateGame(r, 6).action;
  assert.equal(a.victim, null);
  assert.equal(a.saveUsedUp, true);
  assert.equal(E.nightAction(r, id(6), { use: 'poison', target: 6 }, everyone(r), 0, minRand).ok, false);
  r = act(r, 6, { use: 'poison', target: 1 });
  assert.equal(r.game.night.stage, 'pause', '用了一瓶就結束這一步');
});

test('預言家：查驗結果，狼王也算狼', () => {
  let r = toStep(newGame(), 'seer');
  r = act(r, 5, { target: 4 });
  assert.equal(E.privateGame(r, 5).action.checked.wolf, true);
  assert.equal(E.nightAction(r, id(5), { target: 9 }, everyone(r), 0, minRand).ok, false, '一晚只能查一個');
  r = act(r, 5, { done: true });
  r = runUntil(r, isDay);
  assert.deepEqual(E.privateGame(r, 5).seerChecks.map(c => [c.target, c.wolf]), [[4, true]]);
});

test('獵人被刀可以開槍，被毒不能；被槍帶走的狼王還能再開槍', () => {
  let r = playNight(newGame(), { wolf: 7 });
  assert.equal(E.privateGame(r, 7).canShoot, true);
  const res = E.shoot(r, id(7), 4); // 帶走狼王
  assert.equal(res.ok, true);
  r = res.room;
  assert.equal(r.game.alive[4], false);
  assert.equal(E.privateGame(r, 4).canShoot, true, '狼王被槍帶走也能開槍');
  const poisoned = playNight(newGame(), { witch: { use: 'poison', target: 7 } });
  assert.equal(poisoned.game.alive[7], false);
  assert.equal(E.privateGame(poisoned, 7).canShoot, undefined);
});

test('白癡被放逐翻牌免死；再被放逐才會出局', () => {
  let r = playNight(newGame('yu-nv-lie-bai'), { wolf: 0 }); // 預女獵白：1–4 狼、5 預、6 女、7 獵、8 白癡
  r = E.exile(r, 8).room;
  assert.equal(r.game.alive[8], true);
  assert.deepEqual(r.game.idiotRevealed, [8]);
  assert.equal(E.exile(r, 9).ok, false, '一天只能放逐一次');
  r = E.nextNight(r, 1e6).room;
  r = playNight(r, { wolf: 0 });
  r = E.exile(r, 8).room;
  assert.equal(r.game.alive[8], false);
});

test('騎士決鬥：對狼 → 狼出局；對好人 → 騎士出局；只能用一次', () => {
  // 狼王騎士：1–3 狼、4 狼王、5 預、6 女、7 獵、8 騎士、9–12 民
  let r = playNight(newGame('lang-wang-qi-shi'), { wolf: 0 });
  assert.equal(E.privateGame(r, 8).canDuel, true);
  let d = E.duel(r, id(8), 2).room;
  assert.equal(d.game.alive[2], false);
  assert.equal(E.duel(d, id(8), 3).ok, false);
  d = E.duel(r, id(8), 9).room;
  assert.equal(d.game.alive[8], false);
  assert.equal(d.game.alive[9], true);
});

test('勝負（屠邊）：神職全死 → 狼贏；狼全死 → 好人贏', () => {
  const g = newGame().game;
  const counts = R.PRESETS[1].counts, side = { win: 'side' };
  assert.equal(E.winnerOf({ ...g, alive: { ...g.alive, 5: false, 6: false, 7: false, 8: false } }, counts, side), 'wolf');
  assert.equal(E.winnerOf({ ...g, alive: { ...g.alive, 9: false, 10: false, 11: false, 12: false } }, counts, side), 'wolf');
  assert.equal(E.winnerOf({ ...g, alive: { ...g.alive, 1: false, 2: false, 3: false, 4: false } }, counts, side), 'good');
  assert.equal(E.winnerOf(g, counts, side), null);
});

test('勝負（屠城）：神職全死還沒結束，好人全死才算', () => {
  const g = newGame().game;
  const counts = R.PRESETS[1].counts, all = { win: 'all' };
  assert.equal(E.winnerOf({ ...g, alive: { ...g.alive, 5: false, 6: false, 7: false, 8: false } }, counts, all), null);
  const dead = Object.fromEntries(Object.keys(g.alive).map(s => [s, Number(s) <= 4]));
  assert.equal(E.winnerOf({ ...g, alive: dead }, counts, all), 'wolf');
});

test('死掉的角色照樣唸、隨機假等（在設定範圍內）', () => {
  let r = playNight(newGame(), { wolf: 8 }); // 守衛死了
  r = E.nextNight(r, 1e6).room;
  r = runUntil(r, stepIs('guard'));
  assert.match(r.game.narration.text, /守衛請睜眼/);
  const wait = r.game.timer.at - r.game.night.openedAt;
  assert.ok(wait >= 8000 && wait <= 15000, `假等 ${wait} ms`);
  assert.equal(E.privateGame(r, 8).action, undefined, '死掉的守衛手機不會出現按鈕');
});

test('主機可以跳過卡住的步驟', () => {
  let r = toStep(newGame(), 'wolf');
  r = E.skipStep(r, 0, minRand).room;
  r = toStep(r, 'none');   // 其餘角色不動作，一路到天亮
  assert.equal(r.phase, 'day');
  assert.match(r.game.log.at(-1).text, /平安夜/);
});

test('畫面資料：公開資料沒有身分；不是自己回合拿不到按鈕；狼看得到隊友', () => {
  let r = toStep(newGame(), 'wolf');
  const pub = E.publicGame(r);
  assert.equal(pub.allRoles, undefined);
  assert.equal(JSON.stringify(pub).includes('"roles"'), false);
  assert.equal(pub.night.step, 'wolf');
  assert.equal(E.privateGame(r, 5).action, undefined, '預言家在狼人回合沒有按鈕');
  assert.equal(E.privateGame(r, 1).action.kind, 'wolf');
  assert.deepEqual(E.privateGame(r, 2).wolves.map(w => w.seat), [1, 2, 3, 4]);
  assert.equal(E.privateGame(r, 9).wolves, undefined, '平民看不到狼隊友');
});

test('結束後翻開所有人身分，可以再來一局（座位與板子保留）', () => {
  // 每天放逐一隻狼、晚上狼空刀：第 4 天放逐最後一隻（狼王）→ 好人贏
  let r = toStep(newGame(), 'none');
  for (const wolf of [1, 2, 3]) {
    r = E.exile(r, wolf).room;
    assert.equal(r.phase, 'day');
    r = toStep(E.nextNight(r, 1e6).room, 'none');
  }
  r = E.exile(r, 4).room;
  assert.equal(r.phase, 'ended');
  assert.equal(r.game.winner, 'good');
  assert.ok(E.publicGame(r).allRoles);
  const again = E.newGame(r).room;
  assert.equal(again.phase, 'lobby');
  assert.equal(again.game, undefined);
  assert.equal(Object.keys(again.seats).length, 12);
});
