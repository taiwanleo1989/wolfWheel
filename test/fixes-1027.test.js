// Leo 2026-10-27 修正清單：投票統計、騎士隨時決鬥、隱狼投票、夜裡減 5 秒、狼王手勢取消、警長／撕警徽、狼人自爆、綁票新規、狼美人
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/lobby.js';
import * as G from '../src/game.js';
import * as E from '../src/engine.js';
import * as R from '../public/shared/roles.js';

globalThis.document = { body: { classList: { toggle() {} } } };
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
const { renderGame, bindGame } = await import('../public/judge/game-ui.js');

const noShuffle = n => n - 1;
const minRand = () => 0;
const id = n => 'p' + n;
// B：1–3 狼人、4 預言家、5 女巫、6 獵人、7 守衛、8 騎士、9–11 平民
const B = { wolf: 3, seer: 1, witch: 1, hunter: 1, guard: 1, knight: 1, villager: 3 };
// H：1–2 狼人、3 隱狼、4 預言家、5 白癡、6–10 平民
const H = { wolf: 2, hidden: 1, seer: 1, idiot: 1, villager: 5 };

function newGame(counts, rules = {}) {
  const players = R.totalOf(counts);
  let r = L.newRoom('1234', players, 'host', 0);
  for (let n = 1; n <= players; n++) r = L.claimSeat(r, id(n), n, new Set()).room;
  r = G.setSetup(r, { counts, rules }).room;
  r = G.startDeal(r, noShuffle).room;
  return E.startGame(r, 0, minRand).room;
}
const everyone = r => new Set(Object.values(r.seats));
const curStep = r => r.game.night.steps[r.game.night.idx];
const waiting = r => r.phase === 'night' && r.game.night.stage === 'acting' && r.game.night.wait === 'people';
const ok = res => { assert.ok(res.ok, res.error); return res.room; };
// 跑完一晚：plan.wolf＝刀誰（預設空刀），其他角色都不動作
function play(r, plan = {}) {
  for (let i = 0; i < 300 && r.phase === 'night'; i++) {
    if (!waiting(r)) { r = E.advance(r, r.game.timer.at, minRand).room; continue; }
    const step = curStep(r), who = E.actors(r.game, step);
    const act = E.scriptFor(step, r.setup.counts).beats[r.game.night.beat].act;
    const go = (s, p) => { r = ok(E.nightAction(r, id(s), p, everyone(r), 0, minRand)); };
    if (act === 'wolf') { for (const w of who) go(w, { target: plan.wolf ?? 0 }); go(who[0], { confirm: true }); }
    else if (act === 'seer' || act === 'gargoyle') { go(who[0], { target: Object.keys(r.game.alive).map(Number).find(s => r.game.alive[s] && s !== who[0]) }); go(who[0], { done: true }); }
    else if (act === 'witchSave') go(who[0], { use: 'skip' });
    else if (act === 'witchPoison') go(who[0], plan.poison ? { use: 'poison', target: plan.poison } : { use: 'none' });
    else if (act === 'guard' || act === 'beauty') go(who[0], { target: 0 });
    else go(who[0], { seen: true });
  }
  return r;
}
const night = (r, plan) => { r = play(r, plan); return r.game.day?.pendingDeaths ? E.announceDeaths(r).room : r; };
// 直接改死活（測規則用）
const withDead = (r, seats) => ({ ...r, game: { ...r.game, alive: { ...r.game.alive, ...Object.fromEntries(seats.map(s => [s, false])) } } });

/* ───────── 1、3：投票 ───────── */
test('投票：主機開始 → 每個人在手機上點號碼 → 全部投完自動公布統計；警長 1.5 票、棄票、投完不能改', () => {
  let r = night(newGame(B));
  assert.equal(E.castVote(r, id(1), 9).ok, false, '主機還沒開始');
  assert.equal(E.startVote(r).ok, true);
  r = ok(E.setSheriff(r, 9));
  r = ok(E.startVote(r));
  const v = r.game.day.vote;
  assert.deepEqual(v.voters, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(E.privateGame(r, 2).vote.candidates.includes(2), false, '不能投自己');
  r = ok(E.castVote(r, id(1), 4));
  assert.equal(E.castVote(r, id(1), 5).ok, false, '投了不能改');
  assert.equal(E.castVote(r, id(2), 2).ok, false, '不能投自己');
  // 投票中：大家只看得到投了幾票，看不到誰投誰
  const pub = E.publicGame(r).vote;
  assert.equal(pub.voted, 1);
  assert.equal(pub.ballots, undefined);
  assert.equal(JSON.stringify(E.publicGame(r)).includes('"ballots"'), false);
  assert.equal(E.privateGame(r, 1).vote.mine, 4);
  for (const [s, t] of [[2, 4], [3, 4], [4, 1], [5, 1], [6, 1], [7, 0], [8, 1], [9, 4], [10, 0]]) r = ok(E.castVote(r, id(s), t));
  assert.equal(r.game.day.vote.open, true, '還有 11 號沒投');
  r = ok(E.castVote(r, id(11), 1));
  const res = r.game.day.vote.result;
  assert.equal(r.game.day.vote.open, false, '全部投完自動結束');
  assert.deepEqual(res.rows.map(x => [x.target, x.score]), [[1, 5], [4, 4.5]], '警長 9 號投 4 號算 1.5 票');
  assert.deepEqual(res.abstain, [7, 10]);
  assert.deepEqual(res.top, [1]);
  assert.equal(r.game.log.at(-2).text, '投票結果：1 號 5 票（4、5、6、8、11 號）；4 號 4.5 票（1、2、3、警長9 號）；棄票 7、10 號。最高票 1 號。');
  assert.deepEqual(E.publicGame(r).vote.result, res, '統計每支手機一樣');
  // 只有一個最高票：投完直接放逐、唸出局（Leo 2026-10-27）
  assert.equal(r.game.alive[1], false);
  assert.equal(r.game.day.exileDone, true);
  assert.equal(r.game.narration.text, '1 號被放逐出局。');
  assert.equal(r.game.log.at(-1).text, '1 號被放逐出局。');
  assert.equal(E.exile(r, 4).ok, false, '主機不會再放逐一次');
});

/* ───────── 第三輪（Leo 2026-10-27）：投完自動唸出局、棄票、PK 的人不投 ───────── */
// 投一輪：plan＝{座位: 投誰}（沒寫的棄票）
function voteAll(r, plan, pk = false) {
  r = ok(E.startVote(r, pk));
  for (const s of r.game.day.vote.voters) {
    if (!r.game.day.vote.open) break;
    r = ok(E.castVote(r, id(s), plan[s] ?? 0));
  }
  return r;
}

test('投完票：只有一個最高票就唸「N 號被放逐出局。」；能開槍的獵人接「N 號，請啟動角色技能。」；白癡不唸、等他自己選', () => {
  // 獵人 6 號被投出去
  let r = voteAll(night(newGame(B)), { 1: 6, 2: 6, 3: 6, 4: 1 });
  assert.equal(r.game.narration.text, '6 號被放逐出局。6 號，請啟動角色技能。');
  assert.deepEqual(r.game.narration.clips, ['n6', 'exiled', 'n6', 'comma', 'skillOn']);
  assert.deepEqual(r.game.canShoot, [6]);
  // 平民 9 號：只唸出局
  r = voteAll(night(newGame(B)), { 1: 9, 2: 9 });
  assert.equal(r.game.narration.text, '9 號被放逐出局。');
  // 白癡 5 號（H 板）：不唸，等他選翻不翻
  let h = night(newGame(H), { wolf: 10 });
  h = voteAll(h, { 1: 5, 2: 5, 3: 5 });
  assert.equal(h.game.day.idiotChoice, 5);
  assert.equal(h.game.narration.text, '請大家進行投票。', '白癡被投出去：主機什麼都不唸（最後一句還是開始投票那句）');
  assert.equal(h.game.alive[5], true);
  assert.equal(ok(E.idiotChoose(h, id(5), true)).game.narration.text, '5 號翻牌，是白癡，免於出局，但之後不能投票。');
  assert.equal(ok(E.idiotChoose(h, id(5), false)).game.narration.text, '5 號被放逐出局。', '不翻牌才唸出局');
  // 遊戲因此結束：出局接勝負
  let w = night(newGame(B));
  w = withDead(w, [2, 3]);
  w = voteAll(w, { 4: 1, 5: 1, 6: 1 });
  assert.equal(w.phase, 'ended');
  assert.equal(w.game.narration.text, '1 號被放逐出局。遊戲結束，好人陣營獲勝！');
});

test('投完票：狼王被投出去也喊「請啟動角色技能」；平票、全部棄票不自動放逐', () => {
  const K = { wolf: 2, king: 1, seer: 1, witch: 1, hunter: 1, villager: 3 };
  let r = night(newGame(K));
  r = voteAll(r, { 1: 3, 2: 3, 4: 3 });
  assert.equal(r.game.roles[3], 'king');
  assert.equal(r.game.narration.text, '3 號被放逐出局。3 號，請啟動角色技能。');
  // 平票：主機選 PK 或沒人出局
  let t = voteAll(night(newGame(B)), { 1: 9, 2: 10 });
  assert.deepEqual(t.game.day.vote.result.top, [9, 10]);
  assert.equal(t.game.day.exileDone, false);
  assert.equal(ok(E.exile(t, 0)).game.narration.text, '平票，今天沒有人出局。天黑請閉眼。', 'Leo 2026-10-28：接著天黑');
});

test('棄票（Leo 2026-10-27）：每個人都能棄票、統計列出棄票的人；全部棄票＝唸「今天沒有人出局。」（不是平票）', () => {
  let r = night(newGame(B));
  r = ok(E.startVote(r));
  // 畫面：棄票按鈕 → 是否正確 → 送 0
  const p3 = mount(r, id(3));
  assert.match(p3.html('#actionBox'), /data-do="vote0">棄票</);
  p3.click('#actionBox', 'do', 'vote0');
  assert.match(p3.html('#actionBox'), /這輪棄票，是否正確/);
  p3.click('#actionBox', 'do', 'yes');
  assert.deepEqual(p3.sent.at(-1), { type: 'vote', target: 0 });
  r = ok(E.castVote(r, id(3), 0));
  assert.match(mount(r, id(3)).html('#actionBox'), /你投了棄票/);
  for (const s of [1, 2, 4, 5, 6, 7, 8, 9, 10]) r = ok(E.castVote(r, id(s), 0));
  r = ok(E.castVote(r, id(11), 0));
  const res = r.game.day.vote.result;
  assert.deepEqual(res.abstain, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(res.top, []);
  assert.equal(r.game.day.exileDone, false, '全部棄票不自動放逐，主機選');
  assert.equal(r.game.log.at(-1).text, '投票結果：棄票 1、2、3、4、5、6、7、8、9、10、11 號。沒有人得票。');
  const host = mount(r, 'host');
  assert.match(host.html('#hostCtl'), /全部棄票，沒人出局/);
  assert.match(host.html('#voteBox'), /棄票[\s\S]*1、2、3/);
  const out = ok(E.exile(r, 0));
  assert.equal(out.game.narration.text, '今天沒有人出局。天黑請閉眼。');
  assert.deepEqual(out.game.narration.clips, ['noExile', 'nightStart']);
});

test('平票 PK（Leo 2026-10-27）：10 人、1 號 2 號 PK，只有 3～10 號能投；PK 的人手機顯示不能投；投完照樣自動放逐', () => {
  let r = night(newGame(H)); // 平安夜：10 人都活著
  assert.equal(Object.values(r.game.alive).filter(Boolean).length, 10);
  r = voteAll(r, { 3: 1, 4: 1, 5: 2, 6: 2 });
  assert.deepEqual(r.game.day.vote.result.top, [1, 2]);
  r = ok(E.startVote(r, true));
  const v = r.game.day.vote;
  assert.deepEqual(v.candidates, [1, 2]);
  assert.deepEqual(v.voters, [3, 4, 5, 6, 7, 8, 9, 10], '只有 3～10 號投票');
  assert.equal(E.castVote(r, id(1), 2).ok, false, '1 號不能投');
  assert.equal(E.castVote(r, id(2), 1).ok, false, '2 號不能投');
  assert.equal(E.castVote(r, id(3), 4).ok, false, '只能投 1、2 號');
  // 畫面：PK 的人看到說明、沒有投票鈕；其他人只能點 1、2
  const a1 = mount(r, id(1)).html('#actionBox');
  assert.match(a1, /平票 PK：你是被投的人[\s\S]*這輪你不能投票/);
  assert.ok(!a1.includes('data-do="vote"'));
  const a3 = mount(r, id(3)).html('#actionBox');
  assert.match(a3, /平票 PK：請投票/);
  assert.deepEqual([...a3.matchAll(/data-pick="(\d+)"/g)].map(x => Number(x[1])), [1, 2]);
  assert.match(mount(r, 'host').html('#voteBox'), /PK：1、2 號（這輪不投票）；投票的人：3、4、5、6、7、8、9、10 號/);
  for (const s of [3, 4, 5, 6, 7, 8, 9]) r = ok(E.castVote(r, id(s), s < 7 ? 2 : 1));
  r = ok(E.castVote(r, id(10), 0)); // 棄票也可以
  assert.deepEqual(r.game.day.vote.result.top, [2]);
  assert.equal(r.game.alive[2], false, 'PK 結果也自動放逐');
  assert.equal(r.game.narration.text, '2 號被放逐出局。');
});

test('投票：平票可以 PK（平手的人不投、其他人只能投他們）；主機可以提早結束（沒投的算棄票）', () => {
  let r = night(newGame(B));
  r = ok(E.startVote(r));
  for (const s of [1, 2, 3, 4]) r = ok(E.castVote(r, id(s), 9));
  for (const s of [5, 6, 7, 8]) r = ok(E.castVote(r, id(s), 10));
  r = ok(E.endVote(r));
  assert.deepEqual(r.game.day.vote.result.top, [9, 10]);
  assert.deepEqual(r.game.day.vote.result.abstain, [9, 10, 11]);
  assert.match(r.game.log.at(-1).text, /平票：9、10 號。$/);
  r = ok(E.startVote(r, true));
  assert.deepEqual(r.game.day.vote.candidates, [9, 10]);
  assert.deepEqual(r.game.day.vote.voters, [1, 2, 3, 4, 5, 6, 7, 8, 11]);
  assert.equal(E.castVote(r, id(9), 10).ok, false, 'PK 的人不投');
  assert.equal(E.castVote(r, id(1), 4).ok, false, '只能投 PK 的人');
  for (const s of [1, 2, 3, 4, 5, 6, 7, 8, 11]) r = ok(E.castVote(r, id(s), s < 6 ? 9 : 10));
  assert.deepEqual(r.game.day.vote.result.top, [9]);
  assert.equal(r.game.day.vote.result.pk, true);
  assert.equal(E.startVote(r, true).ok, false, '沒平票不能 PK');
});

test('投票：隱狼可以投票（Leo 2026-10-27）；翻過牌的白癡、死人不能投', () => {
  let r = night(newGame(H), { wolf: 10 });
  r = ok(E.exile(r, 5));
  r = ok(E.idiotChoose(r, id(5), true)); // 白癡翻牌
  r = ok(E.nextNight(r, 1e6));
  r = night(r);
  r = ok(E.startVote(r));
  assert.ok(r.game.day.vote.voters.includes(3), '隱狼有票');
  assert.ok(!r.game.day.vote.voters.includes(5), '翻牌白癡沒票');
  assert.ok(!r.game.day.vote.voters.includes(10), '死人沒票');
  assert.ok(E.privateGame(r, 3).vote, '隱狼手機出現投票');
  assert.equal(E.privateGame(r, 5).vote, undefined);
  r = ok(E.castVote(r, id(3), 4));
  assert.equal(E.castVote(r, id(5), 4).ok, false);
});

test('投票：什麼時候不能開始；投票中被騎士決鬥、狼人自爆打斷＝這輪作廢；主機直接放逐也作廢', () => {
  const p = play(newGame(B), { wolf: 9 });
  assert.equal(E.startVote(p).ok, false, '死訊還沒公布');
  let r = night(newGame(B), { wolf: 6 });
  assert.equal(E.startVote(r).ok, false, '獵人還沒開槍');
  r = ok(E.shoot(r, id(6), 0));
  r = ok(E.startVote(r));
  assert.equal(E.startVote(r).ok, false, '已經在投票');
  r = ok(E.castVote(r, id(1), 9));
  const d = ok(E.duel(r, id(8), 10)); // 撞到好人：騎士出局，這輪作廢
  assert.equal(d.game.day.vote, null);
  assert.equal(d.game.alive[8], false);
  assert.ok(ok(E.startVote(d)).game.day.vote.open, '主機再開一次');
  const b = ok(E.boom(r, id(2), 0));
  assert.equal(b.game.day.vote, null);
  const x = ok(E.exile(r, 9));
  assert.equal(x.game.day.vote, null);
  assert.equal(E.startVote(x).ok, false, '放逐後不能再投');
});

/* ───────── 6：警長 ───────── */
test('警長：主機登記（警長競選時就能登記）、座位表公開；警長出局由他自己在手機上選移交或撕警徽（Leo 2026-10-27），處理完才能往下', () => {
  let r = play(newGame(B), { wolf: 9 });
  assert.ok(r.game.day.pendingDeaths);
  r = ok(E.setSheriff(r, 9)); // 9 號昨晚死了，但死訊還沒公布：照規則可以當選
  assert.equal(E.publicGame(r).sheriff, 9);
  assert.equal(r.game.log.at(-1).text, '9 號當上警長。');
  assert.equal(E.setSheriff(r, 9).ok, false, '已經是警長');
  r = ok(E.announceDeaths(r));
  assert.equal(r.game.alive[9], false);
  assert.equal(E.publicGame(r).badgePending, true, '警長出局，等移交');
  assert.equal(E.startVote(r).ok, false);
  assert.equal(E.exile(r, 1).ok, false);
  assert.equal(E.nextNight(r, 1e6).ok, false);
  assert.equal(E.duel(r, id(8), 1).ok, false);
  // 主機不能代選；只有出局的警長本人能選
  assert.equal(E.setSheriff(r, 10).ok, false, '主機不能代替警長移交');
  assert.equal(E.tearBadge(r).ok, false, '主機不能代替警長撕警徽');
  assert.equal(E.passBadge(r, id(10), 4).ok, false, '別人不能選');
  assert.deepEqual(E.privateGame(r, 9).passBadge.candidates, [1, 2, 3, 4, 5, 6, 7, 8, 10, 11]);
  assert.equal(E.privateGame(r, 10).passBadge, undefined);
  assert.equal(E.passBadge(r, id(9), 9).ok, false, '不能移交給死人');
  const passed = ok(E.passBadge(r, id(9), 10));
  assert.equal(passed.game.sheriff, 10);
  assert.equal(passed.game.badgePending, false);
  assert.equal(passed.game.log.at(-1).text, '9 號警長把警徽移交給 10 號。');
  assert.equal(E.passBadge(passed, id(9), 4).ok, false, '選過就不用再選');
  const torn = ok(E.passBadge(r, id(9), 0));
  assert.equal(torn.game.sheriff, null);
  assert.equal(torn.game.badgeTorn, true);
  assert.equal(torn.game.log.at(-1).text, '9 號警長撕掉警徽，不交給任何人。');
  assert.equal(E.tearBadge(torn).ok, false);
  assert.ok(E.startVote(torn).ok);
  // 警徽流失（例如沒人當選）：主機可以登記「沒有警長」
  const lost = ok(E.tearBadge(night(newGame(B))));
  assert.equal(lost.game.badgeTorn, true);
  // 白天被放逐、被槍帶走的警長也一樣
  let d = night(newGame(B));
  d = ok(E.setSheriff(d, 10));
  d = ok(E.exile(d, 10));
  assert.equal(d.game.badgePending, true);
  assert.equal(E.nextNight(d, 1e6).ok, false, '先處理警徽才能天黑');
  assert.ok(E.nextNight(ok(E.passBadge(d, id(10), 11)), 1e6).ok);
  assert.equal(E.setSheriff({ ...d, phase: 'night' }, 4).ok, false, '晚上不能登記');
  assert.ok(G.HOST_ONLY.includes('sheriff') && G.HOST_ONLY.includes('tearBadge') && G.HOST_ONLY.includes('startVote') && G.HOST_ONLY.includes('endVote'));
  assert.ok(!G.HOST_ONLY.includes('vote'), '投票是每個玩家自己按');
  assert.ok(!G.HOST_ONLY.includes('passBadge'), '移交警徽是警長自己按');
});

/* ───────── 8：綁票 ───────── */
// 天亮那一刻的綁票檢查（bindCheck）：B 板子把人弄死到想要的局面
function dawnState(dead, sheriff = null, extra = {}) {
  const r = withDead(night(newGame(B)), dead);
  return { ...r.game, sheriff, day: { ...r.game.day, bindCheck: true }, ...extra };
}
test('綁票 8-1：警徽在好人手上，夜裡還有追輪次的技能（守衛、女巫解藥／毒藥、獵人）就不算綁票（Leo 2026-10-27）', () => {
  // 狼 1–3 ＋ 好人兩個：狼 3 票 ≥ 好人 2.5 票
  const only = keep => [4, 5, 6, 7, 8, 9, 10, 11].filter(s => !keep.includes(s));
  assert.equal(E.houseRuleWin(dawnState(only([7, 9]), 9)), null, '守衛活著');
  assert.equal(E.houseRuleWin(dawnState(only([6, 9]), 9)), null, '獵人活著');
  assert.equal(E.houseRuleWin(dawnState(only([5, 9]), 9)), null, '女巫還有藥');
  assert.equal(E.houseRuleWin(dawnState(only([5, 9]), 9, { potions: { save: false, poison: false } })), 'bind', '女巫沒藥了');
  assert.equal(E.houseRuleWin(dawnState(only([9, 10]), 9)), 'bind', '只剩平民');
  assert.equal(E.houseRuleWin(dawnState(only([8, 9]), 9)), 'bind', '警徽在好人手上時，騎士（白天的）不算');
  assert.equal(E.houseRuleWin(dawnState(only([7, 9]))), 'bind', '沒有警長：守衛不算（狼 3 > 好人 2）');
});

test('綁票 8-2：警徽在狼人手上，白天還有追輪次的技能（騎士）就不算綁票（Leo 2026-10-27）', () => {
  // 狼 1、2（1 號警長 2.5 票）＋ 好人兩個
  const dead = keep => [3, 4, 5, 6, 7, 8, 9, 10, 11].filter(s => !keep.includes(s));
  assert.equal(E.houseRuleWin(dawnState(dead([8, 9]), 1)), null, '騎士還沒決鬥');
  assert.equal(E.houseRuleWin(dawnState(dead([8, 9]), 1, { knightUsed: true })), 'bind', '騎士用過了');
  assert.equal(E.houseRuleWin(dawnState(dead([7, 9]), 1)), 'bind', '警徽在狼人手上時，守衛（夜裡的）不算');
  // 狼 1、2、3 ＋ 騎士＋平民：狼人拿警徽、騎士還在＝不綁票；騎士用過＝綁票
  const dead3 = [4, 5, 6, 7, 10, 11];
  assert.equal(E.houseRuleWin(dawnState(dead3, 2)), null);
  assert.equal(E.houseRuleWin(dawnState(dead3, 2, { knightUsed: true })), 'bind');
});

test('綁票（Leo 2026-10-27）：沒有警長時騎士還沒決鬥就不算綁票；騎士用過照舊判', () => {
  const dead3 = [4, 5, 6, 7, 10, 11]; // 狼 1、2、3 ＋ 8 騎士＋9 平民
  assert.equal(E.houseRuleWin(dawnState(dead3)), null, '3 對 2，騎士還沒決鬥');
  assert.equal(E.houseRuleWin(dawnState(dead3, null, { knightUsed: true })), 'bind');
  assert.equal(E.houseRuleWin(dawnState(dead3, null, { badgeTorn: true })), null, '警徽撕掉＝沒有警長，一樣');
  assert.equal(E.houseRuleWin(dawnState([4, 5, 6, 8, 10, 11])), 'bind', '沒有警長、沒有騎士：守衛 7 號不算（狼 3 > 好人 2）');
});

test('綁票：警長算 1.5 票；警長剛出局時先等他自己移交或撕警徽，處理完才判（實際流程）', () => {
  // 好人拿警徽、狼 2 對好人 2：2 < 2.5 不綁；狼拿警徽：2.5 ≥ 2 綁
  const two = [3, 4, 5, 6, 7, 8, 11];
  assert.equal(E.houseRuleWin(dawnState(two, 9)), null);
  assert.equal(E.houseRuleWin(dawnState(two, 1)), 'bind');
  // 實際一晚：狼 1–3，好人 7 守衛、9 平民（警長）、10 平民；狼刀死警長 9
  let r = night(newGame(B));
  r = ok(E.setSheriff(r, 9));
  r = withDead(r, [4, 5, 6, 8, 11]);
  r = ok(E.nextNight(r, 1e6));
  r = night(r, { wolf: 9 });
  assert.equal(r.phase, 'day', '警徽還沒處理，先不判綁票');
  assert.equal(r.game.badgePending, true);
  const toGood = ok(E.passBadge(r, id(9), 10));
  assert.equal(toGood.phase, 'day', '移交給好人、守衛活著（8-1：好人 1.5 票，晚上守對就能追一個輪次）：不綁票');
  const torn = ok(E.passBadge(r, id(9), 0));
  assert.equal(torn.phase, 'ended', '撕掉：狼 3 > 好人 2，綁票');
  assert.equal(torn.game.log.at(-2).text, '狼人不少於好人的票數，形成綁票，狼人陣營直接獲勝。');
  const toWolf = ok(E.passBadge(r, id(9), 1));
  assert.equal(toWolf.phase, 'ended', '移交給狼人、騎士已經死了：綁票');
});

/* ───────── 7：狼人自爆 ───────── */
test('狼人自爆：唸「N 號狼人自爆，天黑請閉眼。」，今天不放逐，主機按了才進黑夜；自爆的狼王不能開槍（Leo 2026-10-27）', () => {
  let r = night(newGame(B));
  assert.equal(E.privateGame(r, 2).canBoom, true);
  assert.equal(E.privateGame(r, 9).canBoom, undefined, '好人沒有');
  assert.equal(E.boom(r, id(9), 0).ok, false);
  r = ok(E.boom(r, id(2), 0));
  assert.equal(r.game.narration.text, '2 號狼人自爆，天黑請閉眼。');
  assert.deepEqual(r.game.narration.clips, ['n2', 'wolfBoom', 'comma', 'nightStart']);
  assert.equal(E.publicGame(r).nightReason, 'wolfBoom');
  assert.equal(E.exile(r, 1).ok, false);
  const seq = r.game.narration.seq;
  r = ok(E.nextNight(r, 1e6));
  assert.equal(r.game.narration.seq, seq, '天黑請閉眼不重唸');
  // 狼王自爆：不能開槍
  let k = night(newGame({ wolf: 1, king: 1, seer: 1, hunter: 1, villager: 3 }));
  k = ok(E.boom(k, id(2), 0));
  assert.deepEqual(k.game.canShoot, []);
  assert.equal(k.game.narration.text, '2 號狼人自爆，天黑請閉眼。', '不唸狼王，只唸狼人');
  // 隱狼不能自爆（Leo 2026-10-28）
  const h = night(newGame(H));
  assert.equal(E.privateGame(h, 3).canBoom, undefined);
  assert.equal(E.boom(h, id(3), 0).ok, false);
  // 最後一隻狼自爆：遊戲結束，「狼人自爆」接著「遊戲結束」
  let last = night(newGame({ wolf: 1, seer: 1, villager: 2 }));
  last = ok(E.boom(last, id(1), 0));
  assert.equal(last.phase, 'ended');
  assert.equal(last.game.narration.text, '1 號狼人自爆。遊戲結束，好人陣營獲勝！');
});

test('狼人自爆：警長競選中也可以，順便公布昨晚死訊；昨晚已經死的狼不能自爆；投票放逐後不行', () => {
  const p = play(newGame(B), { wolf: 9 });
  const b = ok(E.boom(p, id(1), 0));
  assert.equal(b.game.narration.text, '昨晚死亡的是 9 號。1 號狼人自爆，天黑請閉眼。');
  assert.equal(b.game.alive[9], false);
  assert.ok(E.nextNight(b, 1e6).ok);
  // 狼自刀：昨晚死的狼（還沒公布）按鈕照樣有（不洩漏），按了＝死訊公布、自爆不算
  const self = play(newGame(B), { wolf: 2 });
  assert.equal(E.privateGame(self, 2).canBoom, true);
  const sr = E.boom(self, id(2), 0);
  assert.equal(sr.ok, false);
  assert.equal(sr.room.game.narration.text, '昨晚死亡的是 2 號。');
  assert.equal(sr.room.game.day.nightCalled, undefined);
  const r = night(newGame(B));
  assert.equal(E.boom(ok(E.exile(r, 9)), id(1), 0).ok, false);
});

test('投票中不能換警長、撕警徽（警長那票的票數會跟著變；2026-10-27 審查）', () => {
  let r = night(newGame(B));
  r = ok(E.setSheriff(r, 9));
  r = ok(E.startVote(r));
  r = ok(E.castVote(r, id(9), 1));
  assert.equal(E.setSheriff(r, 10).ok, false);
  assert.equal(E.tearBadge(r).ok, false);
  r = ok(E.endVote(r));
  assert.equal(r.game.day.vote.result.rows[0].score, 1.5);
  assert.ok(E.setSheriff(r, 10).ok, '投完就可以');
});

/* ───────── 4、5 ───────── */
test('夜裡等待減 5 秒（Leo 2026-10-27）：重唸、跳過 25 秒；假等預設 8～20、最長 24；狼王沒有帶槍手勢', () => {
  assert.equal(E.REPEAT_MS, 25000);
  assert.equal(E.SKIP_MS, 25000);
  assert.deepEqual([R.DEFAULT_RULES.fakeWaitMin, R.DEFAULT_RULES.fakeWaitMax, R.FAKE_WAIT_CAP], [8, 20, 24]);
  assert.ok(R.FAKE_WAIT_CAP * 1000 < E.REPEAT_MS);
  assert.ok(!E.NIGHT_ORDER.includes('king'));
  const r = newGame({ wolf: 2, king: 1, seer: 1, hunter: 1, villager: 4 });
  assert.deepEqual(r.game.night.steps, ['wolf', 'seer', 'hunter', 'police']);
});

/* ───────── 畫面 ───────── */
function mount(room, clientId) {
  const els = {}, sent = [];
  const $ = s => (els[s] ??= { hidden: false, textContent: '', innerHTML: '', className: '', addEventListener(_, fn) { this.fn = fn; } });
  const ctx = {
    state: G.viewFor(room, everyone(room), clientId), $, esc: s => String(s), send: m => sent.push(m), toast() {},
    render: () => renderGame(ctx), setHTML: (el, h) => { el.innerHTML = h; },
    voice: { unlocked: true, bgmOn: false, voiceName: '測試', unlock() {}, stop() {}, setNight() {}, speak() {}, expectFresh() {}, holdUntil() {} },
  };
  renderGame(ctx);
  bindGame($);
  const key = attr => attr.replace(/-(\w)/g, (_, ch) => ch.toUpperCase()); // data-sheriff-pick → dataset.sheriffPick
  const click = (box, attr, value) => $(box).fn({ target: { closest: q => (q === `[data-${attr}]` ? { dataset: { [key(attr)]: value } } : null) } });
  return { $, click, html: box => $(box).innerHTML, hidden: box => $(box).hidden, sent };
}
globalThis.window = { confirm: () => true };

test('畫面：投票中騎士打開決鬥選號，不會連動投票的選號（2026-10-27 審查）', () => {
  let r = night(newGame(B));
  r = ok(E.startVote(r));
  const k = mount(r, id(8));
  k.click('#myInfo', 'me', 'show');
  k.click('#myInfo', 'do', 'duelOpen');
  k.click('#myInfo', 'skill-pick', '3');
  assert.match(k.html('#myInfo'), /決鬥 3 號/);
  assert.match(k.html('#actionBox'), /投 … 號/, '投票那格沒被選');
  k.click('#actionBox', 'pick', '5');
  k.click('#actionBox', 'do', 'vote');
  assert.match(k.html('#actionBox'), /投給 5 號，是否正確/);
  k.click('#myInfo', 'skill-pick', '4');
  assert.match(k.html('#myInfo'), /決鬥 4 號/, '確認視窗開著也能改決鬥的號碼');
  k.click('#myInfo', 'do', 'duel');
  assert.deepEqual(k.sent.at(-1), { type: 'duel', target: 4 });
});

test('畫面：主機按「進行投票」→ 唸「請大家進行投票。」→ 玩家點號碼（是否正確）→ 選完每支手機同時出現結果；主機照結果放逐／PK（Leo 2026-10-27）', () => {
  let r = night(newGame(B));
  const host = mount(r, 'host');
  assert.match(host.html('#hostCtl'), /data-host="startVote">進行投票</);
  assert.ok(!host.html('#hostCtl').includes('data-host-pick'), '手動點號碼放逐收起來了');
  host.click('#hostCtl', 'host', 'startVote');
  assert.deepEqual(host.sent.at(-1), { type: 'startVote' });
  r = ok(E.startVote(r));
  assert.equal(r.game.narration.text, '請大家進行投票。');
  assert.deepEqual(r.game.narration.clips, ['voteStart']);
  const p1 = mount(r, id(1));
  assert.match(p1.html('#actionBox'), /請投票[\s\S]*data-do="vote0"/);
  assert.ok(!p1.html('#actionBox').includes('data-pick="1"'), '不能投自己');
  p1.click('#actionBox', 'pick', '9');
  p1.click('#actionBox', 'do', 'vote');
  assert.match(p1.html('#actionBox'), /投給 9 號，是否正確/);
  p1.click('#actionBox', 'do', 'yes');
  assert.deepEqual(p1.sent.at(-1), { type: 'vote', target: 9 });
  assert.match(mount(r, 'host').html('#voteBox'), /投票中[\s\S]*已投 0／11/);
  for (let s = 1; s <= 11; s++) r = ok(E.castVote(r, id(s), s === 9 ? 10 : 9));
  const views = [1, 4, 9, 'host'].map(cid => mount(r, cid).html('#voteBox'));
  assert.match(views[0], /投票統計[\s\S]*9 號[\s\S]*10 票[\s\S]*最高票：9 號/);
  assert.ok(views.every(h => h === views[0]), '統計每支手機一樣（主機也一樣）');
  // 只有一個最高票：直接放逐、唸出局，主機不用再按（Leo 2026-10-27）
  assert.equal(r.game.narration.text, '9 號被放逐出局。');
  const h2 = mount(r, 'host');
  assert.match(h2.html('#hostCtl'), /✓ 今天的放逐已登記/);
  assert.ok(!h2.html('#hostCtl').includes('照投票結果'));
  // 「照投票結果：放逐」只在自動放逐被擋住時出現（例如舊房間）：照樣送放逐
  const blocked = { ...r, game: { ...r.game, alive: { ...r.game.alive, 9: true }, day: { ...r.game.day, exileDone: false } } };
  const hb = mount(blocked, 'host');
  assert.match(hb.html('#hostCtl'), /照投票結果：放逐 9 號/);
  hb.click('#hostCtl', 'host', 'exileTop');
  assert.deepEqual(hb.sent.at(-1), { type: 'exile', target: 9 });
  // 手動登記還在（沒投票時用）
  const h3 = mount(night(newGame(B)), 'host');
  h3.click('#hostCtl', 'host', 'manualExile');
  assert.match(h3.html('#hostCtl'), /手動登記被放逐的人[\s\S]*data-host-pick="1"/);
  // 平票：主機看到 PK 鈕
  let t = night(newGame(B));
  t = ok(E.startVote(t));
  for (let s = 1; s <= 11; s++) t = ok(E.castVote(t, id(s), s <= 5 || s === 9 ? (s === 9 ? 10 : 9) : s === 10 ? 0 : 10));
  const ht = mount(t, 'host');
  assert.match(ht.html('#hostCtl'), /平票 PK（9、10 號）[\s\S]*平票，沒人出局/);
  assert.ok(!ht.html('#hostCtl').includes('照投票結果'), '平票不自動放逐');
  ht.click('#hostCtl', 'host', 'pk');
  assert.deepEqual(ht.sent.at(-1), { type: 'startVote', pk: true });
  assert.equal(ok(E.startVote(t, true)).game.narration.text, '請大家進行投票。', 'PK 也唸');
});

test('畫面：主機登記警長；警長出局由他自己的手機選移交或撕警徽（主機只能等）；座位表標「警長」；狼美人不能刀、昨晚魅惑過的不能選', () => {
  let r = play(newGame(B), { wolf: 9 });
  const host = mount(r, 'host');
  assert.match(host.html('#hostCtl'), /警長競選[\s\S]*data-sheriff-pick="4"[\s\S]*警長是 … 號[\s\S]*警徽流失/);
  host.click('#hostCtl', 'sheriff-pick', '4');
  host.click('#hostCtl', 'host', 'sheriff');
  assert.deepEqual(host.sent.at(-1), { type: 'sheriff', seat: 4 });
  r = ok(E.setSheriff(r, 4));
  assert.match(mount(r, id(1)).html('#boardSeats'), /<span class="n">4<\/span><span class="tag">警長<\/span>/);
  r = ok(E.announceDeaths(r));
  r = ok(E.exile(r, 4));
  const h2 = mount(r, 'host');
  assert.match(h2.html('#hostCtl'), /警長 4 號出局了[\s\S]*等他在自己的手機上選/);
  assert.ok(!h2.html('#hostCtl').includes('data-sheriff-pick'), '主機沒有代選的按鈕');
  const s4 = mount(r, id(4));
  assert.match(s4.html('#actionBox'), /你是警長，你出局了[\s\S]*data-badge-pick="1"[\s\S]*撕掉警徽/);
  assert.ok(!s4.html('#actionBox').includes('data-badge-pick="4"'), '不能移交給自己（已出局）');
  s4.click('#actionBox', 'badge-pick', '5');
  assert.match(s4.html('#actionBox'), /移交給 5 號/);
  s4.click('#actionBox', 'do', 'passBadge');
  assert.deepEqual(s4.sent.at(-1), { type: 'passBadge', target: 5 });
  s4.click('#actionBox', 'do', 'tearBadge');
  assert.deepEqual(s4.sent.at(-1), { type: 'passBadge', target: 0 });
  assert.ok(!mount(r, id(5)).html('#actionBox').includes('badge-pick'), '別人沒有');
  // 狼人的刀人畫面：狼美人那格不能點；狼美人昨晚魅惑的那格不能點
  const FB = { wolf: 2, beauty: 1, seer: 1, witch: 1, villager: 3 }; // 1–2 狼人、3 狼美人、4 預言家、5 女巫、6–8 平民
  let w = newGame(FB);
  for (let i = 0; i < 50 && !(waiting(w) && curStep(w) === 'wolf'); i++) w = E.advance(w, w.game.timer.at, minRand).room;
  assert.match(mount(w, id(1)).html('#actionBox'), /data-pick="3" disabled[\s\S]*不能刀/);
  w = night(w);
  w = ok(E.nextNight(w, 1e6));
  w = { ...w, game: { ...w.game, charm: 6 } };
  for (let i = 0; i < 80 && !(waiting(w) && curStep(w) === 'beauty'); i++) {
    if (waiting(w)) { const who = E.actors(w.game, 'wolf'); for (const s of who) w = ok(E.nightAction(w, id(s), { target: 0 }, everyone(w), 0, minRand)); w = ok(E.nightAction(w, id(who[0]), { confirm: true }, everyone(w), 0, minRand)); }
    else w = E.advance(w, w.game.timer.at, minRand).room;
  }
  assert.match(mount(w, id(3)).html('#actionBox'), /昨晚魅惑的是 6 號[\s\S]*data-pick="6" disabled[\s\S]*昨晚魅惑過/);
});
