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

// 測試用的板子（網頁上已經沒有預設板子，Leo 2026-10-11）
const BOARDS = {
  'lang-wang-shou-wei': { wolf: 3, king: 1, seer: 1, witch: 1, hunter: 1, guard: 1, villager: 4 },
  'yu-nv-lie-bai': { wolf: 4, seer: 1, witch: 1, hunter: 1, idiot: 1, villager: 4 },
  'lang-wang-qi-shi': { wolf: 3, king: 1, seer: 1, witch: 1, hunter: 1, knight: 1, villager: 4 },
};
function newGame(preset = 'lang-wang-shou-wei', rules = {}) {
  const counts = typeof preset === 'string' ? BOARDS[preset] : preset;
  const players = R.totalOf(counts);
  let r = L.newRoom('1234', players, 'host', 0);
  for (let n = 1; n <= players; n++) r = L.claimSeat(r, id(n), n, new Set()).room;
  r = G.setSetup(r, { counts, rules }).room;
  r = G.startDeal(r, noShuffle).room;
  return E.startGame(r, 0, minRand).room;
}
const everyone = r => new Set(Object.values(r.seats));
const beatAct = r => E.scriptFor(r.game.night.steps[r.game.night.idx], r.setup.counts).beats[r.game.night.beat].act;
const waitingForPeople = r => r.phase === 'night' && r.game.night.stage === 'acting' && r.game.night.wait === 'people';
// 把鬧鐘一路撥到條件成立（或在等活著的人＝鬧鐘只是「重唸」）為止
function runUntil(r, pred) {
  for (let i = 0; i < 80 && !pred(r); i++) {
    if (!r.game.timer || waitingForPeople(r)) break;
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
  assert.deepEqual(E.scriptFor('wolf', BOARDS['yu-nv-lie-bai']).beats[0].say, ['wolfOpen'], '沒有狼王的板子不唸狼王');
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
  assert.equal(r.game.narration.text, '7 號發動技能，帶走了 4 號。', '主機唸出帶走誰（Leo 2026-10-10 實玩）');
  assert.equal(r.game.log.at(-1).text, '7 號發動技能，帶走了 4 號。');
  assert.equal(E.privateGame(r, 4).canShoot, true, '狼王被槍帶走也能開槍');
  const poisoned = night(newGame(), { poison: 7 });
  assert.equal(poisoned.game.alive[7], false);
  assert.equal(E.privateGame(poisoned, 7).canShoot, undefined);
});

test('白癡被放逐：自己選翻牌（免死）或不翻（出局）；選之前不能天黑；翻過再被放逐直接出局', () => {
  let r = night(newGame('yu-nv-lie-bai')); // 預女獵白：1–4 狼、5 預、6 女、7 獵、8 白癡
  const seq = r.game.narration.seq;
  r = E.exile(r, 8).room;
  assert.equal(r.game.alive[8], true);
  assert.equal(r.game.narration.seq, seq, '選之前主機不唸結果');
  assert.equal(E.publicGame(r).idiotChoice, 8);
  assert.equal(E.privateGame(r, 8).idiotChoose, true);
  assert.equal(E.privateGame(r, 9).idiotChoose, undefined);
  assert.equal(E.nextNight(r, 1e6).ok, false, '等白癡選完才能天黑');
  assert.equal(E.idiotChoose(r, id(9), true).ok, false, '別人不能替他選');
  const out = E.idiotChoose(r, id(8), false).room;
  assert.equal(out.game.alive[8], false, '不翻牌＝出局');
  assert.match(out.game.narration.text, /8 號被放逐出局/);
  r = E.idiotChoose(r, id(8), true).room;
  assert.equal(r.game.alive[8], true);
  assert.deepEqual(r.game.idiotRevealed, [8]);
  assert.match(r.game.narration.text, /翻牌，是白癡/);
  assert.equal(E.exile(r, 9).ok, false, '一天只能放逐一次');
  r = night(E.nextNight(r, 1e6).room);
  r = E.exile(r, 8).room;
  assert.equal(r.game.alive[8], false, '翻過牌的白癡再被放逐就出局，不用再選');
  assert.equal(E.idiotChooseByHost, undefined, '主機不能代按');
});

test('白天技能不限時（Leo 2026-10-10 拿掉 30 秒、10-11 拆掉計時機制）：白天沒有鬧鐘，一直等本人按', () => {
  assert.equal(E.SKILL_MS, undefined, '白天的計時常數已經拆掉');
  let r = E.exile(night(newGame('yu-nv-lie-bai')), 8, 1000).room;
  assert.equal(r.game.timer, null);
  assert.equal(E.advance(r, 1e12, minRand).room.game.day.idiotChoice, 8, '過再久都還在等白癡');
  let h = night(newGame(), { wolf: 7 });
  assert.equal(h.game.timer, null);
  assert.equal(E.privateGame(E.advance(h, 1e12, minRand).room, 7).canShoot, true, '過再久獵人都還能開槍');
  let k = E.duel(night(newGame('lang-wang-qi-shi')), id(8), 4, 5000).room;
  assert.equal(k.game.timer, null);
  assert.equal(k.game.narration.text, '騎士 8 號決鬥 4 號：4 號是狼人，出局！', '狼王還沒決定，不唸天黑');
  assert.equal(JSON.stringify(E.publicGame(k)).includes('"due"'), false);
});

test('騎士決鬥：對狼 → 狼出局、唸天黑請閉眼、不能放逐，主機按了才進黑夜（不再唸一次）；對好人 → 騎士出局、繼續投票；只能用一次', () => {
  // 狼王騎士：1–3 狼、4 狼王、5 預、6 女、7 獵、8 騎士、9–12 民
  const r = night(newGame('lang-wang-qi-shi'));
  assert.equal(E.privateGame(r, 8).canDuel, true);
  let d = E.duel(r, id(8), 2).room;
  assert.equal(d.game.alive[2], false);
  assert.equal(d.phase, 'day', '主機還沒按，不會自己進黑夜');
  assert.match(d.game.narration.text, /是狼人，出局！天黑請閉眼。$/);
  assert.equal(E.publicGame(d).nightCalled, true);
  assert.equal(E.exile(d, 9).ok, false, '撞到狼就不放逐');
  assert.equal(E.duel(d, id(8), 3).ok, false);
  const seq = d.game.narration.seq;
  const n = E.nextNight(d, 1e6).room;
  assert.equal(n.phase, 'night');
  assert.equal(n.game.narration.seq, seq, '天黑請閉眼剛唸過，不重唸');
  d = E.duel(r, id(8), 9).room;
  assert.equal(d.game.alive[8], false);
  assert.equal(d.game.alive[9], true);
  assert.equal(E.publicGame(d).nightCalled, false);
  assert.equal(E.exile(d, 1).ok, true, '撞到好人繼續投票');
});

test('騎士撞到狼王：狼王先開槍，開完（或不開）才唸天黑請閉眼；按進入黑夜不重唸', () => {
  const r = night(newGame('lang-wang-qi-shi')); // 4 號狼王、8 號騎士
  let d = E.duel(r, id(8), 4).room;
  assert.equal(d.game.narration.text, '騎士 8 號決鬥 4 號：4 號是狼人，出局！', '狼王還要開槍，先不唸天黑');
  assert.equal(E.privateGame(d, 4).canShoot, true);
  const shot = E.shoot(d, id(4), 9).room;
  assert.equal(shot.game.narration.text, '4 號發動技能，帶走了 9 號。天黑請閉眼。');
  assert.equal(E.nextNight(shot, 1e6).room.game.narration.seq, shot.game.narration.seq, '不重唸');
  const pass = E.shoot(d, id(4), 0).room;
  assert.equal(pass.game.narration.text, '天黑請閉眼。', '狼王不開槍也要唸');
  // 狼王還沒開槍主機就按了：照常唸天黑請閉眼
  const early = E.nextNight(d, 1e6).room;
  assert.equal(early.game.narration.text, '天黑請閉眼。');
});

test('騎士只能在投票放逐之前、沒人等開槍時決鬥（Leo 2026-10-14 選 1A，跟白狼王自爆同一套）', () => {
  // 1–3 狼、4 狼王、5 預、6 女、7 獵、8 騎士、9–12 民
  const r = night(newGame('lang-wang-qi-shi'));
  const ex = E.exile(r, 9).room;
  assert.equal(E.duel(ex, id(8), 2).ok, false, '投票放逐後');
  assert.equal(E.privateGame(ex, 8).canDuel, undefined);
  const tie = E.exile(r, 0).room;
  assert.equal(E.duel(tie, id(8), 2).ok, false, '平票也算投完票');
  const h = night(newGame('lang-wang-qi-shi'), { wolf: 7 }); // 刀獵人
  assert.deepEqual(h.game.canShoot, [7]);
  assert.equal(E.duel(h, id(8), 2).ok, false, '獵人還沒開槍');
  assert.equal(E.privateGame(h, 8).canDuel, undefined);
  assert.equal(E.privateGame(E.shoot(h, id(7), 0).room, 8).canDuel, true, '槍開完就可以');
});

test('遊戲結束時，造成結束的那句台詞和「遊戲結束」接在一起唸（不會被蓋掉）', () => {
  let r = night(newGame());
  for (const wolf of [1, 2, 3]) r = night(E.nextNight(E.exile(r, wolf).room, 1e6).room);
  r = E.exile(r, 4).room;
  assert.equal(r.phase, 'ended');
  assert.equal(r.game.narration.text, '4 號被放逐出局。遊戲結束，好人陣營獲勝！');
  assert.equal(r.game.log.at(-1).text, '遊戲結束，好人陣營獲勝！');
  assert.equal(r.game.log.at(-2).text, '4 號被放逐出局。');
});

test('勝負（屠邊／屠城）', () => {
  const g = newGame().game;
  const counts = BOARDS['lang-wang-shou-wei'], side = { win: 'side' }, all = { win: 'all' };
  const dead = seats => ({ ...g, alive: { ...g.alive, ...Object.fromEntries(seats.map(s => [s, false])) } });
  assert.equal(E.winnerOf(dead([5, 6, 7, 8]), counts, side), 'wolf');
  assert.equal(E.winnerOf(dead([9, 10, 11, 12]), counts, side), 'wolf');
  assert.equal(E.winnerOf(dead([1, 2, 3, 4]), counts, side), 'good');
  assert.equal(E.winnerOf(g, counts, side), null);
  assert.equal(E.winnerOf(dead([5, 6, 7, 8]), counts, all), null);
  assert.equal(E.winnerOf(dead([5, 6, 7, 8, 9, 10, 11, 12]), counts, all), 'wolf');
  // 同一個動作兩邊同時達成（例如同一晚刀死最後一個神、毒死最後一隻狼）→ 狼人勝（Leo 2026-10-14 選 3B）
  assert.equal(E.winnerOf(dead([1, 2, 3, 4, 5, 6, 7, 8]), counts, side), 'wolf');
  assert.equal(E.winnerOf(dead([1, 2, 3, 4, 9, 10, 11, 12]), counts, side), 'wolf');
  assert.equal(E.winnerOf(dead([1, 2, 3, 4, 5, 6, 7, 8]), counts, all), 'good', '屠城：好人還有平民，狼死光＝好人勝');
});

test('同一晚刀死最後一個神、毒死最後一隻狼（屠邊）：狼人勝（Leo 2026-10-14 選 3B）', () => {
  // 1 狼、2 預、3 女、4–5 民；預言家先死，剩女巫一個神
  let r = night(newGame({ wolf: 1, seer: 1, witch: 1, villager: 2 }, { police: false }), { wolf: 2 });
  assert.equal(r.phase, 'day');
  r = E.exile(r, 4).room; // 剩 1 狼、3 女、5 民：女巫還有藥，不提早判
  assert.equal(r.phase, 'day');
  r = night(E.nextNight(r, 1e6).room, { wolf: 3, poison: 1 });
  assert.equal(r.phase, 'ended');
  assert.equal(r.game.winner, 'wolf');
  assert.equal(r.game.narration.text, '天亮請睜眼。昨晚死亡的是 1 號、3 號。遊戲結束，狼人陣營獲勝！');
});

test('提早獲勝看翻盤機會（Leo 2026-10-14 選 2A、4B）：翻過牌的白癡沒有票；女巫還有藥、守衛、獵人活著、騎士還沒決鬥 → 不提早判', () => {
  const mk = (roles, extra = {}) => ({
    roles: Object.fromEntries(roles.map((r, i) => [i + 1, r])),
    alive: Object.fromEntries(roles.map((_, i) => [i + 1, true])),
    idiotRevealed: [], potions: { save: false, poison: false }, knightUsed: false, canShoot: [],
    day: { bindCheck: true, exileDone: false }, ...extra,
  });
  // 綁票
  assert.equal(E.houseRuleWin(mk(['wolf', 'wolf', 'seer', 'villager'])), 'bind');
  assert.equal(E.houseRuleWin(mk(['wolf', 'wolf', 'idiot', 'villager', 'villager'])), null, '2 狼對 3 票');
  assert.equal(E.houseRuleWin(mk(['wolf', 'wolf', 'idiot', 'villager', 'villager'], { idiotRevealed: [3] })), 'bind', '白癡翻過牌沒有票：2 對 2');
  // 綁票只等「打得破」的（Leo 2026-10-14 綁票選 A）：好人白天投不贏、晚上每刀少一個，
  // 狼剛好等於好人票數時，騎士還沒決鬥、或守衛活著＋女巫還有毒藥，才可能讓狼變少而好人不變
  assert.equal(E.houseRuleWin(mk(['wolf', 'wolf', 'knight', 'villager'])), null, '騎士還沒決鬥（2 對 2）');
  assert.equal(E.houseRuleWin(mk(['wolf', 'wolf', 'knight', 'villager'], { knightUsed: true })), 'bind', '騎士用過了');
  assert.equal(E.houseRuleWin(mk(['wolf', 'wolf', 'wolf', 'knight', 'villager'])), 'bind', '3 對 2：撞死一隻還是綁票');
  assert.equal(E.houseRuleWin(mk(['wolf', 'wolf', 'guard', 'witch'], { potions: { save: false, poison: true } })), null, '守衛＋毒藥');
  assert.equal(E.houseRuleWin(mk(['wolf', 'wolf', 'guard', 'witch'], { potions: { save: true, poison: false } })), 'bind', '守衛＋只有解藥：只能拖延');
  assert.equal(E.houseRuleWin(mk(['wolf', 'wolf', 'witch', 'villager'], { potions: { save: true, poison: true } })), 'bind', '只有女巫：毒一隻、刀一個，比例不變');
  assert.equal(E.houseRuleWin(mk(['wolf', 'wolf', 'guard', 'villager'])), 'bind', '只有守衛：只能拖延');
  assert.equal(E.houseRuleWin(mk(['wolf', 'wolf', 'hunter', 'villager'])), 'bind', '獵人：帶走一隻＝一換一');
  const deadGuard = mk(['wolf', 'wolf', 'guard', 'witch', 'villager'], { potions: { save: false, poison: true } });
  deadGuard.alive[3] = false;
  assert.equal(E.houseRuleWin(deadGuard), 'bind', '守衛死了，只剩毒藥');
  // 一狼一神一民
  const vote = { day: { bindCheck: false, exileDone: true } };
  assert.equal(E.houseRuleWin(mk(['wolf', 'seer', 'villager'], vote)), 'lastThree');
  assert.equal(E.houseRuleWin(mk(['wolf', 'guard', 'villager'], vote)), null, '守衛');
  assert.equal(E.houseRuleWin(mk(['wolf', 'witch', 'villager'], { ...vote, potions: { save: true, poison: false } })), null, '女巫有藥');
  assert.equal(E.houseRuleWin(mk(['wolf', 'witch', 'villager'], vote)), 'lastThree', '女巫沒藥');
  // 屠邊：今晚狼隨便刀一個就贏，只有擋得住這一刀的（守衛、解藥）才算翻盤機會（Leo 2026-10-14 選 A）
  const side = { win: 'side' }, all = { win: 'all' };
  assert.equal(E.houseRuleWin(mk(['wolf', 'witch', 'villager'], { ...vote, potions: { save: false, poison: true } }), side), 'lastThree', '屠邊：只剩毒藥擋不住刀');
  assert.equal(E.houseRuleWin(mk(['wolf', 'hunter', 'villager'], vote), side), 'lastThree', '屠邊：刀平民就贏，獵人沒機會開槍');
  assert.equal(E.houseRuleWin(mk(['wolf', 'knight', 'villager'], vote), side), 'lastThree', '屠邊：天亮前就分出勝負');
  assert.equal(E.houseRuleWin(mk(['wolf', 'guard', 'villager'], vote), side), null, '屠邊：守衛擋得住');
  assert.equal(E.houseRuleWin(mk(['wolf', 'witch', 'villager'], { ...vote, potions: { save: true, poison: false } }), side), null, '屠邊：解藥擋得住');
  // 屠城：刀一個還剩一對一，獵人、騎士、毒藥都能翻盤
  assert.equal(E.houseRuleWin(mk(['wolf', 'witch', 'villager'], { ...vote, potions: { save: false, poison: true } }), all), null, '屠城：毒藥');
  assert.equal(E.houseRuleWin(mk(['wolf', 'hunter', 'villager'], vote), all), null, '屠城：獵人');
  assert.equal(E.houseRuleWin(mk(['wolf', 'knight', 'villager'], vote), all), null, '屠城：騎士');
  assert.equal(E.houseRuleWin(mk(['wolf', 'seer', 'villager'], vote), all), 'lastThree', '屠城：沒有翻盤技能');
  // 走完整流程（checkWin 有把房間的屠邊／屠城帶進來）：1 狼、2 預、3 獵、4–5 民；刀預言家、放逐 4 號 → 剩狼、獵人、平民
  for (const [win, phase] of [['side', 'ended'], ['all', 'day']]) {
    const e2e = E.exile(night(newGame({ wolf: 1, seer: 1, hunter: 1, villager: 2 }, { win, police: false }), { wolf: 2 }), 4).room;
    assert.equal(e2e.phase, phase, `${win}：剩一狼、獵人、平民`);
  }
  // 綁票屠邊屠城一樣
  assert.equal(E.houseRuleWin(mk(['wolf', 'wolf', 'hunter', 'villager']), all), 'bind', '屠城綁票：獵人一換一');
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

test('角色的步驟不限時；主機要等角色睜眼 30 秒才能跳過（當作沒動作）；公開資料只說「眼睛睜著」，不說做完沒', () => {
  let r = play(newGame(), {}, atAct('wolf'));
  assert.equal(r.game.night.wait, 'people', '活著的狼人一直等（鬧鐘只用來重唸台詞）');
  assert.equal(E.advance(r, 1e12, minRand).room.game.night.stage, 'acting', '過再久都還在等狼人');
  for (const w of [1, 2, 3, 4]) r = act(r, w, { target: 9 }); // 統一了但沒人按「正確」
  const t0 = r.game.night.openedAt;
  assert.equal(E.skipStep(r, t0 + E.SKIP_MS - 1, minRand).ok, false, '還不到 30 秒');
  assert.equal(E.publicGame(r).night.eyesOpen, true);
  const s = E.skipStep(r, t0 + E.SKIP_MS, minRand).room;
  assert.equal(s.game.night.stage, 'pause');
  assert.equal(E.publicGame(s).night.eyesOpen, true, '做完後的停頓也算睜眼，按鈕不會提早消失');
  assert.equal(night(s).game.log.at(-1).text.includes('平安夜'), true, '狼人被跳過＝空刀');
  // 死掉的角色假等最多 15 秒，30 秒的跳過永遠輪不到
  let d = E.nextNight(night(newGame(), { wolf: 8 }), 1e6).room; // 守衛死了
  d = runUntil(d, x => x.game.night.stage === 'acting' && x.game.night.steps[x.game.night.idx] === 'guard');
  assert.ok(d.game.timer.at - d.game.night.openedAt < E.SKIP_MS);
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
      if (!r.game.day.nightCalled) {
        r = E.exile(r, day === 0 && preset === 'yu-nv-lie-bai' ? 8 : [1, 2, 3, 4].find(w => r.game.alive[w]) ?? 0).room;
        if (r.game.day?.idiotChoice) r = E.idiotChoose(r, id(r.game.day.idiotChoice), true).room;
        collect(r);
      }
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
  for (const re of [/被放逐出局/, /^\d+ 號發動技能，帶走了 \d+ 號。/, /翻牌，是白癡/, /騎士 8 號決鬥 \d+ 號/, /遊戲結束/]) assert.ok(texts.some(t => re.test(t)), `沒走到：${re}`);
});

/* ───────── Leo 2026-10-11 ───────── */
test('夜裡活著的角色沒操作：15 秒後主機再唸一次同一句，之後每 15 秒一次；有操作就重新算；死掉的角色永遠輪不到重唸', () => {
  let r = play(newGame(), {}, atAct('wolf'));
  const first = r.game.narration, opened = r.game.night.openedAt;
  assert.equal(r.game.timer.at - opened, E.REPEAT_MS);
  r = E.advance(r, r.game.timer.at, minRand).room;
  assert.equal(r.game.narration.seq, first.seq + 1, '序號變大，主機才會再唸');
  assert.equal(r.game.narration.text, first.text, '唸同一句');
  assert.deepEqual(r.game.narration.clips, first.clips);
  assert.equal(r.game.night.stage, 'acting', '還在等狼人');
  assert.equal(r.game.night.openedAt, opened, '睜眼時間不變：跳過按鈕照樣 30 秒');
  assert.equal(r.game.log.filter(e => e.text === first.text).length, 0, '重唸不進紀錄');
  r = E.advance(r, r.game.timer.at, minRand).room;
  assert.equal(r.game.narration.seq, first.seq + 2, '再過 15 秒再唸');
  // 有人操作（狼人投票）：倒數從那一刻重算
  const t = opened + 50000;
  r = E.nightAction(r, id(1), { target: 9 }, everyone(r), t, minRand).room;
  assert.equal(r.game.timer.at, t + E.REPEAT_MS);
  assert.equal(E.skipStep(r, opened + E.SKIP_MS, minRand).ok, true, '跳過照舊');
  // 動作完成就不再重唸
  for (const w of [1, 2, 3, 4]) r = act(r, w, { target: 9 });
  r = act(r, 1, { confirm: true });
  assert.equal(r.game.night.stage, 'pause');
  // 死掉的角色：假等最長也比重唸早結束
  let d = E.nextNight(night(newGame(), { wolf: 8 }), 1e6).room; // 守衛死了
  d = runUntil(d, x => x.game.night.stage === 'acting' && x.game.night.steps[x.game.night.idx] === 'guard');
  assert.equal(d.game.night.wait, 'fake');
  const seq = d.game.narration.seq;
  d = E.advance(d, d.game.timer.at, minRand).room;
  assert.equal(d.game.night.stage, 'pause', '假等結束直接往下走，不重唸');
  assert.equal(d.game.narration.seq, seq);
  // 邊界：死掉的角色假等抽到最長（15 秒＝跟重唸一樣久）也是直接往下走，不重唸
  const maxRand = k => k - 1;
  let m = E.nextNight(night(newGame(), { wolf: 8 }), 1e6).room;
  for (let i = 0; i < 20 && !(m.game.night.stage === 'acting' && m.game.night.steps[m.game.night.idx] === 'guard'); i++) m = E.advance(m, m.game.timer.at, maxRand).room;
  assert.equal(m.game.timer.at - m.game.night.openedAt, 15000, '抽到最長 15 秒');
  assert.equal(m.game.timer.at - m.game.night.openedAt, E.repeatMs(m.setup.rules), '跟活人重唸同一個秒數');
  const mSeq = m.game.narration.seq;
  m = E.advance(m, m.game.timer.at, maxRand).room;
  assert.equal(m.game.night.stage, 'pause');
  assert.equal(m.game.narration.seq, mSeq, '死掉的角色到 15 秒也不重唸');
  // 假等設很長：重唸也跟著延後，永遠不早於假等
  assert.equal(E.repeatMs({ fakeWaitMax: 40 }), 40000);
  assert.equal(E.repeatMs({ fakeWaitMax: 15 }), E.REPEAT_MS);
  const long = play(newGame('lang-wang-shou-wei', { fakeWaitMax: 40 }), {}, atAct('guard'));
  assert.equal(long.game.timer.at - long.game.night.openedAt, 40000);
  // 女巫兩句、預言家看結果中也會重唸自己那句
  let s = play(newGame(), {}, atAct('seer'));
  s = act(s, 5, { target: 1 });
  const before = s.game.narration.seq;
  s = E.advance(s, s.game.timer.at, minRand).room;
  assert.equal(s.game.narration.seq, before + 1);
  assert.match(s.game.narration.text, /預言家請睜眼/);
});

test('綁票（Leo 2026-10-11）：天亮睜眼時狼人跟好人一樣多，狼人陣營直接獲勝；白天中途一樣多不算', () => {
  // 1–2 狼、3 預、4 白癡、5–6 民；屠城（排除屠邊的影響）；沒有女巫守衛獵人（有翻盤機會就不綁票，見下面）
  const board = { wolf: 2, seer: 1, idiot: 1, villager: 2 };
  let r = night(newGame(board, { win: 'all', police: false }), { wolf: 5 });
  assert.equal(r.phase, 'day', '2 狼對 3 好人');
  r = E.exile(r, 6).room;
  assert.equal(r.phase, 'day', '投完票 2 對 2，但不是天亮，不算');
  r = night(E.nextNight(r, 1e6).room); // 狼空刀
  assert.equal(r.phase, 'ended', '天亮 2 對 2：綁票');
  assert.equal(r.game.winner, 'wolf');
  assert.ok(r.game.log.some(e => /綁票/.test(e.text)));
  assert.equal(r.game.narration.text, '天亮請睜眼。昨晚是平安夜。遊戲結束，狼人陣營獲勝！', '天亮那句和遊戲結束接著唸');
  // 狼人比好人多也算（例如刀一個、毒一個）
  r = E.exile(night(newGame(board, { win: 'all', police: false }), { wolf: 5 }), 6).room;
  r = night(E.nextNight(r, 1e6).room, { wolf: 3, poison: 0 });
  assert.equal(r.game.winner, 'wolf', '2 狼對 1 好人');
  // 第一天上警：公布死訊那一刻才算天亮
  let p = play(newGame({ wolf: 2, seer: 1, villager: 2 }, { win: 'all' }), { wolf: 5 });
  assert.equal(p.phase, 'day');
  p = E.announceDeaths(p).room;
  assert.equal(p.phase, 'ended', '公布死訊後 2 對 2');
});

test('綁票要等槍開完：獵人帶走狼就不綁票，不開槍才綁票', () => {
  // 1–2 狼、3 預、4 獵、5–7 民；屠城
  const board = { wolf: 2, seer: 1, hunter: 1, villager: 3 };
  let r = night(newGame(board, { win: 'all', police: false }), { wolf: 5 });
  r = E.exile(r, 6).room;
  r = night(E.nextNight(r, 1e6).room, { wolf: 4 }); // 刀獵人：天亮 2 狼對 2 好人，但獵人還能開槍
  assert.equal(r.phase, 'day', '先等獵人');
  assert.equal(r.game.winner, null);
  const shot = E.shoot(r, id(4), 1).room;
  assert.equal(shot.phase, 'day', '帶走一隻狼：1 對 2，繼續');
  assert.equal(shot.game.day.bindCheck, false, '天亮的檢查做完就結束');
  const pass = E.shoot(r, id(4), 0).room;
  assert.equal(pass.phase, 'ended', '不開槍：2 對 2 綁票');
  assert.equal(pass.game.winner, 'wolf');
});

test('一狼一神一民（Leo 2026-10-11）：投完票剩這三個人，狼人陣營直接獲勝；屠邊屠城都算；有槍先等槍', () => {
  // 1 狼、2 預、3–4 民
  for (const win of ['side', 'all']) {
    let r = night(newGame({ wolf: 1, seer: 1, villager: 2 }, { win, police: false })); // 空刀
    assert.equal(r.phase, 'day');
    r = E.exile(r, 3).room;
    assert.equal(r.phase, 'ended', win);
    assert.equal(r.game.winner, 'wolf');
    assert.equal(r.game.narration.text, '3 號被放逐出局。遊戲結束，狼人陣營獲勝！');
    assert.ok(r.game.log.some(e => /一狼、一神、一民/.test(e.text)));
  }
  // 平票也算「投完票」
  let t = night(newGame({ wolf: 1, seer: 1, villager: 2 }, { police: false }), { wolf: 4 });
  assert.equal(t.phase, 'day', '天亮 1 狼對 2 好人不綁票');
  assert.equal(E.exile(t, 0).room.game.winner, 'wolf');
  // 還沒投票不算
  assert.equal(t.game.winner, null);
  // 放逐獵人剩一狼一神一民：先等獵人開槍
  // 1 狼、2 預、3 獵、4–5 民
  let h = night(newGame({ wolf: 1, seer: 1, hunter: 1, villager: 2 }, { police: false }), { wolf: 5 });
  h = E.exile(h, 3).room;
  assert.equal(h.phase, 'day', '獵人還能開槍');
  assert.equal(E.shoot(h, id(3), 1).room.game.winner, 'good', '帶走狼：好人贏');
  assert.equal(E.shoot(h, id(3), 0).room.game.winner, 'wolf', '不開槍：一狼一神一民');
  // 一狼兩民、一狼兩神都不是這條
  let v = night(newGame({ wolf: 1, seer: 1, villager: 3 }, { win: 'all', police: false }));
  v = E.exile(v, 2).room;
  assert.equal(v.phase, 'day', '一狼兩民：不適用');
});

test('主機在獵人開槍前就按「進入黑夜」：這槍當作不開，但綁票、一狼一神一民照樣要判（2026-10-14 盤查）', () => {
  // 一狼一神一民：1 狼、2 預、3 獵、4–5 民；放逐獵人後主機沒等就按天黑
  let h = night(newGame({ wolf: 1, seer: 1, hunter: 1, villager: 2 }, { police: false }), { wolf: 5 });
  h = E.nextNight(E.exile(h, 3).room, 1e6).room;
  assert.equal(h.phase, 'ended', '不開槍＝剩一狼一神一民');
  assert.equal(h.game.winner, 'wolf');
  assert.equal(h.game.narration.text, '遊戲結束，狼人陣營獲勝！');
  // 綁票：1–2 狼、3 獵、4–5 民；刀獵人，天亮 2 對 2，獵人還沒開主機就按天黑
  let b = night(newGame({ wolf: 2, hunter: 1, villager: 2 }, { win: 'all', police: false }), { wolf: 3 });
  assert.equal(b.phase, 'day', '先等獵人');
  b = E.nextNight(b, 1e6).room;
  assert.equal(b.game.winner, 'wolf', '不開槍＝綁票');
  // 沒有提早獲勝的情況：照舊進黑夜，這槍沒了
  let n = night(newGame({ wolf: 1, seer: 1, hunter: 1, villager: 3 }, { police: false }), { wolf: 3 });
  n = E.nextNight(n, 1e6).room;
  assert.equal(n.phase, 'night');
  assert.deepEqual(n.game.canShoot, []);
});

test('重唸的鬧鐘：主機離線時房間會先停掉（不讓沒人的房間一直醒來），主機回來再接著算', () => {
  let r = play(newGame(), {}, atAct('wolf'));
  assert.equal(E.waitingForPeople(r), true);
  const paused = E.pauseRepeat(r);
  assert.equal(paused.game.timer, null);
  assert.equal(E.resumeRepeat(paused, 5000).game.timer.at, 5000 + E.REPEAT_MS);
  assert.equal(E.resumeRepeat(r, 5000), r, '本來就在算就不動');
  const day = night(newGame());
  assert.equal(E.resumeRepeat(day, 5000), day, '白天不會有重唸');
  assert.equal(E.waitingForPeople(day), false);
});
