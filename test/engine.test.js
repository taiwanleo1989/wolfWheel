import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/lobby.js';
import * as G from '../src/game.js';
import * as E from '../src/engine.js';
import * as R from '../public/shared/roles.js';
import { LINES, lineText } from '../public/shared/voice-lines.js';

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
const beatAct = r => E.scriptFor(r.game.night.steps[r.game.night.idx], r.setup.counts).beats[r.game.night.beat].act;
const waitingForPeople = r => r.phase === 'night' && r.game.night.stage === 'acting' && !r.game.timer;
// 把鬧鐘一路撥到條件成立（或沒有鬧鐘＝在等人）為止
function runUntil(r, pred) {
  for (let i = 0; i < 80 && !pred(r); i++) {
    if (!r.game.timer) break;
    r = E.advance(r, r.game.timer.at, minRand).room;
  }
  return r;
}
function act(r, seat, payload) {
  const res = E.nightAction(r, id(seat), payload, everyone(r), r.game.timer?.at ?? 1e9, minRand);
  assert.equal(res.ok, true, res.error);
  return res.room;
}
const atAct = a => r => waitingForPeople(r) && beatAct(r) === a;
// 一路往下走：遇到在等人的台詞，就照 plan 動作（沒指定就是「不動作」），直到 stop 成立或天亮
function play(r, plan = {}, stop = x => x.phase !== 'night') {
  for (let i = 0; i < 40; i++) {
    r = runUntil(r, x => stop(x) || waitingForPeople(x));
    if (stop(r) || r.phase !== 'night') return r;
    const a = beatAct(r);
    const who = E.actors(r.game, r.game.night.steps[r.game.night.idx]);
    if (a === 'guard') r = act(r, who[0], { target: plan.guard ?? 0 });
    if (a === 'wolf') { for (const w of who) r = act(r, w, { target: plan.wolf ?? 0 }); r = act(r, who[0], { confirm: true }); }
    if (a === 'witchSave') r = act(r, who[0], { use: plan.save ? 'save' : 'skip' });
    if (a === 'witchPoison') r = act(r, who[0], plan.poison ? { use: 'poison', target: plan.poison } : { use: 'none' });
    if (a === 'seer') {
      const t = plan.seer ?? Object.keys(r.game.alive).map(Number).find(s => r.game.alive[s] && s !== who[0]);
      r = act(r, who[0], { target: t }); r = act(r, who[0], { done: true });
    }
    if (a === 'hunter') r = act(r, who[0], { seen: true });
  }
  return r;
}
// 跑完一晚並進入白天（第一天的死訊直接公布）
function night(r, plan) {
  r = play(r, plan);
  if (r.phase === 'day' && r.game.day.pendingDeaths) r = E.announceDeaths(r).room;
  return r;
}

test('黑夜順序照手稿：守衛→狼人→女巫→預言家→獵人；第一晚最後上警', () => {
  assert.deepEqual(newGame().game.night.steps, ['guard', 'wolf', 'witch', 'seer', 'hunter', 'police']);
  assert.deepEqual(newGame('yu-nv-lie-bai').game.night.steps, ['wolf', 'witch', 'seer', 'hunter', 'police']);
  const second = E.nextNight(night(newGame()), 1e6).room;
  assert.deepEqual(second.game.night.steps, ['guard', 'wolf', 'witch', 'seer', 'hunter'], '第二晚起沒有上警');
});

test('台詞照手稿：天黑請閉眼、狼王請確認身分（有狼王才唸）、女巫分兩段、上警、天亮請睜眼', () => {
  let r = newGame();
  let seq = 0;
  const lines = [];
  for (let i = 0; i < 80 && r.phase === 'night'; i++) {
    if (r.game.narration.seq !== seq) { seq = r.game.narration.seq; lines.push(r.game.narration.text); }
    if (waitingForPeople(r)) r = play(r, {}, x => x.game?.narration?.seq !== seq);
    else r = E.advance(r, r.game.timer.at, minRand).room;
  }
  lines.push(r.game.narration.text);
  assert.equal(lines[0], '天黑請閉眼。');
  assert.ok(lines.includes('守衛請睜眼。請選擇今晚要守護的玩家。'));
  assert.ok(lines.includes('狼人請睜眼。狼王請確認身分。今晚要擊殺的目標是？'));
  assert.ok(lines.includes('女巫請睜眼。今晚死亡的玩家是——請問你要使用解藥嗎？'));
  assert.ok(lines.includes('請問你要使用毒藥嗎？如果要，請選擇你要毒殺的號碼。'));
  assert.ok(lines.includes('預言家請睜眼。請問你今晚要查驗的玩家是？'));
  assert.ok(lines.includes('獵人請睜眼。獵人，你今晚的帶槍手勢是——'));
  assert.ok(lines.includes('要上警的玩家請起立。'));
  assert.equal(lines.at(-1), '天亮請睜眼。');
  assert.ok(lines.every(l => !/\d+ 號/.test(l)), '主機的台詞不能唸出任何號碼');
  assert.deepEqual(E.scriptFor('wolf', R.PRESETS[0].counts).beats[0].say, ['wolfOpen'], '沒有狼王的板子不唸狼王');
});

test('狼人：全體一致才出現確認；按「正確」才算數；「重選」清掉', () => {
  let r = play(newGame(), {}, atAct('wolf'));
  r = act(r, 1, { target: 9 });
  r = act(r, 2, { target: 10 });
  assert.equal(r.game.night.wolfProposal, null);
  assert.equal(E.nightAction(r, id(1), { confirm: true }, everyone(r), 0, minRand).ok, false, '還沒統一不能確認');
  for (const w of [1, 2, 3, 4]) r = act(r, w, { target: 9 });
  assert.equal(r.game.night.wolfProposal, 9);
  assert.equal(r.game.night.stage, 'acting', '統一了也要按正確');
  assert.equal(E.privateGame(r, 2).action.proposal, 9);
  const reset = act(r, 3, { reset: true });
  assert.equal(reset.game.night.wolfProposal, null);
  assert.deepEqual(reset.game.night.wolfVotes, {});
  r = act(r, 4, { confirm: true });
  assert.equal(r.game.night.stage, 'pause');
  assert.equal(r.game.night.wolfTarget, 9);
});

test('狼刀沒人救 → 死；女巫救 → 平安夜；守衛守 → 活；同守同救 → 死', () => {
  assert.equal(night(newGame(), { wolf: 9 }).game.alive[9], false);
  const saved = night(newGame(), { wolf: 9, save: true });
  assert.equal(saved.game.alive[9], true);
  assert.match(saved.game.log.at(-1).text, /平安夜/);
  assert.equal(night(newGame(), { guard: 9, wolf: 9 }).game.alive[9], true);
  assert.equal(night(newGame(), { guard: 9, wolf: 9, save: true }).game.alive[9], false);
});

test('守衛不能連續兩晚守同一人', () => {
  let r = night(newGame(), { guard: 9, wolf: 10 });
  r = play(E.nextNight(r, 1e6).room, {}, atAct('guard'));
  assert.equal(E.nightAction(r, id(8), { target: 9 }, everyone(r), 0, minRand).ok, false);
  assert.equal(E.nightAction(r, id(8), { target: 11 }, everyone(r), 0, minRand).ok, true);
});

test('女巫（預設）：不能救自己；手機上會說明', () => {
  let r = play(newGame(), { wolf: 6 }, atAct('witchSave'));
  const a = E.privateGame(r, 6).action;
  assert.equal(a.kind, 'witchSave');
  assert.equal(a.victim, 6);
  assert.equal(a.canSave, false);
  assert.equal(a.selfBlocked, true);
  assert.equal(E.nightAction(r, id(6), { use: 'save' }, everyone(r), 0, minRand).ok, false);
  // 設定改成「只有第一晚」就可以
  r = play(newGame('lang-wang-shou-wei', { witchSelfSave: 'first' }), { wolf: 6 }, atAct('witchSave'));
  assert.equal(E.privateGame(r, 6).action.canSave, true);
});

test('女巫：一晚只能一瓶；解藥用掉後不告知死亡號碼；不能毒自己', () => {
  let r = play(newGame(), { wolf: 9 }, atAct('witchSave'));
  r = act(r, 6, { use: 'save' });
  r = runUntil(r, atAct('witchPoison'));
  assert.equal(E.privateGame(r, 6).action.canPoison, false);
  assert.equal(E.privateGame(r, 6).action.savedTonight, true);
  assert.equal(E.nightAction(r, id(6), { use: 'poison', target: 1 }, everyone(r), 0, minRand).ok, false);
  r = act(r, 6, { use: 'none' });
  r = night(r);
  r = play(E.nextNight(r, 1e6).room, { wolf: 10 }, atAct('witchSave'));
  const a = E.privateGame(r, 6).action;
  assert.equal(a.victim, null);
  assert.equal(a.saveUsedUp, true);
  r = act(r, 6, { use: 'skip' });
  r = runUntil(r, atAct('witchPoison'));
  assert.equal(E.nightAction(r, id(6), { use: 'poison', target: 6 }, everyone(r), 0, minRand).ok, false);
  r = act(r, 6, { use: 'poison', target: 1 });
  assert.equal(r.game.night.witchPoison, 1);
});

test('預言家：查驗結果，狼王也算狼', () => {
  let r = play(newGame(), {}, atAct('seer'));
  r = act(r, 5, { target: 4 });
  assert.equal(E.privateGame(r, 5).action.checked.wolf, true);
  assert.equal(E.nightAction(r, id(5), { target: 9 }, everyone(r), 0, minRand).ok, false, '一晚只能查一個');
  r = act(r, 5, { done: true });
  r = night(r);
  assert.deepEqual(E.privateGame(r, 5).seerChecks.map(c => [c.target, c.wolf]), [[4, true]]);
});

test('獵人夜裡的帶槍手勢：被毒 👎、沒被毒 👍', () => {
  let r = play(newGame(), { poison: 7 }, atAct('hunter'));
  assert.equal(E.privateGame(r, 7).action.canShoot, false);
  r = play(newGame(), {}, atAct('hunter'));
  assert.equal(E.privateGame(r, 7).action.canShoot, true);
});

test('上警：沒人要動作，計時到（或主機按繼續）就天亮', () => {
  let r = play(newGame(), {}, x => x.phase === 'night' && E.scriptFor(x.game.night.steps[x.game.night.idx], x.setup.counts)?.beats[x.game.night.beat]?.act === null && x.game.night.stage === 'acting');
  assert.equal(r.game.narration.text, '要上警的玩家請起立。');
  assert.equal(r.game.timer.at - r.game.night.openedAt, E.POLICE_MS);
  r = E.skipStep(r, r.game.night.openedAt + 1000, minRand).room;  // 主機：大家都好了
  r = runUntil(r, x => x.phase !== 'night');
  assert.equal(r.phase, 'day');
  assert.equal(r.game.narration.text, '天亮請睜眼。');
});

test('上警可以關掉：第一晚唸完獵人直接天亮，死訊馬上公布', () => {
  let r = newGame('lang-wang-shou-wei', { police: false });
  assert.deepEqual(r.game.night.steps, ['guard', 'wolf', 'witch', 'seer', 'hunter']);
  r = play(r, { wolf: 9 });
  assert.equal(r.phase, 'day');
  assert.equal(r.game.day.pendingDeaths, null);
  assert.equal(r.game.alive[9], false);
  assert.match(r.game.narration.text, /天亮請睜眼。昨晚死亡的是 9 號/);
  assert.equal(E.exile(r, 1).ok, true, '不用等公布，可以直接放逐');
});

test('第一天：警長選完才公布死訊；公布前座位表不顯示誰死、不能放逐、不能天黑', () => {
  let r = play(newGame(), { wolf: 9 });
  assert.equal(r.phase, 'day');
  assert.equal(r.game.alive[9], true, '還沒公布');
  assert.equal(E.publicGame(r).deathsPending, true);
  assert.equal(JSON.stringify(E.publicGame(r)).includes('pendingDeaths'), false, '死者名單不能先送出去');
  assert.equal(E.exile(r, 1).ok, false);
  assert.equal(E.nextNight(r, 1e6).ok, false);
  r = E.announceDeaths(r).room;
  assert.equal(r.game.alive[9], false);
  assert.match(r.game.log.at(-1).text, /昨晚死亡的是 9 號/);
  // 第二天起天亮就公布
  r = play(E.nextNight(r, 1e6).room, { wolf: 10 });
  assert.equal(r.game.alive[10], false);
  assert.match(r.game.narration.text, /天亮請睜眼。昨晚死亡的是 10 號/);
});

test('獵人被刀可以開槍，被毒不能；被槍帶走的狼王還能再開槍', () => {
  let r = night(newGame(), { wolf: 7 });
  assert.equal(E.privateGame(r, 7).canShoot, true);
  r = E.shoot(r, id(7), 4).room;
  assert.equal(r.game.alive[4], false);
  assert.equal(E.privateGame(r, 4).canShoot, true, '狼王被槍帶走也能開槍');
  const poisoned = night(newGame(), { poison: 7 });
  assert.equal(poisoned.game.alive[7], false);
  assert.equal(E.privateGame(poisoned, 7).canShoot, undefined);
});

test('白癡被放逐翻牌免死；再被放逐才會出局', () => {
  let r = night(newGame('yu-nv-lie-bai')); // 預女獵白：1–4 狼、5 預、6 女、7 獵、8 白癡
  r = E.exile(r, 8).room;
  assert.equal(r.game.alive[8], true);
  assert.deepEqual(r.game.idiotRevealed, [8]);
  assert.equal(E.exile(r, 9).ok, false, '一天只能放逐一次');
  r = night(E.nextNight(r, 1e6).room);
  r = E.exile(r, 8).room;
  assert.equal(r.game.alive[8], false);
});

test('騎士決鬥：對狼 → 狼出局；對好人 → 騎士出局；只能用一次', () => {
  // 狼王騎士：1–3 狼、4 狼王、5 預、6 女、7 獵、8 騎士、9–12 民
  const r = night(newGame('lang-wang-qi-shi'));
  assert.equal(E.privateGame(r, 8).canDuel, true);
  let d = E.duel(r, id(8), 2).room;
  assert.equal(d.game.alive[2], false);
  assert.equal(E.duel(d, id(8), 3).ok, false);
  d = E.duel(r, id(8), 9).room;
  assert.equal(d.game.alive[8], false);
  assert.equal(d.game.alive[9], true);
});

test('勝負（屠邊／屠城）', () => {
  const g = newGame().game;
  const counts = R.PRESETS[1].counts, side = { win: 'side' }, all = { win: 'all' };
  const dead = seats => ({ ...g, alive: { ...g.alive, ...Object.fromEntries(seats.map(s => [s, false])) } });
  assert.equal(E.winnerOf(dead([5, 6, 7, 8]), counts, side), 'wolf');
  assert.equal(E.winnerOf(dead([9, 10, 11, 12]), counts, side), 'wolf');
  assert.equal(E.winnerOf(dead([1, 2, 3, 4]), counts, side), 'good');
  assert.equal(E.winnerOf(g, counts, side), null);
  assert.equal(E.winnerOf(dead([5, 6, 7, 8]), counts, all), null);
  assert.equal(E.winnerOf(dead([5, 6, 7, 8, 9, 10, 11, 12]), counts, all), 'wolf');
});

test('死掉的角色照樣唸、隨機假等（在設定範圍內），手機不會出現按鈕', () => {
  let r = night(newGame(), { wolf: 8 }); // 守衛死了
  r = E.nextNight(r, 1e6).room;
  r = runUntil(r, x => x.game.night.stage === 'acting' && x.game.night.steps[x.game.night.idx] === 'guard');
  assert.match(r.game.narration.text, /守衛請睜眼/);
  const wait = r.game.timer.at - r.game.night.openedAt;
  assert.ok(wait >= 8000 && wait <= 15000, `假等 ${wait} ms`);
  assert.equal(E.privateGame(r, 8).action, undefined);
  // 女巫死了：兩句台詞都照唸、各自假等
  let w = night(newGame(), { wolf: 6 });
  w = E.nextNight(w, 1e6).room;
  const said = [];
  for (let i = 0; i < 40 && w.phase === 'night'; i++) {
    if (said.at(-1) !== w.game.narration.text) said.push(w.game.narration.text);
    w = waitingForPeople(w) ? play(w, {}, x => x.game?.narration?.text !== w.game.narration.text) : E.advance(w, w.game.timer.at, minRand).room;
  }
  assert.ok(said.includes('請問你要使用毒藥嗎？如果要，請選擇你要毒殺的號碼。'), '死掉的女巫第二句也要唸');
});

test('主機可以跳過卡住的步驟', () => {
  let r = play(newGame(), {}, atAct('wolf'));
  r = E.skipStep(r, 0, minRand).room;
  r = night(r);
  assert.equal(r.phase, 'day');
  assert.match(r.game.log.at(-1).text, /平安夜/);
});

test('畫面資料：公開資料沒有身分；不是自己回合拿不到按鈕；狼看得到隊友', () => {
  const r = play(newGame(), {}, atAct('wolf'));
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
  let r = night(newGame());
  for (const wolf of [1, 2, 3]) {
    r = E.exile(r, wolf).room;
    assert.equal(r.phase, 'day');
    r = night(E.nextNight(r, 1e6).room);
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

test('每一句台詞都由片段表組成：沒有缺片段、文字和片段一致（主機才播得出錄好的聲音）', () => {
  const seen = [];
  const collect = r => { const n = r.game?.narration; if (n && seen.at(-1)?.seq !== n.seq) seen.push(n); };
  // 打一整局：守衛守、狼刀、女巫毒、獵人開槍、放逐、白癡翻牌、騎士決鬥都走一遍
  for (const preset of ['lang-wang-shou-wei', 'yu-nv-lie-bai', 'lang-wang-qi-shi']) {
    let r = newGame(preset);
    for (let day = 0; day < 6 && r.phase !== 'ended'; day++) {
      for (let i = 0; i < 80 && r.phase === 'night'; i++) {
        collect(r);
        const alive = t => r.game.alive[t];
        const wolfTarget = (day === 0 ? [7] : [9, 10, 11, 12, 5, 6]).find(alive) ?? 0;
        const poison = day === 1 ? ([10, 11, 12].find(t => alive(t) && t !== wolfTarget) ?? 0) : 0;
        r = waitingForPeople(r) ? play(r, { wolf: wolfTarget, poison }, x => x.game?.narration?.seq !== r.game.narration.seq) : E.advance(r, r.game.timer.at, minRand).room;
      }
      collect(r);
      if (r.phase === 'day' && r.game.day.pendingDeaths) { r = E.announceDeaths(r).room; collect(r); }
      if (r.phase !== 'day') break;
      while (r.phase === 'day' && r.game.canShoot.length) {
        const s = r.game.canShoot[0];
        const res = E.shoot(r, id(s), Object.keys(r.game.alive).map(Number).find(t => r.game.alive[t] && t !== s));
        assert.equal(res.ok, true, res.error);
        r = res.room; collect(r);
      }
      if (r.phase !== 'day') break;
      if (preset === 'lang-wang-qi-shi' && day === 0 && r.game.alive[8]) {
        const res = E.duel(r, id(8), [1, 2, 3, 4].find(w => r.game.alive[w]));
        assert.equal(res.ok, true, res.error);
        r = res.room; collect(r);
      }
      if (r.phase !== 'day') break;
      r = E.exile(r, day === 0 && preset === 'yu-nv-lie-bai' ? 8 : [1, 2, 3, 4].find(w => r.game.alive[w]) ?? 0).room; collect(r);
      if (r.phase === 'day') r = E.nextNight(r, 1e6).room;
    }
  }
  assert.ok(seen.length > 40, `收集到 ${seen.length} 句`);
  for (const n of seen) {
    assert.ok(Array.isArray(n.clips) && n.clips.length, `沒有片段：${n.text}`);
    for (const k of n.clips) assert.ok(k in LINES, `片段表缺：${k}`);
    assert.equal(n.text, lineText(n.clips));
  }
  const texts = seen.map(n => n.text);
  for (const re of [/被放逐出局/, /發動技能，帶走了/, /翻牌，是白癡/, /騎士 8 號決鬥 \d+ 號/, /遊戲結束/]) assert.ok(texts.some(t => re.test(t)), `沒走到：${re}`);
});
