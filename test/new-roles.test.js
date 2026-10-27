// 2026-10-13 新角色：守墓人、白狼王、狼美人、隱狼、石像鬼
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/lobby.js';
import * as G from '../src/game.js';
import * as E from '../src/engine.js';
import * as R from '../public/shared/roles.js';
import { LINES, lineText } from '../public/shared/voice-lines.js';
import { ART, ART_BG } from '../public/shared/art.js';

// 固定順序發牌（rand(n)=n-1 洗牌不動）：座位依 ROLE_ORDER 拿角色
// FULL：1–2 狼人、3 白狼王、4 狼美人、5 隱狼、6 石像鬼、7 預言家、8 女巫、9 獵人、10 守衛、11 守墓人、12–14 平民
const FULL = { wolf: 2, whiteKing: 1, beauty: 1, hidden: 1, gargoyle: 1, seer: 1, witch: 1, hunter: 1, guard: 1, gravekeeper: 1, villager: 3 };
// KNIGHT：1–2 狼人、3 狼美人、4 預言家、5 女巫、6 獵人、7 騎士、8–10 平民
const KNIGHT = { wolf: 2, beauty: 1, seer: 1, witch: 1, hunter: 1, knight: 1, villager: 3 };
// GRAVE：1–2 狼人、3 隱狼、4 預言家、5 守墓人、6 白癡、7–9 平民
const GRAVE = { wolf: 2, hidden: 1, seer: 1, gravekeeper: 1, idiot: 1, villager: 3 };

const noShuffle = n => n - 1;
const minRand = () => 0;
const id = n => 'p' + n;

function newGame(counts, rules = {}) {
  const players = R.totalOf(counts);
  let r = L.newRoom('1234', players, 'host', 0);
  for (let n = 1; n <= players; n++) r = L.claimSeat(r, id(n), n, new Set()).room;
  r = G.setSetup(r, { counts, rules }).room;
  assert.deepEqual(G.dealBlockers(r), []);
  r = G.startDeal(r, noShuffle).room;
  return E.startGame(r, 0, minRand).room;
}
const everyone = r => new Set(Object.values(r.seats));
const curStep = r => r.game.night.steps[r.game.night.idx];
const beatAct = r => E.scriptFor(curStep(r), r.setup.counts).beats[r.game.night.beat].act;
const waiting = r => r.phase === 'night' && r.game.night.stage === 'acting' && r.game.night.wait === 'people';
function runUntil(r, pred) {
  for (let i = 0; i < 80 && !pred(r); i++) {
    if (!r.game.timer || waiting(r)) break;
    r = E.advance(r, r.game.timer.at, minRand).room;
  }
  return r;
}
function act(r, seat, payload) {
  const res = E.nightAction(r, id(seat), payload, everyone(r), r.game.timer?.at ?? 1e9, minRand);
  assert.equal(res.ok, true, res.error);
  return res.room;
}
const atAct = a => r => waiting(r) && beatAct(r) === a;
// 一路往下走，遇到等人的台詞照 plan 動作，直到 stop 成立或天亮
function play(r, plan = {}, stop = x => x.phase !== 'night') {
  for (let i = 0; i < 60; i++) {
    r = runUntil(r, x => stop(x) || waiting(x));
    if (stop(r) || r.phase !== 'night') return r;
    const a = beatAct(r);
    const who = E.actors(r.game, curStep(r));
    if (a === 'guard') r = act(r, who[0], { target: plan.guard ?? 0 });
    if (a === 'wolf') { for (const w of who) r = act(r, w, { target: plan.wolf ?? 0 }); r = act(r, who[0], { confirm: true }); }
    if (a === 'beauty') r = act(r, who[0], { target: plan.charm ?? 0 });
    if (a === 'witchSave') r = act(r, who[0], { use: plan.save ? 'save' : 'skip' });
    if (a === 'witchPoison') r = act(r, who[0], plan.poison ? { use: 'poison', target: plan.poison } : { use: 'none' });
    if (a === 'seer' || a === 'gargoyle') {
      const t = plan[a] ?? Object.keys(r.game.alive).map(Number).find(s => r.game.alive[s] && s !== who[0]);
      if (!r.game.night[a + 'Target']) r = act(r, who[0], { target: t }); // 測試裡可能已經先手動查過
      r = act(r, who[0], { done: true });
    }
    if (a === 'grave' || a === 'hunter' || a === 'king') r = act(r, who[0], { seen: true });
  }
  return r;
}
function night(r, plan) {
  r = play(r, plan);
  if (r.phase === 'day' && r.game.day.pendingDeaths) r = E.announceDeaths(r).room;
  return r;
}
const nextNight = r => E.nextNight(r, 1e6).room;
const deadSeats = r => Object.keys(r.game.alive).map(Number).filter(s => !r.game.alive[s]);
const said = r => r.game.narration.text;

/* ───────── 角色表、台詞、美術 ───────── */
test('角色表：五個新角色、陣營、限定一人；本局板子與狼人數量算進所有狼', () => {
  const want = { whiteKing: ['白狼王', 'wolf'], beauty: ['狼美人', 'wolf'], hidden: ['隱狼', 'wolf'], gargoyle: ['石像鬼', 'wolf'], gravekeeper: ['守墓人', 'god'] };
  for (const [k, [name, team]] of Object.entries(want)) {
    assert.equal(R.ROLES[k].name, name);
    assert.equal(R.ROLES[k].team, team);
    assert.equal(R.ROLES[k].unique, true);
    assert.ok(R.ROLE_ORDER.includes(k));
  }
  assert.deepEqual(R.cleanCounts({ whiteKing: 3, gravekeeper: 2 }), { whiteKing: 1, gravekeeper: 1 });
  assert.deepEqual(R.problems({ gargoyle: 1, villager: 2 }, 3), [], '只有石像鬼也能開局');
  assert.ok(R.problems({ whiteKing: 1, beauty: 1, villager: 2 }, 4).some(p => p.includes('少於一半')), '新的狼也算狼');
  assert.deepEqual(R.boardByTeam(FULL).map(x => x.label), ['狼人陣營 6 隻', '神職', '平民']);
  assert.equal(R.boardByTeam(FULL)[0].text, '狼人 ×2、白狼王、狼美人、隱狼、石像鬼');
});

test('每個角色都有卡圖與底色（少一張整個法官頁會壞）', () => {
  for (const k of R.ROLE_ORDER) {
    assert.ok(ART_BG[k], `${k} 沒有底色`);
    assert.equal(typeof ART[k], 'function', `${k} 沒有圖`);
    assert.match(ART[k](), /<g /);
  }
  assert.deepEqual(Object.keys(ART_BG).sort(), [...R.ROLE_ORDER].sort());
});

test('新台詞：每一步的劇本片段都在台詞表；主機台詞不唸號碼', () => {
  for (const step of [...E.NIGHT_ORDER, 'police']) {
    const s = E.scriptFor(step, FULL);
    for (const k of [...s.beats.flatMap(b => b.say), ...(s.close ?? [])]) {
      assert.ok(k in LINES, `${step} 用到不存在的片段 ${k}`);
      assert.ok(!/\d+ 號/.test(LINES[k]), `${k} 唸了號碼`);
    }
  }
  for (const k of ['beautyOpen', 'beautyClose', 'gargoyleOpen', 'gargoyleClose', 'graveOpen', 'graveClose', 'whiteBoom', 'whiteBoomTook', 'charmDied']) assert.ok(LINES[k], k);
});

/* ───────── 夜晚順序 ───────── */
test('夜晚順序：守衛→狼人→狼美人→女巫→預言家→石像鬼→守墓人（第二晚起）→獵人', () => {
  const r = newGame(FULL);
  assert.deepEqual(r.game.night.steps, ['guard', 'wolf', 'beauty', 'witch', 'seer', 'gargoyle', 'hunter', 'police']);
  assert.deepEqual(nextNight(night(r)).game.night.steps, ['guard', 'wolf', 'beauty', 'witch', 'seer', 'gargoyle', 'gravekeeper', 'hunter']);
  assert.deepEqual(newGame({ whiteKing: 1, hidden: 1, seer: 1, villager: 3 }).game.night.steps, ['wolf', 'seer', 'police'], '白狼王、隱狼沒有自己的一步');
});

/* ───────── 隱狼、石像鬼 ───────── */
test('隱狼：單向認得狼隊、夜裡一起投刀但狼隊看不到他的號碼（Leo 2026-10-27）；預言家看是好人；石像鬼不見狼隊、查具體身分', () => {
  let r = play(newGame(FULL), {}, atAct('wolf'));
  assert.deepEqual(E.actors(r.game, 'wolf'), [1, 2, 3, 4, 5], '狼隊：狼人、白狼王、狼美人＋隱狼');
  const mates = s => E.privateGame(r, s).wolves.map(w => w.seat);
  assert.deepEqual(mates(1), [1, 2, 3, 4], '狼隊不知道隱狼、石像鬼');
  assert.deepEqual(mates(5), [1, 2, 3, 4, 5], '隱狼知道狼隊');
  assert.deepEqual(mates(6), [6], '石像鬼誰都不認得');
  assert.equal(E.privateGame(r, 6).action, undefined, '石像鬼閉眼');
  assert.equal(E.privateGame(r, 5).action.iAmHidden, true);
  assert.deepEqual(E.privateGame(r, 5).action.killers, [1, 2, 3, 4, 5], '隱狼看得到全部');
  assert.deepEqual(E.privateGame(r, 1).action.killers, [1, 2, 3, 4], '狼隊的名單沒有隱狼號碼');
  r = act(r, 5, { target: 12 });
  const pack = E.privateGame(r, 1).action;
  assert.deepEqual(pack.hidden, { voted: true, vote: 12 });
  assert.equal(pack.votes[5], undefined, '狼隊收到的票沒有 5 號這個鍵');
  assert.ok(!JSON.stringify(E.privateGame(r, 1)).includes('"5"'), '狼隊手機的資料裡完全沒有隱狼的座位');
  for (const w of [1, 2, 3]) r = act(r, w, { target: 12 });
  assert.equal(r.game.night.wolfProposal, null, '隱狼也要一致（4 號還沒投）');
  r = act(r, 4, { target: 13 });
  assert.equal(r.game.night.wolfProposal, null);
  r = act(r, 4, { target: 12 });
  assert.equal(r.game.night.wolfProposal, 12, '狼隊＋隱狼全部一致才確認');
  r = act(r, 5, { confirm: true });
  assert.equal(r.game.night.wolfTarget, 12, '隱狼也可以按正確');
  // 隱狼斷線：不算一致（跟掉線的狼同一套）
  let off = play(newGame(FULL), {}, atAct('wolf'));
  const online = new Set(Object.values(off.seats).filter(c => c !== id(5)));
  for (const w of [1, 2, 3, 4]) off = E.nightAction(off, id(w), { target: 12 }, online, 0, minRand).room;
  assert.equal(off.game.night.wolfProposal, 12, '隱狼離線時不等他');
  // 隱狼死了：狼隊的畫面照樣有「隱狼：還沒選」那一行（跟掉線一樣），推不出死掉的哪一個是隱狼
  let dead = night(newGame(FULL));
  dead = { ...dead, game: { ...dead.game, alive: { ...dead.game.alive, 5: false } } };
  dead = play(nextNight(dead), {}, atAct('wolf'));
  assert.deepEqual(E.actors(dead.game, 'wolf'), [1, 2, 3, 4]);
  assert.deepEqual(E.privateGame(dead, 1).action.hidden, { voted: false, vote: null });
  assert.deepEqual(E.privateGame(dead, 1).action.killers, [1, 2, 3, 4]);

  r = play(newGame(FULL), { seer: 5 }, atAct('gargoyle'));
  assert.equal(E.privateGame(r, 7).seerChecks.at(-1).wolf, false, '預言家查隱狼＝好人');
  r = act(r, 6, { target: 5 });
  assert.deepEqual(E.privateGame(r, 6).action.checked, { day: 1, target: 5, role: 'hidden' }, '石像鬼看到具體身分');
  assert.equal(E.nightAction(r, id(6), { target: 7 }, everyone(r), 0, minRand).ok, false, '一晚只查一次');
  r = act(r, 6, { done: true });
  assert.equal(E.privateGame(r, 6).gargoyleChecks.length, 1);

  r = play(newGame(FULL), { seer: 6 }, atAct('gargoyle'));
  assert.equal(E.privateGame(r, 7).seerChecks.at(-1).wolf, true, '預言家查石像鬼＝狼人');
  assert.equal(E.nightAction(r, id(6), { target: 6 }, everyone(r), 0, minRand).ok, false, '不能查自己');
});

test('狼隊全部出局後：隱狼、石像鬼一起睜眼殺人、彼此見面；隱狼還活著狼人就還沒輸', () => {
  let r = night(newGame(FULL));
  const g = structuredClone(r.game);
  for (const s of [1, 2, 3, 4]) g.alive[s] = false;
  r = { ...r, game: g };
  assert.equal(E.winnerOf(r.game, r.setup.counts, r.setup.rules), null, '隱狼、石像鬼還活著');
  r = play(nextNight(r), {}, atAct('wolf'));
  assert.deepEqual(E.actors(r.game, 'wolf'), [5, 6]);
  assert.deepEqual(E.privateGame(r, 5).wolves.map(w => w.seat), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(E.privateGame(r, 6).wolves.map(w => w.seat), [5, 6]);
  r = act(r, 5, { target: 12 });
  assert.equal(r.game.night.wolfProposal, null, '要兩隻一致');
  r = act(r, 6, { target: 12 });
  r = act(r, 6, { confirm: true });
  r = play(r);
  assert.ok(deadSeats(r).includes(12), '隱狼石像鬼刀成功');
  // 只剩隱狼一隻也照樣殺人
  const g2 = structuredClone(r.game); g2.alive[6] = false;
  r = play(nextNight({ ...r, game: g2 }), {}, atAct('wolf'));
  assert.deepEqual(E.actors(r.game, 'wolf'), [5]);
});

test('只有隱狼／石像鬼的板子：第一晚就由他們殺人', () => {
  const r = play(newGame({ gargoyle: 1, seer: 1, villager: 3 }), {}, atAct('wolf'));
  assert.deepEqual(E.actors(r.game, 'wolf'), [1]);
});

/* ───────── 狼美人 ───────── */
test('狼美人：魅惑不能選自己或死人；今晚不魅惑也行；不能連續兩晚魅惑同一位（Leo 2026-10-27）', () => {
  let r = play(newGame(FULL), { wolf: 12 }, atAct('beauty'));
  assert.deepEqual(E.privateGame(r, 4).action, { kind: 'beauty', lastCharm: null });
  assert.equal(E.nightAction(r, id(4), { target: 4 }, everyone(r), 0, minRand).ok, false);
  assert.equal(E.nightAction(r, id(1), { target: 9 }, everyone(r), 0, minRand).ok, false, '別的狼不能魅惑');
  r = act(r, 4, { target: 0 });
  assert.equal(r.game.night.charmTarget, null);
  // 第一晚魅惑 9，第二晚不能再魅惑 9、可以換人；隔一晚（第三晚）又可以
  let c = night(newGame(FULL), { charm: 9 });
  c = play(nextNight(c), {}, atAct('beauty'));
  assert.equal(E.privateGame(c, 4).action.lastCharm, 9);
  const same = E.nightAction(c, id(4), { target: 9 }, everyone(c), 0, minRand);
  assert.equal(same.ok, false);
  assert.match(same.error, /連續兩晚/);
  c = act(c, 4, { target: 13 });
  c = play(c);
  c = play(nextNight(c), {}, atAct('beauty'));
  assert.equal(E.nightAction(c, id(4), { target: 9 }, everyone(c), 0, minRand).ok, true, '隔一晚可以再魅惑 9');
  assert.equal(E.nightAction(c, id(4), { target: 13 }, everyone(c), 0, minRand).ok, false, '昨晚魅惑 13');
});

test('狼美人不能被自刀、不能自爆；被女巫毒死不殉情（技能被悶）（Leo 2026-10-27）', () => {
  let r = play(newGame(FULL), {}, atAct('wolf'));
  const res = E.nightAction(r, id(1), { target: 4 }, everyone(r), 0, minRand);
  assert.equal(res.ok, false, '狼隊不能刀狼美人');
  assert.equal(E.nightAction(r, id(4), { target: 4 }, everyone(r), 0, minRand).ok, false, '狼美人自己也不能投自己');
  assert.deepEqual(E.privateGame(r, 1).action.noKnife, [4], '狼人的畫面標出不能刀的號碼');
  r = night(newGame(FULL), { charm: 12, poison: 4 });
  assert.deepEqual(deadSeats(r), [4], '被毒死的狼美人不殉情');
  assert.match(said(r), /昨晚死亡的是 4 號。$/);
  r = night(newGame(FULL), { charm: 12, poison: 13 });
  assert.deepEqual(deadSeats(r), [13], '狼美人沒死，魅惑的人沒事');
  // 被毒死後 12 號不會在白天因為「魅惑」跟著死
  r = night(newGame(FULL), { charm: 12, poison: 4 });
  r = E.exile(r, 13).room;
  assert.equal(r.game.alive[12], true);
  const d = night(newGame(FULL));
  assert.equal(E.privateGame(d, 4).canBoom, undefined, '狼美人沒有自爆鈕');
  assert.equal(E.boom(d, id(4), 0).ok, false, '狼美人不能自爆');
});

test('狼美人白天出局（放逐、被槍帶走）：魅惑的人殉情、技能被悶，台詞接著唸「N 號殉情出局。」；被騎士撞死不殉情', () => {
  let r = night(newGame(FULL), { charm: 9 });
  assert.equal(E.privateGame(r, 4).charm, 9, '狼美人看得到現在魅惑誰');
  r = E.exile(r, 4).room;
  assert.equal(said(r), '4 號被放逐出局。9 號殉情出局。');
  assert.deepEqual(deadSeats(r), [4, 9]);
  assert.deepEqual(r.game.canShoot, [], '殉情的獵人不能開槍（技能被悶）');

  r = night(newGame(FULL), { wolf: 9, charm: 12 });
  assert.deepEqual(r.game.canShoot, [9]);
  r = E.shoot(r, id(9), 4).room;
  assert.equal(said(r), '9 號發動技能，帶走了 4 號。12 號殉情出局。');

  r = night(newGame(KNIGHT), { charm: 8 });
  r = E.duel(r, id(7), 3).room;
  assert.equal(said(r), '騎士 7 號決鬥 3 號：3 號是狼人，出局！天黑請閉眼。', '騎士撞死的狼美人技能被悶');
  assert.equal(r.game.alive[8], true);
});

test('狼美人：剩一狼美、一神、一民，狼美被放逐帶走殉情的人＝狼人陣營直接獲勝（殉情算狼刀，狼刀優先）（Leo 2026-10-27）', () => {
  // 1 狼美人、2 預言家、3 平民（屠邊）
  let r = night(newGame({ beauty: 1, seer: 1, villager: 2 }), { wolf: 4, charm: 3 });
  assert.deepEqual(deadSeats(r), [4]);
  assert.equal(r.phase, 'day');
  r = E.exile(r, 1).room;
  assert.equal(r.phase, 'ended');
  assert.equal(r.game.winner, 'wolf');
  assert.equal(said(r), '1 號被放逐出局。3 號殉情出局。遊戲結束，狼人陣營獲勝！');
  // 殉情的是神也一樣
  let g = night(newGame({ beauty: 1, seer: 1, villager: 2 }), { wolf: 4, charm: 2 });
  g = E.exile(g, 1).room;
  assert.equal(g.game.winner, 'wolf');
  // 沒魅惑到人（或魅惑的人已經死了）：狼美出局＝好人勝
  let n = night(newGame({ beauty: 1, seer: 1, villager: 2 }), { wolf: 4, charm: 0 });
  n = E.exile(n, 1).room;
  assert.equal(n.game.winner, 'good');
});

test('狼美人的魅惑每晚換新：今晚不魅惑，昨晚魅惑的人就沒事', () => {
  let r = night(newGame(FULL), { charm: 9 });
  r = night(nextNight(r), { charm: 0 });
  r = E.exile(r, 4).room;
  assert.equal(said(r), '4 號被放逐出局。');
  assert.equal(r.game.alive[9], true);
});

/* ───────── 守墓人 ───────── */
test('守墓人：第二晚起看前一天投票放逐的人；隱狼顯示好人、狼顯示狼；平票沒資訊', () => {
  let r = night(newGame(GRAVE));
  r = E.exile(r, 3).room;                          // 放逐隱狼
  r = play(nextNight(r), {}, atAct('grave'));
  assert.deepEqual(E.privateGame(r, 5).action, { kind: 'grave', info: { day: 1, seat: 3, wolf: false } });
  r = act(r, 5, { seen: true });
  r = play(r);
  assert.deepEqual(E.privateGame(r, 5).graveChecks, [{ day: 1, seat: 3, wolf: false }]);
  r = E.exile(r, 1).room;                          // 放逐狼人
  r = play(nextNight(r), {}, atAct('grave'));
  assert.deepEqual(E.privateGame(r, 5).action.info, { day: 2, seat: 1, wolf: true });
  r = play(r);
  r = E.exile(r, 0).room;                          // 平票
  r = play(nextNight(r), {}, atAct('grave'));
  assert.equal(E.privateGame(r, 5).action.info, null, '平票：昨天沒有人被放逐');
});

test('守墓人：白癡翻牌不算被放逐；白癡不翻牌算（好人）；白狼王自爆、騎士撞死都不算', () => {
  let r = night(newGame(GRAVE));
  r = E.idiotChoose(E.exile(r, 6).room, id(6), true).room;
  r = play(nextNight(r), {}, atAct('grave'));
  assert.equal(E.privateGame(r, 5).action.info, null);
  r = play(r);
  r = E.exile(r, 6).room; // 翻過牌的白癡再被放逐：直接出局，算放逐
  assert.equal(r.game.alive[6], false);
  r = play(nextNight(r), {}, atAct('grave'));
  assert.deepEqual(E.privateGame(r, 5).action.info, { day: 2, seat: 6, wolf: false });

  let i = night(newGame(GRAVE));
  i = E.idiotChoose(E.exile(i, 6).room, id(6), false).room; // 第一次就選不翻牌
  i = play(nextNight(i), {}, atAct('grave'));
  assert.deepEqual(E.privateGame(i, 5).action.info, { day: 1, seat: 6, wolf: false });

  let w = night(newGame(FULL));
  w = E.boom(w, id(3), 7).room;
  w = play(nextNight(w), {}, atAct('grave'));
  assert.equal(E.privateGame(w, 11).action.info, null, '自爆、被帶走都不是投票放逐');

  // 1–2 狼人、3 預言家、4 守墓人、5 騎士、6–8 平民
  let k = night(newGame({ wolf: 2, seer: 1, gravekeeper: 1, knight: 1, villager: 3 }));
  k = E.duel(k, id(5), 1).room;
  k = play(nextNight(k), {}, atAct('grave'));
  assert.equal(E.privateGame(k, 4).action.info, null, '騎士撞死的狼不是投票放逐');
});

test('守墓人死了：照樣唸台詞、假等（不洩漏）', () => {
  let r = night(newGame(GRAVE), { wolf: 5 });
  assert.equal(r.game.alive[5], false);
  r = E.exile(r, 1).room;
  r = play(nextNight(r), {}, x => x.phase === 'night' && curStep(x) === 'gravekeeper' && x.game.night.stage === 'acting');
  assert.equal(r.game.night.wait, 'fake');
  assert.equal(said(r), LINES.graveOpen);
});

/* ───────── 白狼王 ───────── */
test('白狼王自爆帶人：唸「N 號白狼王自爆，帶走了 M 號。天黑請閉眼。」，不放逐，主機按了才進黑夜（不重唸）', () => {
  let r = night(newGame(FULL));
  assert.equal(E.privateGame(r, 3).canBoom, true);
  assert.equal(E.privateGame(r, 3).boomTake, true);
  assert.equal(E.privateGame(r, 1).canBoom, true, '2026-10-27 起一般狼人也能自爆');
  assert.equal(E.privateGame(r, 1).boomTake, undefined, '但只有白狼王能帶人');
  assert.equal(E.boom(r, id(1), 7).ok, false);
  assert.equal(E.boom(r, id(3), 3).ok, false, '不能帶自己');
  r = E.boom(r, id(3), 7).room;
  assert.equal(said(r), '3 號白狼王自爆，帶走了 7 號。天黑請閉眼。');
  assert.deepEqual(deadSeats(r), [3, 7]);
  assert.equal(E.publicGame(r).nightCalled, true);
  assert.equal(E.publicGame(r).nightReason, 'boom');
  assert.equal(E.exile(r, 1).ok, false, '自爆後不放逐');
  assert.equal(E.boom(r, id(3), 8).ok, false, '死了不能再爆');
  const seq = r.game.narration.seq;
  r = nextNight(r);
  assert.equal(r.game.narration.seq, seq, '天黑請閉眼不重唸');
  assert.equal(r.phase, 'night');
});

test('白狼王：不帶人也能自爆；帶走獵人 → 獵人先開槍，開完才唸天黑；帶走狼美人 → 魅惑的人殉情', () => {
  let r = night(newGame(FULL));
  assert.equal(said(E.boom(r, id(3), 0).room), '3 號白狼王自爆。天黑請閉眼。');
  r = E.boom(r, id(3), 9).room;
  assert.equal(said(r), '3 號白狼王自爆，帶走了 9 號。9 號，請啟動角色技能。');
  assert.deepEqual(r.game.canShoot, [9]);
  r = E.shoot(r, id(9), 1).room;
  assert.equal(said(r), '9 號發動技能，帶走了 1 號。天黑請閉眼。');

  r = night(newGame(FULL), { charm: 12 });
  r = E.boom(r, id(3), 4).room;
  assert.equal(said(r), '3 號白狼王自爆，帶走了 4 號。12 號殉情出局。天黑請閉眼。');
});

test('白狼王什麼時候不能爆：投票放逐後、有人還沒開槍、等白癡選；非自爆出局不能帶人；警長競選中可以（先公布死訊）', () => {
  let p = play(newGame(FULL), { wolf: 12 });
  assert.ok(p.game.day.pendingDeaths);
  const early = E.boom(p, id(3), 7).room;
  assert.equal(said(early), '昨晚死亡的是 12 號。3 號白狼王自爆，帶走了 7 號。天黑請閉眼。', '警長競選中自爆：先公布昨晚死訊');
  assert.equal(early.game.day.pendingDeaths, null);
  const late = E.boom(p, id(3), 12);
  assert.equal(late.ok, false, '不能帶走昨晚已經死的人');
  assert.equal(late.room.game.day.pendingDeaths, null, '但死訊已經公布了');
  const r = E.announceDeaths(p).room;
  assert.equal(E.boom(E.exile(r, 13).room, id(3), 7).ok, false, '投票放逐後');
  assert.equal(E.privateGame(E.exile(r, 13).room, 3).canBoom, undefined);
  const h = night(newGame(FULL), { wolf: 9 });
  assert.equal(E.boom(h, id(3), 7).ok, false, '獵人還沒開槍');
  assert.equal(E.privateGame(h, 3).canBoom, undefined);
  const out = E.exile(r, 3).room;
  assert.equal(out.game.alive[3], false);
  assert.deepEqual(out.game.canShoot, [], '被放逐的白狼王不能帶人');
  const i = night(newGame({ wolf: 1, whiteKing: 1, seer: 1, idiot: 1, villager: 2 }));
  const wait = E.exile(i, 4).room;
  assert.equal(E.boom(wait, id(2), 3).ok, false, '等白癡選');
});

test('白狼王自爆後已經唸「天黑請閉眼」：騎士不能再決鬥（2026-10-14 盤查）', () => {
  // 1 狼人、2 白狼王、3 預言家、4 騎士、5–7 平民
  const r = night(newGame({ wolf: 1, whiteKing: 1, seer: 1, knight: 1, villager: 3 }));
  assert.equal(E.privateGame(r, 4).canDuel, true);
  const b = E.boom(r, id(2), 0).room;
  assert.equal(E.publicGame(b).nightCalled, true);
  assert.equal(E.duel(b, id(4), 1).ok, false, '自爆後不能決鬥');
  assert.equal(E.privateGame(b, 4).canDuel, undefined, '騎士手機不出現決鬥鈕');
});

test('白狼王自爆直接分出勝負：最後一隻狼爆了→好人勝；帶走最後一個神（屠邊）→狼人勝', () => {
  let r = night(newGame({ whiteKing: 1, seer: 1, villager: 2 }));
  r = E.boom(r, id(1), 0).room;
  assert.equal(r.phase, 'ended');
  assert.equal(said(r), '1 號白狼王自爆。遊戲結束，好人陣營獲勝！');
  r = night(newGame({ wolf: 1, whiteKing: 1, seer: 1, villager: 3 }));
  r = E.boom(r, id(2), 3).room;
  assert.equal(r.phase, 'ended');
  assert.equal(said(r), '2 號白狼王自爆，帶走了 3 號。遊戲結束，狼人陣營獲勝！');
});

test('白狼王晚上跟狼隊一起殺人', () => {
  const r = play(newGame({ whiteKing: 1, seer: 1, villager: 3 }), {}, atAct('wolf'));
  assert.deepEqual(E.actors(r.game, 'wolf'), [1]);
});

/* ───────── 不洩漏 ───────── */
test('主機（沒坐下）收到的資料：白天、夜裡都沒有任何角色、魅惑對象、查驗結果', () => {
  const roleIds = R.ROLE_ORDER.filter(k => !E.NIGHT_ORDER.includes(k)); // 夜裡的步驟名本來就公開（板子公開）
  let r = play(newGame(FULL), { charm: 9 }, atAct('gargoyle'));
  r = act(r, 6, { target: 5 });
  const check = room => {
    const { setup, ...rest } = G.viewFor(room, everyone(room), 'host'); // setup＝板子，開局前本來就公開
    const v = JSON.stringify(rest);
    for (const k of roleIds) assert.ok(!v.includes(`"${k}"`), `主機看到 ${k}`);
    for (const k of ['charm', 'gargoyleChecks', 'graveChecks', 'graveInfo', 'seerChecks', 'killers']) assert.ok(!v.includes(k), `主機看到 ${k}`);
  };
  check(r);
  r = night(r);
  check(r);
  check(E.boom(r, id(3), 7).room);
});

/* ───────── 亂數整局（找沒想到的組合會不會卡死、壞掉） ───────── */
// mulberry32：固定種子、可重現
function prng(seed) {
  return n => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

function randomBoard(rnd) {
  for (let i = 0; ; i++) {
    assert.ok(i < 1000, '湊不出合法板子');
    const counts = { wolf: rnd(3), villager: rnd(4) };
    for (const k of R.ROLE_ORDER) if (R.ROLES[k].unique && rnd(2)) counts[k] = 1;
    const c = R.cleanCounts(counts);
    if (R.problems(c, R.totalOf(c)).length === 0 && R.totalOf(c) >= 4 && R.totalOf(c) <= 20) return c;
  }
}

test('亂數整局 400 局（所有角色亂配、亂按）：不當機、一定分出勝負、台詞都錄得到、死人不會復活、好人不會被當狼殺人', () => {
  for (let seed = 1; seed <= Number(process.env.FUZZ ?? 400); seed++) { // FUZZ=5000 npm test 可以跑更多局
    const rnd = prng(seed);
    const counts = randomBoard(rnd);
    const players = R.totalOf(counts);
    let r = L.newRoom('1234', players, 'host', 0);
    for (let n = 1; n <= players; n++) r = L.claimSeat(r, id(n), n, new Set()).room;
    r = G.setSetup(r, { counts, rules: { police: rnd(2) === 0, win: rnd(2) ? 'side' : 'all', witchSelfSave: ['never', 'first', 'always'][rnd(3)] } }).room;
    r = G.startDeal(r, rnd).room;
    r = E.startGame(r, 0, rnd).room;
    let deadBefore = new Set(), now = 0, steps = 0;
    const tryAct = (seat, payloads) => {
      for (const p of payloads) {
        const res = E.nightAction(r, id(seat), p, everyone(r), now, rnd);
        if (res.ok) { r = res.room; return true; }
      }
      return false;
    };
    const aliveList = () => Object.keys(r.game.alive).map(Number).filter(s => r.game.alive[s]);
    const pickAlive = () => { const a = aliveList(); return a[rnd(a.length)]; };
    // 主機（沒坐下）在任何時候都拿不到任何人的身分（結束翻牌除外）
    const hostSeesNothing = () => {
      const v = G.viewFor(r, everyone(r), 'host');
      assert.equal(v.you.role, undefined, `seed ${seed} 主機拿到身分`);
      assert.equal(v.you.game, null, `seed ${seed} 主機拿到私人資料`);
      if (r.phase !== 'ended') assert.equal(v.game.allRoles, undefined, `seed ${seed} 沒結束就翻牌`);
    };
    const rejected = (res, why) => assert.equal(res.ok, false, `seed ${seed} 應該擋下：${why}`);
    while (r.phase !== 'ended') {
      assert.ok(++steps < 5000, `seed ${seed} 卡住了`);
      const n = r.game.narration;
      assert.ok(n.clips.every(k => k in LINES), `seed ${seed} 台詞片段不存在：${n.clips}`);
      assert.equal(n.text, lineText(n.clips));
      const dead = new Set(Object.keys(r.game.alive).map(Number).filter(s => !r.game.alive[s]));
      for (const s of deadBefore) assert.ok(dead.has(s), `seed ${seed} ${s} 號復活了`);
      deadBefore = dead;
      hostSeesNothing();
      // 該結束卻沒結束：沒人在等（死訊、開槍、白癡）時，勝負與提早獲勝都必須已經判掉
      const gw = r.game;
      if (r.phase === 'night' || (!gw.day.pendingDeaths && !gw.canShoot.length && !gw.day.idiotChoice && !gw.badgePending)) {
        assert.equal(E.winnerOf(gw, r.setup.counts, r.setup.rules), null, `seed ${seed} 已經分出勝負卻沒結束`);
        if (r.phase === 'day') assert.equal(E.houseRuleWin(gw, r.setup.rules), null, `seed ${seed} 提早獲勝沒判`);
      }
      if (r.phase === 'night') {
        if (waiting(r) && rnd(10) === 0) { // 主機按跳過（睜眼 30 秒後）
          now = Math.max(now, r.game.night.openedAt + E.SKIP_MS);
          const res = E.skipStep(r, now, rnd); assert.ok(res.ok, `seed ${seed} 跳過：${res.error}`); r = res.room;
          continue;
        }
        if (waiting(r)) {
          const step = curStep(r), who = E.actors(r.game, step);
          for (const s of who) assert.ok(r.game.alive[s], `seed ${seed} 死人在動作`);
          if (step === 'wolf') {
            for (const s of who) assert.equal(R.ROLES[r.game.roles[s]].team, 'wolf', `seed ${seed} 好人在狼人那步`);
            const ok = aliveList().filter(s => r.game.roles[s] !== 'beauty'); // 狼美人不能被自刀
            const t = rnd(3) ? ok[rnd(ok.length)] : 0;
            if (r.game.alive[aliveList().find(s => r.game.roles[s] === 'beauty')]) for (const s of who) rejected(E.nightAction(r, id(s), { target: aliveList().find(x => r.game.roles[x] === 'beauty') }, everyone(r), now, rnd), '刀狼美人');
            for (const s of who) tryAct(s, [{ target: t }]);
            // 隱狼一起投，但狼隊手機的資料裡不能有他的號碼
            const hid = who.find(s => r.game.roles[s] === 'hidden');
            // （狼隊死光、剩隱狼石像鬼時兩個會見面，不算）
            if (hid && r.phase === 'night' && waiting(r)) for (const s of who.filter(x => x !== hid && !R.LONE_WOLVES.includes(r.game.roles[x]))) {
              const a = E.privateGame(r, s).action;
              assert.ok(!a.killers.includes(hid) && !(hid in a.votes) && !E.privateGame(r, s).wolves.some(w => w.seat === hid), `seed ${seed} 狼隊看到隱狼號碼：${s} 號 ${r.game.roles[s]}，誰在投：${who.map(x => r.game.roles[x])}`);
            }
            assert.ok(tryAct(who[0], [{ confirm: true }]), `seed ${seed} 狼人確認失敗`);
          } else {
            const s = who[0], others = aliveList().filter(x => x !== s), t = others[rnd(others.length)] ?? 0;
            const ok = tryAct(s, [{ target: t }, { target: 0 }, { use: 'save' }, { use: 'skip' },
              { use: 'poison', target: t }, { use: 'none' }, { seen: true }]);
            assert.ok(ok, `seed ${seed} ${step} 沒有可以按的`);
            if (r.phase === 'night' && waiting(r) && curStep(r) === step) assert.ok(tryAct(s, [{ done: true }]), `seed ${seed} ${step} 按不完`);
          }
        } else {
          now = Math.max(now, r.game.timer.at);
          r = E.advance(r, now, rnd).room;
        }
        continue;
      }
      // 白天
      const g = r.game;
      const live = s => g.alive[s] && !(g.day.pendingDeaths ?? []).includes(s);
      const wolfBoomers = aliveList().filter(s => live(s) && R.ROLES[g.roles[s]].team === 'wolf' && g.roles[s] !== 'beauty');
      const wk0 = wolfBoomers[0], kn0 = aliveList().find(s => live(s) && g.roles[s] === 'knight' && !g.knightUsed);
      const beauty0 = aliveList().find(s => g.roles[s] === 'beauty');
      const anyone = aliveList().find(s => live(s) && s !== kn0) ?? aliveList()[0];
      if (beauty0) rejected(E.boom(r, id(beauty0), 0), '狼美人自爆');
      // 該擋的動作要擋：死訊公布前不能放逐、天黑；等白癡／移交警徽時什麼都不能做；唸了天黑請閉眼之後不能放逐、自爆、決鬥；投票後不能自爆
      if (g.day.pendingDeaths || g.day.idiotChoice || g.badgePending) {
        rejected(E.exile(r, anyone), '等死訊／白癡／警徽時放逐');
        rejected(E.nextNight(r, now), '等死訊／白癡／警徽時天黑');
        rejected(E.startVote(r), '等死訊／白癡／警徽時投票');
      }
      if (g.day.idiotChoice || g.badgePending) {
        if (wk0) rejected(E.boom(r, id(wk0), 0), '等白癡／警徽時自爆');
        if (kn0) rejected(E.duel(r, id(kn0), anyone), '等白癡／警徽時決鬥');
      }
      if (g.day.nightCalled) {
        rejected(E.exile(r, anyone), '天黑請閉眼後放逐');
        if (wk0) rejected(E.boom(r, id(wk0), 0), '天黑請閉眼後自爆');
        if (kn0) rejected(E.duel(r, id(kn0), anyone), '天黑請閉眼後決鬥');
      }
      if (g.day.exileDone && wk0) rejected(E.boom(r, id(wk0), 0), '投票後自爆');
      if (g.canShoot.length) {
        if (wk0) rejected(E.boom(r, id(wk0), 0), '等開槍時自爆');
        if (kn0) rejected(E.duel(r, id(kn0), anyone), '等開槍時決鬥');
      }
      const must = (res, why) => { assert.ok(res.ok, `seed ${seed} ${why}：${res.error}`); r = res.room; };
      // 警長：主機登記（警長競選時、或隨便哪天）、警長出局就移交或撕掉
      if (g.badgePending) { // 出局的警長自己選（主機不能代按）
        rejected(E.setSheriff(r, pickAlive()), '主機代替警長移交');
        rejected(E.tearBadge(r), '主機代替警長撕警徽');
        must(E.passBadge(r, id(g.sheriff), rnd(3) ? pickAlive() : 0), '警長處理警徽'); continue;
      }
      if (!g.sheriff && !g.badgeTorn && rnd(3) === 0) { must(E.setSheriff(r, pickAlive()), '登記警長'); continue; }
      // 警長競選中：騎士決鬥、狼人自爆也可以（之後順便公布死訊）
      // （按了一定先公布死訊；動作可能因為有人要開槍而不算，但房間照樣往下走）
      const soft = (res, why) => { assert.ok(res.ok || res.room, `seed ${seed} ${why}：${res.error}`); r = res.room; if (!res.ok) assert.equal(r.game.day?.pendingDeaths ?? null, null, `seed ${seed} ${why}被擋卻沒公布死訊`); };
      if (g.day.pendingDeaths && kn0 && rnd(6) === 0) { const t = aliveList().find(s => live(s) && s !== kn0); if (t) { soft(E.duel(r, id(kn0), t), '競選中決鬥'); continue; } }
      if (g.day.pendingDeaths && wk0 && rnd(6) === 0) { soft(E.boom(r, id(wk0), 0), '競選中自爆'); continue; }
      // 昨晚死了（還沒公布）的騎士按決鬥：死訊公布、決鬥不算
      const deadKn = (g.day.pendingDeaths ?? []).find(s => g.roles[s] === 'knight' && !g.knightUsed);
      if (deadKn && rnd(4) === 0) { const res = E.duel(r, id(deadKn), aliveList().find(s => s !== deadKn)); assert.equal(res.ok, false, `seed ${seed} 死掉的騎士決鬥成功了`); r = res.room; assert.equal(r.game.knightUsed, false); continue; }
      if (g.day.pendingDeaths) { r = E.announceDeaths(r).room; continue; }
      if (g.day.idiotChoice) { r = E.idiotChoose(r, id(g.day.idiotChoice), rnd(2) === 0).room; continue; }
      if (g.canShoot.length && rnd(8) === 0) { r = E.nextNight(r, now).room; continue; } // 主機太快按天黑，這槍沒了
      if (g.canShoot.length) { const s = g.canShoot[0]; const t = rnd(2) ? pickAlive() : 0; const res = E.shoot(r, id(s), t === s ? 0 : t); assert.ok(res.ok, res.error); r = res.room; continue; }
      if (wk0 && !g.day.exileDone && !g.day.nightCalled && rnd(6) === 0) {
        const t = g.roles[wk0] === 'whiteKing' ? pickAlive() : 0;
        must(E.boom(r, id(wk0), t === wk0 ? 0 : t), '自爆'); continue;
      }
      // 騎士白天隨時可以決鬥（放逐之後也行）
      if (kn0 && !g.day.nightCalled && rnd(5) === 0) {
        const t = pickAlive(); if (t !== kn0) { must(E.duel(r, id(kn0), t), '決鬥'); continue; }
      }
      if (!g.day.exileDone && !g.day.nightCalled) {
        if (rnd(2)) { // 玩家在手機上投票；統計出來後主機照最高票登記（平票就 PK 或平票沒人出局）
          must(E.startVote(r), '開始投票');
          const v = r.game.day.vote;
          for (const s of v.voters) {
            if (rnd(10) === 0) continue; // 有人沒投：主機提早結束
            const c = v.candidates.filter(x => x !== s);
            must(E.castVote(r, id(s), rnd(4) && c.length ? c[rnd(c.length)] : 0), '投票');
          }
          if (r.game.day.vote.open) must(E.endVote(r), '結束投票');
          const res0 = r.game.day.vote.result;
          const weight = s => (s === r.game.sheriff ? 1.5 : 1);
          const total = res0.rows.reduce((a, x) => a + x.score, 0) + res0.abstain.reduce((a, s) => a + weight(s), 0);
          assert.equal(total, r.game.day.vote.voters.reduce((a, s) => a + weight(s), 0), `seed ${seed} 票數對不起來`);
          if (res0.top.length > 1 && rnd(2)) { const pk = E.startVote(r, true); if (pk.ok) { r = pk.room; for (const s of r.game.day.vote.voters) must(E.castVote(r, id(s), r.game.day.vote.candidates[rnd(r.game.day.vote.candidates.length)]), 'PK 投票'); } }
          const top = r.game.day.vote?.result?.top ?? [];
          must(E.exile(r, top.length === 1 ? top[0] : 0), '照統計放逐'); continue;
        }
        must(E.exile(r, rnd(4) ? pickAlive() : 0), '放逐'); continue;
      }
      const res = E.nextNight(r, now); assert.ok(res.ok, `seed ${seed} 天黑：${res.error}`); r = res.room;
      // 狼隊還有人活著時，隱狼、石像鬼不會出現在狼人那步
      // 狼隊還有人活著時：狼人那步是狼隊＋隱狼（Leo 2026-10-27），石像鬼不在裡面；狼隊手機上看不到隱狼的號碼
      const pack = aliveList().filter(s => R.ROLES[r.game.roles[s]].team === 'wolf' && !R.LONE_WOLVES.includes(r.game.roles[s]));
      if (pack.length) assert.deepEqual(E.killers(r.game), aliveList().filter(s => pack.includes(s) || r.game.roles[s] === 'hidden'));
    }
    assert.ok(['good', 'wolf'].includes(r.game.winner), `seed ${seed} 沒有勝負`);
    if (r.game.winner === 'good') assert.equal(E.winnerOf(r.game, r.setup.counts, r.setup.rules), 'good');
  }
});
