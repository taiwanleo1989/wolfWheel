// 角色說明頁（public/roles/index.html）跟遊戲實際判法逐條核對（Leo 2026-10-27）。
// 頁面上每一條 <li data-rule="…"> 在 CHECKS 都要有一個檢查、反過來也一樣；檢查照那條規則實際跑引擎。
// 頁面上的 <span class="say"> 是主機台詞，要跟引擎唸出來的一字不差（N、M 換成號碼）；
// <b data-const> 是秒數，要跟程式裡的設定一樣；角色卡的「遊戲裡的簡介」要跟 roles.js 的 desc 一樣。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../src/lobby.js';
import * as G from '../src/game.js';
import * as E from '../src/engine.js';
import * as R from '../public/shared/roles.js';
import { LINES } from '../public/shared/voice-lines.js';

globalThis.document = { body: { classList: { toggle() {} } } };
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.window = { confirm: () => true };
const { renderGame, bindGame } = await import('../public/judge/game-ui.js');

const HTML = readFileSync(new URL('../public/roles/index.html', import.meta.url), 'utf8');
const liOf = id => { const m = HTML.match(new RegExp(`<li data-rule="${id}">([\\s\\S]*?)</li>`)); assert.ok(m, `頁面沒有 ${id}`); return m[1]; };
const says = id => [...liOf(id).matchAll(/<span class="say">([^<]*)<\/span>/g)].map(m => m[1]);
const textOf = id => liOf(id).replace(/<[^>]+>/g, '');
const fill = (s, v = {}) => s.replaceAll('N 號', `${v.N} 號`).replaceAll('M 號', `${v.M} 號`);

/* ───────── 開局與推進的小工具 ───────── */
const noShuffle = n => n - 1;
const minRand = () => 0;
const maxRand = n => n - 1;
const id = n => 'p' + n;
// 發牌不洗牌：座位照 ROLE_ORDER 排（狼人、狼王、白狼王、狼美人、隱狼、石像鬼、預言家、女巫、獵人、守衛、守墓人、騎士、白癡、平民）
// B：1–3 狼人、4 預言家、5 女巫、6 獵人、7 守衛、8 騎士、9–11 平民
const B = { wolf: 3, seer: 1, witch: 1, hunter: 1, guard: 1, knight: 1, villager: 3 };
// F：1–2 狼人、3 狼王、4 白狼王、5 狼美人、6 隱狼、7 石像鬼、8 預言家、9 女巫、10 獵人、11 守衛、12 守墓人、13 騎士、14 白癡、15–16 平民
const F = { wolf: 2, king: 1, whiteKing: 1, beauty: 1, hidden: 1, gargoyle: 1, seer: 1, witch: 1, hunter: 1, guard: 1, gravekeeper: 1, knight: 1, idiot: 1, villager: 2 };
// KG：1 狼人、2 狼王、3 白狼王、4 預言家、5 女巫、6 獵人、7 騎士、8–10 平民
const KG = { wolf: 1, king: 1, whiteKing: 1, seer: 1, witch: 1, hunter: 1, knight: 1, villager: 3 };

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
const no = (res, why) => assert.equal(res.ok, false, why);
const act = (r, s, p) => ok(E.nightAction(r, id(s), p, everyone(r), 0, minRand));
// 跑一晚。plan：wolf 刀誰（預設空刀）、guard、save、poison、charm、seer、gargoyle；stop＝停在某一步某一句（還沒動作）
function play(r, plan = {}, stop) {
  const rand = plan.rand ?? minRand;
  for (let i = 0; i < 500 && r.phase === 'night'; i++) {
    const n = r.game.night;
    if (stop && n.stage === 'acting' && curStep(r) === stop.step && n.beat === (stop.beat ?? 0)) return r;
    if (!waiting(r)) { r = E.advance(r, r.game.timer.at, rand).room; continue; }
    const step = curStep(r), who = E.actors(r.game, step);
    const a = E.scriptFor(step, r.setup.counts).beats[n.beat].act;
    const firstOther = s => Object.keys(r.game.alive).map(Number).find(x => r.game.alive[x] && x !== s);
    if (a === 'wolf') { for (const w of who) r = act(r, w, { target: plan.wolf ?? 0 }); r = act(r, who[0], { confirm: true }); }
    else if (a === 'seer' || a === 'gargoyle') { r = act(r, who[0], { target: plan[a] ?? firstOther(who[0]) }); r = act(r, who[0], { done: true }); }
    else if (a === 'witchSave') r = act(r, who[0], { use: plan.save ? 'save' : 'skip' });
    else if (a === 'witchPoison') r = act(r, who[0], plan.poison ? { use: 'poison', target: plan.poison } : { use: 'none' });
    else if (a === 'guard') r = act(r, who[0], { target: plan.guard ?? 0 });
    else if (a === 'beauty') r = act(r, who[0], { target: plan.charm ?? 0 });
    else r = act(r, who[0], { seen: true });
  }
  return r;
}
// 跑完一晚，第一天有上警就順便公布死訊
const night = (r, plan) => { r = play(r, plan); return r.game.day?.pendingDeaths ? E.announceDeaths(r).room : r; };
const nextDay = (r, plan) => night(ok(E.nextNight(r, 0)), plan);
const toNight = (r, step, beat = 0, plan = {}) => play(ok(E.nextNight(r, 0)), plan, { step, beat });
const dead = seats => Object.fromEntries(seats.map(s => [s, false]));
const withDead = (r, seats) => ({ ...r, game: { ...r.game, alive: { ...r.game.alive, ...dead(seats) } } });
const setG = (r, patch) => ({ ...r, game: { ...r.game, ...patch } });
// 投一輪：plan＝{座位: 投誰}，沒寫的棄票
function voteAll(r, plan, pk = false) {
  r = ok(E.startVote(r, pk));
  for (const s of r.game.day.vote.voters) {
    if (!r.game.day.vote?.open) break;
    r = ok(E.castVote(r, id(s), plan[s] ?? 0));
  }
  return r;
}
const pick = (r, seat) => E.privateGame(r, seat);
// 綁票、一狼一神一民：只活著 alive 這些人，在天亮睜眼（或投完票）那一刻判
function houseAt(counts, alive, extra = {}, day = {}, rules) {
  const r = night(newGame(counts, rules));
  const g = r.game;
  const all = Object.keys(g.alive).map(Number);
  const state = { ...g, alive: Object.fromEntries(all.map(s => [s, alive.includes(s)])), ...extra, day: { ...g.day, bindCheck: true, ...day } };
  return E.houseRuleWin(state, r.setup.rules);
}

/* ───────── 模擬手機畫面（同 fixes-1027.test.js） ───────── */
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
  const key = attr => attr.replace(/-(\w)/g, (_, ch) => ch.toUpperCase());
  const click = (box, attr, value) => $(box).fn({ target: { closest: q => (q === `[data-${attr}]` ? { dataset: { [key(attr)]: value } } : null) } });
  return { click, html: box => $(box).innerHTML, sent };
}

/* ───────── 每一條規則的檢查 ───────── */
const CHECKS = {
  /* 陣營與勝負 */
  'all-1': () => {
    const team = t => R.ROLE_ORDER.filter(x => R.ROLES[x].team === t);
    assert.deepEqual(team('wolf'), ['wolf', 'king', 'whiteKing', 'beauty', 'hidden', 'gargoyle']);
    assert.deepEqual(team('god'), ['seer', 'witch', 'hunter', 'guard', 'gravekeeper', 'knight', 'idiot']);
    assert.deepEqual(team('villager'), ['villager']);
    const t = textOf('all-1');
    for (const x of R.ROLE_ORDER) assert.ok(t.includes(R.ROLES[x].name), R.ROLES[x].name);
  },
  'all-2': () => {
    const r = night(newGame(B)), g = r.game;
    const W = (d, counts = r.setup.counts, gg = g) => E.winnerOf({ ...gg, alive: { ...gg.alive, ...dead(d) } }, counts, r.setup.rules);
    assert.equal(r.setup.rules.win, 'side', '預設屠邊');
    assert.equal(W([4, 5, 6, 7, 8]), 'wolf', '神全滅');
    assert.equal(W([9, 10, 11]), 'wolf', '民全滅');
    assert.equal(W([1, 2, 3]), 'good', '狼全滅');
    assert.equal(W([4, 5, 6, 7, 9, 10]), null);
    // 板子上沒有平民：只看神
    const nv = night(newGame({ wolf: 2, seer: 1, witch: 1, hunter: 1, guard: 1, knight: 1 }));
    assert.equal(W([3, 4, 5, 6], nv.setup.counts, nv.game), null);
    assert.equal(W([3, 4, 5, 6, 7], nv.setup.counts, nv.game), 'wolf');
  },
  'all-3': () => {
    const r = night(newGame(B, { win: 'all' })), g = r.game;
    const W = d => E.winnerOf({ ...g, alive: { ...g.alive, ...dead(d) } }, r.setup.counts, r.setup.rules);
    assert.equal(W([4, 5, 6, 7, 8]), null, '屠城：神全滅還沒結束');
    assert.equal(W([9, 10, 11]), null);
    assert.equal(W([4, 5, 6, 7, 8, 9, 10, 11]), 'wolf');
    assert.equal(W([1, 2, 3]), 'good');
    // 屠城也會提早判：綁票（好人還活著）
    const b = nextDay(withDead(r, [4, 5, 6, 7, 8]), { wolf: 9 });
    assert.equal(b.game.winner, 'wolf', '屠城：綁票照樣判');
  },
  'all-4': () => {
    const r = night(newGame(B)), g = r.game;
    assert.equal(E.winnerOf({ ...g, alive: { ...g.alive, ...dead([1, 2, 3, 4, 5, 6, 7, 8]) } }, r.setup.counts, r.setup.rules), 'wolf');
    // 實際流程：同一晚刀死最後一個神、毒死最後一隻狼
    let x = withDead(night(newGame(B, { police: false })), [2, 3, 4, 6, 7, 8]); // 剩 1 狼、5 女巫、9–11 平民
    x = nextDay(x, { wolf: 5, poison: 1 });
    assert.equal(x.phase, 'ended');
    assert.equal(x.game.winner, 'wolf');
    // 白天：最後一隻狼是狼美人，被放逐、魅惑的是最後一個神（5 人局）
    const bw = voteAll(night(newGame({ beauty: 1, seer: 1, villager: 3 }), { charm: 2 }), { 2: 1, 3: 1, 4: 1 });
    assert.equal(bw.game.winner, 'wolf', '狼美人殉情帶走最後一個神');
    // 最後一隻狼是白狼王，自爆帶走最後一個神
    assert.equal(ok(E.boom(night(newGame({ whiteKing: 1, seer: 1, villager: 3 })), id(1), 2)).game.winner, 'wolf');
    // 屠城：還有平民活著＝好人勝
    assert.equal(ok(E.boom(night(newGame({ whiteKing: 1, seer: 1, villager: 3 }, { win: 'all' })), id(1), 2)).game.winner, 'good', '屠城：白狼王帶走最後一個神');
    let y = withDead(night(newGame(B, { police: false, win: 'all' })), [2, 3, 4, 6, 7, 8]);
    y = nextDay(y, { wolf: 5, poison: 1 });
    assert.equal(y.game.winner, 'good', '屠城：刀最後一個神＋毒最後一隻狼');
  },
  'all-5': () => {
    const KS = { king: 1, seer: 1, witch: 1, villager: 3 }; // 1 狼王、2 預言家、3 女巫、4–6 平民
    const base = voteAll(withDead(night(newGame(KS)), [3]), { 2: 1, 4: 1, 5: 1 });
    assert.equal(base.phase, 'day', '狼全滅但狼王能開槍：先等');
    assert.deepEqual(base.game.canShoot, [1]);
    const took = ok(E.shoot(base, id(1), 2));
    assert.equal(took.game.winner, 'wolf', '帶走最後一個神＝同時達成＝狼勝');
    assert.equal(ok(E.shoot(base, id(1), 0)).game.winner, 'good', '不開槍＝好人勝');
    assert.equal(ok(E.nextNight(base, 0)).game.winner, 'good', '主機按天黑作廢這一槍＝好人勝');
    // 屠城：帶走最後一個神還有平民 → 好人勝；要帶走最後一個好人才算
    const all = voteAll(withDead(night(newGame(KS, { win: 'all' })), [3]), { 2: 1, 4: 1, 5: 1 });
    assert.equal(ok(E.shoot(all, id(1), 2)).game.winner, 'good');
    const last = voteAll(withDead(night(newGame(KS, { win: 'all' })), [2, 3, 5, 6]), { 4: 1 });
    assert.equal(ok(E.shoot(last, id(1), 4)).game.winner, 'wolf');
  },
  'all-6': () => {
    // 屠城（避免屠邊先結束）：只剩 3 狼＋2 民，天亮睜眼 3 ≥ 2 → 綁票
    let r = withDead(night(newGame(B, { win: 'all' })), [4, 5, 6, 7, 8]);
    r = nextDay(r, { wolf: 9 });
    assert.equal(r.phase, 'ended');
    assert.equal(r.game.winner, 'wolf');
    assert.ok(r.game.log.some(e => e.text.includes('形成綁票')));
    // 有人要開槍：先等槍開完才判
    let h = withDead(night(newGame(B, { win: 'all' })), [4, 5, 7, 8, 11]); // 1–3 狼、6 獵人、9、10 平民
    h = nextDay(h, { wolf: 6 });
    assert.equal(h.phase, 'day', '獵人還沒開槍，先不判');
    h = ok(E.shoot(h, id(6), 1));
    assert.equal(h.game.winner, 'wolf', '槍開完：狼 2 ≥ 好人 2 → 綁票');
    // 警長 1.5 票：3 狼 vs 3 好人（警長是好人）＝3 < 3.5
    assert.equal(houseAt(B, [1, 2, 3, 9, 10, 11], { sheriff: 9 }), null);
    assert.equal(houseAt(B, [1, 2, 3, 9, 10, 11]), 'bind', '沒有警長 3 ≥ 3');
    // 翻過牌的白癡沒有票
    const I = { wolf: 2, idiot: 1, villager: 3 }; // 1、2 狼、3 白癡、4–6 平民
    assert.equal(houseAt(I, [1, 2, 3, 4, 5]), null, '2 < 3');
    assert.equal(houseAt(I, [1, 2, 3, 4, 5], { idiotRevealed: [3] }), 'bind', '白癡沒票：2 ≥ 2');
  },
  'all-7': () => {
    const P = (save, poison) => ({ potions: { save, poison } });
    // 警徽在好人手上：守衛、女巫還有任一瓶藥、獵人 → 不綁；騎士不算
    assert.equal(houseAt(B, [1, 2, 3, 7, 9], { sheriff: 9 }), null, '守衛');
    assert.equal(houseAt(B, [1, 2, 3, 9, 10], { sheriff: 9 }), 'bind');
    assert.equal(houseAt(B, [1, 2, 3, 5, 9], { sheriff: 9 }), null, '女巫兩瓶');
    assert.equal(houseAt(B, [1, 2, 3, 5, 9], { sheriff: 9, ...P(true, false) }), null, '女巫只剩解藥');
    assert.equal(houseAt(B, [1, 2, 3, 5, 9], { sheriff: 9, ...P(false, true) }), null, '女巫只剩毒藥');
    assert.equal(houseAt(B, [1, 2, 3, 5, 9], { sheriff: 9, ...P(false, false) }), 'bind', '女巫沒藥');
    assert.equal(houseAt(B, [1, 2, 3, 6, 9], { sheriff: 9 }), null, '獵人');
    assert.equal(houseAt(B, [1, 2, 3, 8, 9], { sheriff: 9 }), 'bind', '好人警長：騎士不算');
    // 警徽在狼人手上：只看騎士還沒決鬥
    assert.equal(houseAt(B, [1, 2, 3, 8, 9, 10], { sheriff: 1 }), null, '騎士還沒決鬥');
    assert.equal(houseAt(B, [1, 2, 3, 8, 9, 10], { sheriff: 1, knightUsed: true }), 'bind');
    assert.equal(houseAt(B, [1, 2, 3, 7, 9, 10], { sheriff: 1 }), 'bind', '狼警長：守衛不算');
    assert.equal(houseAt(B, [1, 2, 3, 9, 10], { sheriff: 1 }), 'bind', '騎士沒決鬥就死了：照樣綁');
    assert.equal(houseAt(B, [1, 2, 3, 9]), 'bind', '沒有警長、騎士死了');
    // 沒有警長：騎士還沒決鬥 → 不綁；不然要剛好相等＋守衛＋女巫有毒藥
    assert.equal(houseAt(B, [1, 2, 3, 8, 9]), null);
    assert.equal(houseAt(B, [1, 2, 3, 8, 9], { knightUsed: true }), 'bind');
    assert.equal(houseAt(B, [1, 2, 3, 5, 7, 9]), null, '3 = 3、守衛＋毒藥');
    assert.equal(houseAt(B, [1, 2, 3, 5, 7, 9], P(true, false)), 'bind', '沒毒藥');
    assert.equal(houseAt(B, [1, 2, 3, 5, 7]), 'bind', '3 > 2');
    assert.equal(houseAt(B, [1, 2, 3, 5, 7, 9], { sheriff: null, badgeTorn: true }), null, '撕掉警徽＝沒有警長');
    // 翻過牌的白癡拿著警徽＝警徽在好人手上（但沒有 0.5 票）
    const IG = { wolf: 2, idiot: 1, guard: 1, villager: 2 }; // 1、2 狼、3 守衛、4 白癡、5、6 平民
    assert.equal(houseAt(IG, [1, 2, 3, 4], { sheriff: 4, idiotRevealed: [4] }), null, '守衛活著');
    assert.equal(houseAt(IG, [1, 2, 4, 5], { sheriff: 4, idiotRevealed: [4] }), 'bind', '狼 2 ≥ 好人 1（白癡警長沒票）');
  },
  'all-8': () => {
    const L3 = (alive, extra = {}, rules) => houseAt(B, alive, extra, { exileDone: true, bindCheck: false }, rules);
    assert.equal(L3([1, 4, 9]), 'lastThree');
    assert.equal(houseAt(B, [1, 4, 9], {}, { bindCheck: false }), null, '還沒投票不判');
    assert.equal(L3([1, 7, 9]), null, '守衛活著');
    assert.equal(L3([1, 5, 9]), null, '女巫有解藥');
    assert.equal(L3([1, 5, 9], { potions: { save: false, poison: true } }), 'lastThree', '屠邊：毒藥不算');
    assert.equal(L3([1, 5, 9], { potions: { save: false, poison: true } }, { win: 'all' }), null, '屠城：毒藥算');
    assert.equal(L3([1, 6, 9]), 'lastThree', '屠邊：獵人不算');
    assert.equal(L3([1, 6, 9], {}, { win: 'all' }), null);
    assert.equal(L3([1, 8, 9]), 'lastThree', '屠邊：騎士不算');
    assert.equal(L3([1, 8, 9], {}, { win: 'all' }), null);
    assert.equal(L3([1, 8, 9], { knightUsed: true }, { win: 'all' }), 'lastThree');
    assert.equal(L3([1, 4, 9], { canShoot: [6] }), null, '有人要開槍：先等');
    // 實際流程：平票沒人出局也算投完票
    let r = voteAll(withDead(night(newGame(B)), [2, 3, 5, 6, 7, 8, 10, 11]), { 1: 4, 4: 1 });
    assert.deepEqual(r.game.day.vote.result.top, [1, 4]);
    r = ok(E.exile(r, 0));
    assert.equal(r.game.winner, 'wolf');
    assert.ok(!r.game.narration.text.includes(LINES.nightStart), '沒人出局這一下就分出勝負：不唸天黑');
    const five = withDead(night(newGame(B)), [2, 3, 5, 6, 7, 11]); // 1 狼、4 預言家、8 騎士、9、10 平民
    assert.equal(ok(E.duel(ok(E.exile(five, 10)), id(8), 9)).game.winner, 'wolf', '登記之後決鬥才剩三人：判');
    const four = withDead(night(newGame(B)), [2, 3, 5, 6, 7, 10, 11]); // 1 狼、4 預言家、8 騎士、9 平民
    assert.equal(ok(E.duel(four, id(8), 9)).phase, 'day', '登記之前：不判');
    const man = withDead(night(newGame(B)), [2, 3, 5, 6, 7, 8, 11]); // 1、4、9、10
    assert.equal(ok(E.exile(man, 10)).game.winner, 'wolf', '手動登記放逐也算');
  },
  'all-9': () => {
    let r = night(newGame(B));
    const host = G.viewFor(r, everyone(r), 'host');
    assert.equal(host.you?.game ?? null, null, '主機沒坐下：沒有私人資料');
    assert.ok(!JSON.stringify(host).includes('"roles"'));
    const seated = G.viewFor(r, everyone(r), id(4));
    assert.equal(seated.you.role, 'seer', '坐下的主機／玩家看得到自己的身分');
    assert.ok(!JSON.stringify(seated).includes('"roles"'), '看不到別人的');
    assert.equal(E.publicGame(r).allRoles, undefined);
    r = ok(E.exile(withDead(r, [2, 3]), 1));
    assert.equal(r.phase, 'ended');
    assert.deepEqual(E.publicGame(r).allRoles, r.game.roles, '結束才翻開');
    // 喊技能＝透露不是被毒死：被毒的獵人不喊、被刀的喊
    assert.ok(!play(newGame(B, { police: false }), { poison: 6 }).game.narration.text.includes(LINES.skillOn));
    assert.ok(play(newGame(B, { police: false }), { wolf: 6 }).game.narration.text.includes(LINES.skillOn));
    // 狼美人出局唸殉情＝等於公開她是狼美人
    assert.ok(voteAll(night(newGame(F), { charm: 15 }), { 8: 5, 9: 5 }).game.narration.text.includes('15 號殉情出局。'));
    assert.ok(!voteAll(night(newGame(F)), { 8: 5, 9: 5 }).game.narration.text.includes('殉情'), '沒魅惑不唸');
    assert.ok(!ok(E.duel(night(newGame(F), { charm: 15 }), id(13), 5)).game.narration.text.includes('殉情'), '被撞死不唸');
  },

  /* 黑夜順序 */
  'night-1': () => {
    assert.deepEqual(newGame(B).game.night.steps, ['guard', 'wolf', 'witch', 'seer', 'hunter', 'police']);
    const f = newGame(F);
    assert.deepEqual(f.game.night.steps, ['guard', 'wolf', 'beauty', 'hidden', 'witch', 'seer', 'gargoyle', 'hunter', 'police'], '第一晚沒有守墓人；隱狼有自己的一步');
    assert.deepEqual(ok(E.nextNight(night(f), 0)).game.night.steps, ['guard', 'wolf', 'beauty', 'hidden', 'witch', 'seer', 'gargoyle', 'gravekeeper', 'hunter'], '第二晚起有守墓人、沒有上警');
    assert.ok(!newGame(B, { police: false }).game.night.steps.includes('police'), '上警可以關');
    assert.ok(!E.NIGHT_ORDER.includes('king'), '狼王帶槍手勢已取消');
    assert.ok(!E.NIGHT_ORDER.includes('whiteKing'), '白狼王沒有自己的一步');
    const lone = newGame({ hidden: 1, gargoyle: 1, seer: 1, villager: 4 });
    assert.ok(lone.game.night.steps.includes('wolf'), '只有隱狼、石像鬼也有狼人那步（石像鬼刀）');
    assert.equal(play(lone, {}, { step: 'wolf' }).game.narration.text, LINES.wolfOpen);
    assert.deepEqual(newGame({ hidden: 1, seer: 1, villager: 4 }).game.night.steps, ['hidden', 'seer', 'police'], '狼只有隱狼：不唸狼人請睜眼');
  },
  'night-2': () => {
    assert.equal(R.DEFAULT_RULES.fakeWaitMin, 8);
    assert.equal(R.DEFAULT_RULES.fakeWaitMax, 20);
    assert.equal(R.cleanRules({ fakeWaitMin: 60, fakeWaitMax: 60 }).fakeWaitMax, R.FAKE_WAIT_CAP);
    // 預言家死了：照樣唸、假等 8～20 秒
    const at = rand => {
      const r = toNight(withDead(night(newGame(B)), [4]), 'seer', 0, { rand });
      assert.equal(r.game.night.wait, 'fake');
      assert.equal(r.game.narration.text, LINES.seerOpen, '死掉的角色照樣唸');
      return (r.game.night.fakeEnd - r.game.night.openedAt) / 1000;
    };
    assert.equal(at(minRand), 8);
    assert.equal(at(maxRand), 20);
    // 女巫死了：兩句加起來只等一次（最長 20 秒）
    let w = toNight(withDead(night(newGame(B)), [5]), 'witch', 0, { rand: maxRand });
    const first = w.game.night.fakeEnd - w.game.night.openedAt;
    w = play(w, { rand: maxRand }, { step: 'witch', beat: 1 });
    const second = w.game.night.fakeEnd - w.game.night.openedAt;
    assert.equal((first + second) / 1000, 20);
  },
  'night-3': () => {
    assert.equal(E.REPEAT_MS, 25000);
    assert.ok(R.FAKE_WAIT_CAP * 1000 < E.REPEAT_MS, '假等一定比重唸短');
    // 活著的預言家 25 秒沒操作：重唸同一句
    let r = toNight(night(newGame(B)), 'seer');
    const seq = r.game.narration.seq;
    assert.equal(r.game.timer.at - r.game.night.openedAt, 25000);
    r = E.advance(r, r.game.timer.at, minRand).room;
    assert.equal(r.game.narration.seq, seq + 1);
    assert.equal(r.game.narration.text, LINES.seerOpen);
    // 狼人那步只重唸「狼人今晚要擊殺的目標是？」
    let w = toNight(night(newGame(B)), 'wolf');
    w = E.advance(w, w.game.timer.at, minRand).room;
    assert.equal(w.game.narration.text, '狼人今晚要擊殺的目標是？');
    assert.ok(textOf('night-3').includes(LINES.wolfAsk));
    // 死掉的預言家：假等結束就往下，不重唸
    let d = toNight(withDead(night(newGame(B)), [4]), 'seer', 0, { rand: maxRand });
    const dseq = d.game.narration.seq;
    assert.equal(d.game.timer.at, d.game.night.fakeEnd);
    d = E.advance(d, d.game.timer.at, minRand).room;
    assert.equal(d.game.narration.seq, dseq, '沒有重唸');
    assert.equal(E.pauseRepeat(toNight(night(newGame(B)), 'seer')).game.timer, null, '主機不在線上：活的角色也不重唸');
    assert.equal(d.game.night.stage, 'pause');
  },
  'night-4': () => {
    assert.equal(E.SKIP_MS, 25000);
    assert.equal(E.POLICE_MS, 5000);
    const r = toNight(night(newGame(B)), 'seer');
    const t0 = r.game.night.openedAt;
    const early = E.skipStep(r, t0 + 24999, minRand);
    no(early, '25 秒前不能跳過');
    assert.match(early.error, /25 秒/);
    const skipped = ok(E.skipStep(r, t0 + 25000, minRand));
    assert.equal(skipped.game.night.seerTarget, null, '跳過＝沒動作');
    const half = act(r, 4, { target: 1 }); // 查了、還沒按知道了
    assert.equal(ok(E.skipStep(half, t0 + 25000, minRand)).game.seerChecks.length, r.game.seerChecks.length + 1, '已經查的照樣記下');
    // 狼人選好了、還沒按正確就被跳過＝空刀
    let wv = toNight(night(newGame(B, { police: false })), 'wolf');
    for (const w of [1, 2, 3]) wv = act(wv, w, { target: 9 });
    assert.equal(wv.game.night.wolfProposal, 9);
    wv = ok(E.skipStep(wv, wv.game.night.openedAt + 25000, minRand));
    assert.equal(wv.game.night.wolfTarget, null, '跳過＝空刀');
    // 女巫兩句各自計時、各自跳過
    const w = toNight(night(newGame(B)), 'witch');
    const w1 = ok(E.skipStep(w, w.game.night.openedAt + 25000, minRand));
    const w2 = play(w1, {}, { step: 'witch', beat: 1 });
    assert.equal(w2.game.night.beat, 1, '跳過解藥，毒藥那句照樣開始');
    no(E.skipStep(w2, w2.game.night.openedAt + 24999, minRand), '毒藥那句重新算 25 秒');
    const p = play(newGame(B), {}, { step: 'police' });
    assert.equal(p.game.timer.at - p.game.night.openedAt, 5000, '上警 5 秒自動天亮');
    ok(E.skipStep(p, p.game.night.openedAt, minRand));
    // 上警時間到（或按了）之後還會再停 2～5 秒才天亮
    const pa = E.advance(p, p.game.timer.at, maxRand).room;
    assert.equal(pa.game.night.stage, 'pause');
    assert.equal(pa.game.timer.at - p.game.timer.at, 5000, '最長再停 5 秒（6＋5＝11）');
    assert.equal(E.advance(p, p.game.timer.at, minRand).room.game.timer.at - p.game.timer.at, 2000, '最短再停 2 秒（6＋2＝8）');
    assert.match(mount(p, 'host').html('#hostCtl'), /大約 7～10 秒後會自動天亮/);
  },
  'night-5': () => {
    const at = plan => play(newGame(B, { police: false }), plan);
    assert.equal(at({ wolf: 9, save: true }).game.alive[9], true, '救');
    assert.equal(at({ wolf: 9, guard: 9 }).game.alive[9], true, '守');
    assert.equal(at({ wolf: 9, guard: 9, save: true }).game.alive[9], false, '同守同救＝死');
    const p = at({ wolf: 9, poison: 10 });
    assert.equal(p.game.alive[10], false, '毒');
    assert.equal(p.game.narration.text, '天亮請睜眼。昨晚死亡的是 9 號、10 號。', '不說死因');
    // 第一晚有上警：主機按公布才公布
    let q = play(newGame(B), { wolf: 9 });
    assert.deepEqual(q.game.day.pendingDeaths, [9]);
    assert.equal(q.game.alive[9], true, '公布前座位表還是活的');
    q = ok(E.announceDeaths(q));
    assert.equal(q.game.alive[9], false);
  },

  /* 白天 */
  'day-1': () => {
    let r = night(newGame(F));
    assert.deepEqual(ok(E.startVote(r)).game.day.vote.voters, Array.from({ length: 16 }, (_, i) => i + 1), '隱狼（6）也有票');
    const v = ok(E.startVote(setG(withDead(r, [15]), { idiotRevealed: [14] }))).game.day.vote.voters;
    assert.ok(!v.includes(14) && !v.includes(15) && v.includes(6), '翻牌白癡、死人沒票');
    r = voteAll(ok(E.setSheriff(r, 8)), { 8: 16 });
    assert.equal(r.game.day.vote.result.rows[0].score, 1.5, '警長 1.5 票');
    // 警長是白癡、翻了牌：雖然沒死，但被公投出局、失去投票權，要交出警徽（Leo 2026-10-28）
    let s = ok(E.idiotChoose(voteAll(ok(E.setSheriff(night(newGame(F)), 14)), { 1: 14, 2: 14 }), id(14), true));
    assert.equal(s.game.alive[14], true);
    assert.equal(s.game.badgePending, true, '要交出警徽');
    assert.ok(!pick(s, 14).passBadge.candidates.includes(14), '不能交給自己');
    no(E.passBadge(s, id(14), 14), '不能交給自己');
    no(E.nextNight(s, 0), '選之前不能天黑');
    assert.match(mount(s, id(14)).html('#actionBox'), /你是警長，你翻牌了[\s\S]*發表遺言/);
    assert.match(mount(s, 'host').html('#hostCtl'), /警長 14 號翻牌了/);
    s = ok(E.passBadge(s, id(14), 8));
    assert.equal(s.game.sheriff, 8);
    // 翻過牌的白癡不能接警徽、不能被登記成警長
    no(E.setSheriff(ok(E.idiotChoose(voteAll(night(newGame(F)), { 1: 14, 2: 14 }), id(14), true)), 14), '翻過牌的白癡不能當警長');
    const s9 = ok(E.setSheriff(play(newGame(F), { wolf: 15 }), 15));
    const fl = setG(s9, { idiotRevealed: [14] });
    no(E.passBadge(fl, id(15), 14), '不能把警徽交給翻過牌的白癡');
    assert.ok(!pick(fl, 15).passBadge.candidates.includes(14));
    s = nextDay(s, {});
    assert.ok(!ok(E.startVote(s)).game.day.vote.voters.includes(14));
  },
  'day-2': () => {
    let r = ok(E.startVote(night(newGame(B))));
    assert.equal(r.game.narration.text, says('day-2')[0]);
    no(E.castVote(r, id(1), 1), '不能投自己');
    r = ok(E.castVote(r, id(1), 9));
    no(E.castVote(r, id(1), 10), '投了不能改');
    const pub = E.publicGame(r).vote;
    assert.equal(pub.voted, 1);
    assert.equal(pub.ballots, undefined, '投票中看不到誰投誰');
    const p2 = mount(r, id(2));
    assert.match(p2.html('#actionBox'), /data-do="vote0">棄票</);
    p2.click('#actionBox', 'pick', '9');
    p2.click('#actionBox', 'do', 'vote');
    assert.match(p2.html('#actionBox'), /投給 9 號，是否正確/);
    r = ok(E.castVote(r, id(2), 0));
    r = ok(E.endVote(r));
    const res = r.game.day.vote.result;
    assert.deepEqual(res.abstain, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], '棄票＋沒投的');
    assert.deepEqual(res.rows[0].voters, [1]);
    no(E.startVote(ok(E.exile(night(newGame(B)), 0))), '放逐登記之後不能再開始投票');
    no(E.startVote(play(newGame(B), { wolf: 9 })), '死訊公布前不能投票');
    const end = voteAll(withDead(night(newGame(B)), [2, 3]), { 4: 1, 5: 1 });
    assert.equal(end.phase, 'ended', '這一票直接結束遊戲');
    assert.match(mount(end, id(4)).html('#voteBox'), /投票統計[\s\S]*最高票：1 號/, '結算畫面也看得到統計');
  },
  'day-3': () => {
    const [out, skill] = says('day-3');
    let r = voteAll(night(newGame(B)), { 1: 9, 2: 9 });
    assert.equal(r.game.alive[9], false, '直接放逐');
    assert.equal(r.game.narration.text, fill(out, { N: 9 }));
    r = voteAll(night(newGame(B)), { 1: 6, 2: 6 });
    assert.equal(r.game.narration.text, fill(out, { N: 6 }) + fill(skill, { N: 6 }));
    r = voteAll(night(newGame(F)), { 1: 14, 2: 14 });
    assert.equal(r.game.day.idiotChoice, 14);
    assert.equal(r.game.narration.text, LINES.voteStart, '白癡：不唸');
    // 主機不投票、手動登記放逐：效果一樣
    const m = ok(E.exile(night(newGame(F)), 6));
    assert.equal(m.game.narration.text, fill(out, { N: 6 }));
    assert.deepEqual(m.game.graveInfo, { day: 1, seat: 6, wolf: false }, '守墓人看得到');
    assert.equal(ok(E.exile(night(newGame(F)), 14)).game.day.idiotChoice, 14, '白癡等他選');
  },
  'day-4': () => {
    let r = voteAll(night(newGame(B)), { 1: 9, 2: 10 });
    assert.deepEqual(r.game.day.vote.result.top, [9, 10]);
    assert.equal(r.game.day.exileDone, false, '平票不自動放逐');
    const no4 = ok(E.exile(r, 0));
    assert.equal(no4.game.narration.text, says('day-4')[0]);
    assert.equal(no4.game.day.nightCalled, true, '唸完今天就結束');
    assert.equal(no4.game.log.at(-1).text, '平票，今天沒有人出局。天黑請閉眼。', '紀錄也寫天黑');
    no(E.duel(no4, id(8), 1), '之後不能再決鬥');
    const nn = ok(E.nextNight(no4, 0));
    assert.equal(nn.game.narration.seq, no4.game.narration.seq, '進入黑夜不再唸一次天黑');
    assert.match(mount(no4, 'host').html('#hostCtl'), /今天沒有人出局[\s\S]*已經唸了「天黑請閉眼」/);
    const pk = ok(E.startVote(r, true));
    assert.deepEqual(pk.game.day.vote.candidates, [9, 10]);
    no(E.castVote(pk, id(9), 10), 'PK 的人不能投');
    no(E.castVote(pk, id(1), 4), '只能投 PK 的人');
    assert.ok(E.castVote(pk, id(1), 0).ok, 'PK 可以棄票');
    // 10 人、1 號 2 號 PK → 只有 3～10 號投
    const T = { wolf: 2, seer: 1, witch: 1, hunter: 1, villager: 5 };
    let t = voteAll(night(newGame(T)), { 3: 1, 4: 2 });
    t = ok(E.startVote(t, true));
    assert.deepEqual(t.game.day.vote.voters, [3, 4, 5, 6, 7, 8, 9, 10]);
    // 也可以重新投票；PK 又平手可以再 PK
    assert.equal(ok(E.startVote(r)).game.day.vote.pk, false);
    let again = voteAll(r, { 1: 9, 2: 10 }, true);
    assert.deepEqual(again.game.day.vote.result.top, [9, 10]);
    assert.ok(E.startVote(again, true).ok, 'PK 又平手再 PK');
    // 沒投票、手動登記沒人出局也唸這句
    assert.equal(ok(E.exile(night(newGame(B)), 0)).game.narration.text, says('day-4')[0]);
  },
  'day-5': () => {
    let r = voteAll(night(newGame(B)), {});
    assert.deepEqual(r.game.day.vote.result.top, []);
    assert.equal(r.game.day.exileDone, false);
    assert.equal(ok(E.exile(r, 0)).game.narration.text, says('day-5')[0]);
    assert.equal(ok(E.startVote(r)).game.day.vote.round, 2, '可以重新投票');
    const pk = voteAll(voteAll(night(newGame(B)), { 1: 9, 2: 10 }), {}, true);
    assert.deepEqual(pk.game.day.vote.result.top, [], 'PK 那一輪全部棄票');
    assert.equal(ok(E.exile(pk, 0)).game.narration.text, says('day-5')[0]);
    const ab = voteAll(night(newGame(B)), {});
    assert.equal(ok(E.exile(ok(E.duel(ab, id(8), 9)), 0)).game.narration.text, says('day-4')[0], '結果被決鬥清掉');
  },
  'day-10': () => {
    const pend = plan => play(newGame(B), plan); // 第一天、死訊還沒公布
    const bad = (res, why) => {
      assert.equal(res.ok, false, why);
      assert.equal(res.room.game.day.pendingDeaths, null, `${why}：死訊照樣公布`);
      return res.room;
    };
    // 自己昨晚死了、對象昨晚死了
    const self = bad(E.duel(pend({ wolf: 8 }), id(8), 1), '騎士自己死了');
    assert.equal(self.game.knightUsed, false);
    assert.equal(pick(self, 8).canDuel, undefined, '已經出局，之後也不能再按');
    const tgt = bad(E.duel(pend({ wolf: 1 }), id(8), 1), '對象死了（再測一次）');
    assert.ok(E.duel(tgt, id(8), 2).ok, '換一個人可以再按');
    bad(E.duel(pend({ wolf: 1 }), id(8), 1), '對象死了');
    bad(E.boom(pend({ wolf: 1 }), id(1), 0), '自爆的自己死了');
    // 昨晚死的人要開槍：先等他開，開完可以再按
    const h = bad(E.duel(pend({ wolf: 6 }), id(8), 1), '獵人要開槍');
    assert.equal(h.game.knightUsed, false, '沒用掉');
    assert.ok(E.duel(ok(E.shoot(h, id(6), 0)), id(8), 1).ok, '開完可以再按');
    const hb = bad(E.boom(pend({ wolf: 6 }), id(1), 0), '自爆：獵人要開槍');
    assert.ok(E.boom(ok(E.shoot(hb, id(6), 0)), id(1), 0).ok);
    // 昨晚死的是剛登記的警長：登記那一下就公布死訊（Leo 2026-10-28），先等他選警徽
    const s = ok(E.setSheriff(pend({ wolf: 9 }), 9));
    assert.equal(s.game.day.pendingDeaths, null, '登記警長就公布死訊');
    assert.equal(s.game.badgePending, true);
    no(E.duel(s, id(8), 1), '警長要選警徽');
    assert.ok(E.duel(ok(E.passBadge(s, id(9), 4)), id(8), 1).ok, '選完可以再按');
    no(E.boom(s, id(1), 0), '自爆：警長要選警徽');
    // 公布死訊這一下遊戲就結束：技能不發動
    const over = E.boom(play(newGame({ wolf: 1, seer: 1, villager: 3 }), { wolf: 2 }), id(1), 0); // 刀死唯一的神
    assert.equal(over.ok, false);
    assert.equal(over.room.phase, 'ended');
    assert.equal(over.room.game.alive[1], true, '自爆沒發動');
  },
  'day-6': () => {
    let r = play(newGame(B), { wolf: 9 }); // 死訊還沒公布
    r = ok(E.setSheriff(r, 9));
    assert.equal(r.game.sheriff, 9, '昨晚死的人也能當選');
    const lost = ok(E.tearBadge(night(newGame(B))));
    assert.equal(lost.game.badgeTorn, true, '警徽流失');
    const np = ok(E.setSheriff(night(newGame(B, { police: false })), 9));
    assert.equal(np.game.sheriff, 9, '關掉上警的局也能登記');
    assert.equal(voteAll(np, { 9: 10 }).game.day.vote.result.rows[0].score, 1.5, '一樣算 1.5 票');
    no(E.setSheriff(voteAll(night(newGame(F)), { 1: 14, 2: 14 }), 4), '等白癡選擇時不能登記');
    no(E.tearBadge(ok(E.setSheriff(night(newGame(B)), 4))), '已經有警長：不能按警徽流失');
    const v = ok(E.startVote(night(newGame(B))));
    no(E.setSheriff(v, 4), '投票中不能換警長');
    no(E.setSheriff(withDead(night(newGame(B)), [4]), 4), '只能登記活著的人');
    const pd = play(newGame(B), { wolf: 9 });
    no(E.exile(pd, 1), '死訊公布前不能放逐'); no(E.nextNight(pd, 0), '死訊公布前不能天黑');
    // 第一天登記警長＝唸「N 號當選警長。」接著公布昨晚死訊；警徽流失＝直接公布；之後改警長不出聲（Leo 2026-10-28）
    const el = ok(E.setSheriff(pd, 4));
    assert.equal(el.game.narration.text, '4 號當選警長。昨晚死亡的是 9 號。');
    assert.deepEqual(el.game.narration.clips, ['n4', 'sheriffElected', 'deathsAre', 'n9', 'end']);
    assert.equal(el.game.day.pendingDeaths, null);
    assert.equal(el.game.alive[9], false);
    assert.equal(ok(E.tearBadge(pd)).game.narration.text, '昨晚死亡的是 9 號。');
    assert.equal(ok(E.setSheriff(el, 5)).game.narration.seq, el.game.narration.seq, '之後改警長不出聲');
    // 主機改錯：任何時候都能改、流失之後能重新登記
    const fix = ok(E.setSheriff(ok(E.setSheriff(night(newGame(B)), 4)), 5));
    assert.equal(fix.game.sheriff, 5, '登記錯了，改警長');
    const re = ok(E.setSheriff(lost, 6));
    assert.equal(re.game.sheriff, 6);
    assert.equal(re.game.badgeTorn, false, '流失後重新登記');
    const passed = ok(E.passBadge(ok(E.setSheriff(play(newGame(B), { wolf: 9 }), 9)), id(9), 4));
    no(E.setSheriff(passed, 5), '警長自己選過之後主機不能再改（Leo 2026-10-28）');
    const torn9 = ok(E.passBadge(ok(E.setSheriff(play(newGame(B), { wolf: 9 }), 9)), id(9), 0));
    no(E.setSheriff(torn9, 5), '警長自己撕掉之後主機不能重新登記');
    no(E.tearBadge(torn9), '也不能按警徽流失');
    assert.match(mount(passed, 'host').html('#hostCtl'), /警徽已經由警長自己處理過，主機不能再改/);
    assert.ok(!mount(passed, 'host').html('#hostCtl').includes('改警長'), '沒有改警長的按鈕');
    const h = mount(fix, 'host');
    assert.match(h.html('#hostCtl'), /登記錯了，改警長/, '白天一般畫面有');
    h.click('#hostCtl', 'host', 'sheriffOpen');
    assert.ok(!h.html('#hostCtl').includes('data-host="tear"'), '登記了就沒有警徽流失');
    assert.match(mount(ok(E.boom(night(newGame(B)), id(1), 0)), 'host').html('#hostCtl'), /登記警長/, '今天要天黑：也能補登記');
    assert.ok(E.setSheriff(ok(E.boom(night(newGame(B)), id(1), 0)), 4).ok);
    assert.ok(!mount(ok(E.startVote(fix)), 'host').html('#hostCtl').includes('改警長'), '投票中：沒有按鈕');
    assert.match(mount(ok(E.startVote(fix)), 'host').html('#hostCtl'), /警長：<b>5 號<\/b>/, '投票中照樣顯示誰是警長');
    assert.ok(!mount(voteAll(night(newGame(F)), { 1: 14, 2: 14 }), 'host').html('#hostCtl').includes('登記警長'), '等白癡選：沒有');
  },
  'day-7': () => {
    let r = ok(E.setSheriff(play(newGame(B), { wolf: 9 }), 9));
    assert.equal(r.game.badgePending, true, '警長出局');
    no(E.setSheriff(r, 4), '主機不能代替移交');
    no(E.tearBadge(r), '主機不能代替撕');
    no(E.passBadge(r, id(4), 4), '別人不能選');
    no(E.startVote(r)); no(E.exile(r, 4)); no(E.duel(r, id(8), 1)); no(E.boom(r, id(1), 0)); no(E.nextNight(r, 0));
    assert.ok(pick(r, 9).passBadge, '出局的警長手機出現選擇');
    no(E.passBadge(r, id(9), 9), '不能移交給死人');
    const pb = ok(E.passBadge(r, id(9), 4));
    assert.equal(pb.game.sheriff, 4);
    assert.equal(pb.game.narration.seq, r.game.narration.seq, '移交主機不唸');
    assert.equal(pb.game.log.at(-1).text, '9 號警長把警徽移交給 4 號。', '只寫在紀錄');
    // 手機沒電：換一支手機接手座位、主機同意後由新手機選
    const off = new Set([...everyone(r)].filter(c => c !== id(9)).concat('new9'));
    const req = G.claimSeat(r, 'new9', 9, off);
    assert.ok(req.ok, req.error);
    const took = G.approveSeat(req.room, 9, true, off);
    assert.ok(took.ok, took.error);
    assert.equal(ok(E.passBadge(took.room, 'new9', 4)).game.sheriff, 4, '新手機接著選');
    const torn = ok(E.passBadge(r, id(9), 0));
    assert.equal(torn.game.sheriff, null);
    assert.equal(torn.game.badgeTorn, true);
    // 被放逐也一樣
    const ex = voteAll(ok(E.setSheriff(night(newGame(B)), 10)), { 1: 10, 2: 10 });
    assert.equal(ex.game.badgePending, true);
    // 警長剛好是獵人：先選警徽、再開槍
    const hs = voteAll(ok(E.setSheriff(night(newGame(B)), 6)), { 1: 6, 2: 6 });
    assert.ok(hs.game.badgePending && hs.game.canShoot.includes(6));
    const hsUi = mount(hs, id(6)).html('#actionBox');
    assert.match(hsUi, /你是警長，你出局了/, '先出現選警徽');
    no(E.shoot(hs, id(6), 1), '伺服器也擋：先選警徽才能開槍');
    assert.ok(!hsUi.includes('data-do="shoot"'), '還沒出現開槍');
    assert.match(mount(ok(E.passBadge(hs, id(6), 4)), id(6)).html('#actionBox'), /你可以發動技能/, '選完才出現開槍');
    // 自爆的、被撞死的是警長：選完警徽才唸天黑
    const bm = ok(E.boom(ok(E.setSheriff(night(newGame(B)), 1)), id(1), 0));
    assert.ok(!bm.game.narration.text.includes(LINES.nightStart), '還沒唸天黑');
    no(E.nextNight(bm, 0));
    const bp = ok(E.passBadge(bm, id(1), 4));
    assert.equal(bp.game.narration.text, LINES.nightStart, '選完才唸');
    assert.equal(ok(E.nextNight(bp, 0)).game.narration.seq, bp.game.narration.seq, '進入黑夜不再唸一次');
    const dk = ok(E.duel(ok(E.setSheriff(night(newGame(B)), 2)), id(8), 2));
    assert.ok(!dk.game.narration.text.includes(LINES.nightStart));
    assert.equal(ok(E.passBadge(dk, id(2), 0)).game.narration.text, LINES.nightStart);
    const wk = ok(E.boom(ok(E.setSheriff(night(newGame(KG)), 8)), id(3), 8));
    assert.ok(!wk.game.narration.text.includes(LINES.nightStart), '白狼王帶走警長');
    assert.equal(ok(E.passBadge(wk, id(8), 4)).game.narration.text, LINES.nightStart);
  },
  'day-8': () => {
    const r = play(newGame(B, { police: false }), { wolf: 6 });
    assert.deepEqual(r.game.canShoot, [6]);
    assert.equal(r.game.timer, null, '白天沒有倒數');
    no(E.startVote(r), '還沒開槍不能投票');
    no(E.exile(r, 9), '還沒開槍不能放逐');
    const n = ok(E.nextNight(r, 0));
    assert.equal(n.phase, 'night');
    assert.equal(n.game.alive[1], true, '這一槍作廢');
    const f = voteAll(night(newGame(F)), { 1: 14, 2: 14 });
    assert.equal(f.game.timer, null, '白癡選擇不限時');
    no(E.nextNight(f, 0), '白癡的選擇不能用天黑跳過');
    const L3H = { wolf: 1, seer: 1, hunter: 1, villager: 2 }; // 1 狼、2 預言家、3 獵人、4、5 平民
    const h3 = voteAll(night(newGame(L3H), { wolf: 5 }), { 1: 3, 2: 3 });
    assert.deepEqual(h3.game.canShoot, [3]);
    assert.equal(ok(E.nextNight(h3, 0)).game.winner, 'wolf', '作廢之後照常判：一狼一神一民直接結束');
    assert.match(mount(r, 'host').html('#hostCtl'), /data-host="night">天黑請閉眼</, '按鈕叫「天黑請閉眼」');
    assert.match(mount(ok(E.boom(night(newGame(B)), id(1), 0)), 'host').html('#hostCtl'), /data-host="night">進入黑夜</, '自爆之後叫「進入黑夜」');
  },
  'day-9': () => {
    const d = ok(E.duel(ok(E.startVote(night(newGame(B)))), id(8), 1));
    assert.equal(d.game.day.vote, null, '決鬥：投票作廢');
    const b = ok(E.boom(ok(E.startVote(night(newGame(B)))), id(1), 0));
    assert.equal(b.game.day.vote, null, '自爆：投票作廢');
    no(E.startVote(b), '自爆：今天直接天黑，不再投票');
    no(E.startVote(d), '撞到狼：今天直接天黑，不再投票');
    const k = ok(E.duel(ok(E.startVote(night(newGame(B)))), id(8), 9)); // 撞到好人，白天繼續
    assert.equal(ok(E.startVote(k)).game.day.vote.round, 1, '主機重新進行投票');
    // 投完平票、還沒放逐時撞到好人：結果清掉，不能接著 PK
    const tie = ok(E.duel(voteAll(night(newGame(B)), { 1: 9, 2: 10 }), id(8), 11));
    assert.equal(tie.game.day.vote, null);
    no(E.startVote(tie, true), '不能接著 PK');
    assert.ok(E.startVote(tie).ok);
    const after = ok(E.duel(voteAll(night(newGame(B)), { 1: 10, 2: 10 }), id(8), 9));
    assert.ok(after.game.day.vote?.result, '已經放逐之後才決鬥：統計留著');
    const nv = ok(E.nextNight(ok(E.startVote(night(newGame(B)))), 0));
    assert.equal(nv.phase, 'night', '投票中主機直接天黑：這輪作廢');
  },

  /* 狼人 */
  'wolf-1': () => {
    let r = toNight(night(newGame(B)), 'wolf');
    r = act(r, 1, { target: 9 }); r = act(r, 2, { target: 9 });
    assert.equal(r.game.night.wolfProposal, null, '3 號還沒選');
    r = act(r, 3, { target: 10 });
    assert.equal(r.game.night.wolfProposal, null, '不一致');
    r = act(r, 3, { target: 9 });
    assert.equal(r.game.night.wolfProposal, 9);
    const reset = act(r, 3, { reset: true });
    assert.deepEqual(reset.game.night.wolfVotes, {}, '重選＝清掉所有狼的選擇');
    assert.equal(reset.game.night.wolfProposal, null);
    r = act(r, 2, { confirm: true });
    assert.equal(r.game.night.wolfTarget, 9, '任何一隻按正確');
    // 掉線的狼不算
    let o = toNight(night(newGame(B)), 'wolf');
    const online = new Set([...everyone(o)].filter(c => c !== id(3)));
    for (const w of [1, 2]) o = ok(E.nightAction(o, id(w), { target: 9 }, online, 0, minRand));
    assert.equal(o.game.night.wolfProposal, 9);
    // 兩隻先選好、第三隻才掉線：確認不會自己跳出來，再點一次同一個號碼才出現
    let late = toNight(night(newGame(B)), 'wolf');
    for (const w of [1, 2]) late = act(late, w, { target: 9 });
    no(E.nightAction(late, id(1), { confirm: true }, online, 0, minRand), '還沒有統一意見');
    late = ok(E.nightAction(late, id(1), { target: 9 }, online, 0, minRand));
    assert.equal(late.game.night.wolfProposal, 9, '再點一次就出現');
    // 空刀
    const e = play(newGame(B, { police: false }), { wolf: 0 });
    assert.equal(e.game.narration.text, '天亮請睜眼。昨晚是平安夜。');
  },
  'wolf-2': () => {
    let r = toNight(night(newGame(F)), 'wolf');
    assert.deepEqual(pick(r, 1).wolves.map(w => w.seat), [1, 2, 3, 4, 5], '狼隊互相認得，沒有隱狼、石像鬼');
    r = act(r, 2, { target: 15 });
    const a = pick(r, 1).action;
    assert.equal(a.votes[2], 15, '看得到隊友選誰');
    assert.deepEqual(a.killers, [1, 2, 3, 4, 5], '隱狼、石像鬼不參與狼隊的刀');
    assert.ok(!JSON.stringify(pick(r, 1)).includes('"6"') && !JSON.stringify(pick(r, 1)).includes('"7"'), '狼隊手機資料裡沒有隱狼、石像鬼');
    const mates = pick(r, 1).wolves;
    assert.deepEqual(mates.filter(w => w.king).map(w => w.seat), [3], '標出狼王（白狼王不標）');
    assert.deepEqual(a.noKnife, [5], '狼美人那格不能刀');
    assert.match(mount(r, id(1)).html('#actionBox'), /狼王是 3 號/);
    const dm = mount(night(newGame(F)), id(1));
    dm.click('#myInfo', 'me', 'show');
    assert.match(dm.html('#myInfo'), /狼隊友：2 號、3 號（狼王）、4 號、5 號/, '白天看我的身分也看得到');
  },
  'wolf-3': () => {
    const [line] = says('wolf-3');
    const r = ok(E.boom(night(newGame(B)), id(1), 0));
    assert.equal(r.game.narration.text, fill(line, { N: 1 }));
    assert.equal(r.game.day.nightCalled, true);
    no(E.startVote(r), '今天不放逐'); no(E.exile(r, 9));
    assert.equal(ok(E.nextNight(r, 0)).phase, 'night');
    // 警長競選中：先公布昨晚死訊
    const p = ok(E.boom(play(newGame(B), { wolf: 9 }), id(1), 0));
    assert.equal(p.game.narration.text, '昨晚死亡的是 9 號。' + fill(line, { N: 1 }));
    // 投票中也可以
    assert.ok(E.boom(ok(E.startVote(night(newGame(B)))), id(2), 0).ok);
    const sb = ok(E.boom(ok(E.setSheriff(night(newGame(B)), 1)), id(1), 0));
    assert.equal(sb.game.narration.text, '1 號狼人自爆。', '自爆的是警長：先不唸天黑');
    // 自己昨晚已經死了：死訊照樣公布、自爆不算
    const res = E.boom(play(newGame(B), { wolf: 1 }), id(1), 0);
    assert.equal(res.ok, false);
    assert.equal(res.room.game.day.pendingDeaths, null);
    assert.equal(res.room.game.day.nightCalled ?? false, false);
  },
  'wolf-4': () => {
    const r = toNight(night(newGame(F)), 'wolf');
    no(E.nightAction(r, id(1), { target: 5 }, everyone(r), 0, minRand), '不能刀狼美人');
    assert.ok(E.nightAction(r, id(1), { target: 1 }, everyone(r), 0, minRand).ok, '可以刀自己');
    assert.ok(E.nightAction(r, id(1), { target: 2 }, everyone(r), 0, minRand).ok, '可以刀隊友');
    assert.match(mount(r, id(1)).html('#actionBox'), /不能刀/);
    assert.match(mount(r, id(1)).html('#actionBox'), /在線上的狼（掉線的不算）都點同一個人/);
  },
  'wolf-5': () => {
    const day = night(newGame(B));
    const tie = voteAll(day, { 4: 9, 5: 10 });
    assert.ok(E.boom(tie, id(1), 0).ok, '平票、主機還沒按沒人出局：還能自爆');
    assert.ok(E.boom(ok(E.startVote(tie, true)), id(1), 0).ok, 'PK 中也能');
    const auto = voteAll(day, { 4: 9, 5: 9 });
    assert.equal(auto.game.day.exileDone, true, '投完票自動放逐');
    no(E.boom(auto, id(1), 0), '放逐之後');
    no(E.boom(voteAll(day, { 4: 6, 5: 6 }), id(1), 0), '有人要開槍');
    no(E.boom(ok(E.boom(day, id(1), 0)), id(2), 0), '今天已經要天黑');
    no(E.boom(voteAll(night(newGame(F)), { 1: 14, 2: 14 }), id(1), 0), '白癡在選');
    const sp = ok(E.setSheriff(play(newGame(B), { wolf: 9 }), 9));
    no(E.boom(sp, id(1), 0), '警長在選');
    const bm = mount(night(newGame(B)), id(1));
    bm.click('#myInfo', 'me', 'show');
    bm.click('#myInfo', 'do', 'boomOpen');
    assert.match(bm.html('#myInfo'), /平票、全部棄票要等主機按「沒人出局」才算/);
    no(E.boom(ok(E.exile(voteAll(day, { 4: 9, 5: 10 }), 0)), id(1), 0), '平票沒人出局之後');
    no(E.boom(ok(E.exile(voteAll(day, {}), 0)), id(1), 0), '全部棄票沒人出局之後');
    no(E.boom(ok(E.idiotChoose(voteAll(night(newGame(F)), { 1: 14, 2: 14 }), id(14), true)), id(1), 0), '白癡翻牌之後');
  },
  'wolf-6': () => {
    assert.equal(play(newGame(B), { seer: 1 }).game.seerChecks[0].wolf, true, '預言家查是狼');
    const g = voteAll(night(newGame(F)), { 8: 1, 9: 1 });
    assert.equal(g.game.graveInfo.wolf, true, '守墓人看是狼');
    const d = ok(E.duel(night(newGame(B)), id(8), 1));
    assert.equal(d.game.alive[1], false, '騎士撞到＝狼人');
    assert.equal(d.game.alive[8], true);
    for (const w of [3, 4, 5, 7]) { // 狼王、白狼王、狼美人、石像鬼
      assert.equal(play(newGame(F), { seer: w }).game.seerChecks[0].wolf, true, `${w} 號預言家查是狼`);
      assert.equal(voteAll(night(newGame(F)), { 8: w, 9: w }).game.graveInfo.wolf, true, `${w} 號守墓人看是狼`);
      assert.equal(ok(E.duel(night(newGame(F)), id(13), w)).game.alive[13], true, `${w} 號騎士撞到＝狼`);
    }
  },

  /* 狼王 */
  'king-1': () => {
    assert.equal(toNight(night(newGame(F)), 'wolf').game.narration.text, says('king-1')[0]);
    assert.equal(toNight(night(newGame(B)), 'wolf').game.narration.text, LINES.wolfOpen, '沒有狼王不唸');
    assert.equal(toNight(withDead(night(newGame(F)), [3]), 'wolf').game.narration.text, says('king-1')[0], '狼王出局後也照唸');
    assert.ok(E.killers(newGame(F).game).includes(3));
  },
  'king-2': () => {
    const [skill, took] = says('king-2');
    const n = play(newGame(KG, { police: false }), { wolf: 2 });
    assert.deepEqual(n.game.canShoot, [2], '被狼刀');
    const KGG = { wolf: 1, king: 1, witch: 1, guard: 1, villager: 3 }; // 1 狼人、2 狼王、3 女巫、4 守衛、5–7 平民
    assert.deepEqual(play(newGame(KGG, { police: false }), { wolf: 2, save: true, guard: 2 }).game.canShoot, [2], '同守同救死也能開槍');
    assert.ok(n.game.narration.text.endsWith(fill(skill, { N: 2 })));
    const ex = voteAll(night(newGame(KG)), { 1: 2, 4: 2 });
    assert.deepEqual(ex.game.canShoot, [2], '被放逐');
    assert.ok(ex.game.narration.text.endsWith(fill(skill, { N: 2 })));
    const s = ok(E.shoot(ex, id(2), 8));
    assert.equal(s.game.narration.text, fill(took, { N: 2, M: 8 }));
    const skip = ok(E.shoot(ex, id(2), 0));
    assert.equal(skip.game.alive[8], true, '可以不開');
    assert.equal(skip.game.narration.seq, ex.game.narration.seq, '不開槍主機不唸');
    assert.equal(skip.game.log.length, ex.game.log.length, '紀錄也不寫');
    const dk = ok(E.duel(night(newGame(KG)), id(7), 2));
    assert.equal(ok(E.shoot(dk, id(2), 0)).game.narration.text, LINES.nightStart, '今天要天黑：不開槍就接著唸天黑');
    const hs = ok(E.shoot(voteAll(night(newGame(KG)), { 1: 6, 4: 6 }), id(6), 2));
    assert.deepEqual(hs.game.canShoot, [2], '被獵人的槍帶走');
    assert.deepEqual(ok(E.duel(night(newGame(KG)), id(7), 2)).game.canShoot, [2], '被騎士撞死');
    assert.deepEqual(ok(E.boom(night(newGame(KG)), id(3), 2)).game.canShoot, [2], '被白狼王帶走');
  },
  'king-3': () => {
    const d = ok(E.duel(night(newGame(KG)), id(7), 2));
    assert.ok(!d.game.narration.text.includes(LINES.nightStart), '先開槍');
    assert.equal(d.game.day.nightCalled, true);
    assert.ok(ok(E.shoot(d, id(2), 8)).game.narration.text.endsWith(LINES.nightStart), '開完才唸天黑');
    // 開完剛好剩一狼一神一民（今天已經登記放逐結果）：直接結束，不先唸天黑
    let x = ok(E.exile(withDead(night(newGame(KG)), [3, 5, 6, 9]), 10)); // 放逐 10 號後剩 1 狼、2 狼王、4 預言家、7 騎士、8 平民
    x = ok(E.shoot(ok(E.duel(x, id(7), 2)), id(2), 7));
    assert.equal(x.game.winner, 'wolf');
    assert.ok(!x.game.narration.text.includes(LINES.nightStart), '沒有先唸天黑');
  },
  'king-4': () => {
    assert.deepEqual(play(newGame(KG, { police: false }), { poison: 2 }).game.canShoot, [], '被毒');
    const b = ok(E.boom(night(newGame(KG)), id(2), 0));
    assert.equal(b.game.alive[2], false);
    assert.deepEqual(b.game.canShoot, [], '自爆');
    assert.equal(b.game.narration.text, '2 號狼人自爆，天黑請閉眼。', '唸狼人自爆，不公開是狼王');
    const c = voteAll(night(newGame(F), { charm: 3 }), { 8: 5, 9: 5 });
    assert.equal(c.game.alive[3], false, '殉情');
    assert.ok(!c.game.canShoot.includes(3));
  },
  'king-5': () => {
    const f = newGame(F);
    assert.ok(!f.game.night.steps.includes('king'));
    assert.ok(!ok(E.nextNight(night(f), 0)).game.night.steps.includes('king'));
  },

  /* 白狼王 */
  'whiteKing-1': () => assert.ok(E.killers(newGame(F).game).includes(4)),
  'whiteKing-2': () => {
    const [take, none] = says('whiteKing-2');
    const t = ok(E.boom(night(newGame(KG)), id(3), 8));
    assert.equal(t.game.narration.text, fill(take, { N: 3, M: 8 }));
    assert.equal(t.game.alive[8], false);
    assert.equal(t.game.day.nightCalled, true, '今天不放逐');
    assert.equal(ok(E.boom(night(newGame(KG)), id(3), 0)).game.narration.text, fill(none, { N: 3 }));
    assert.ok(E.boom(play(newGame(KG), {}), id(3), 8).ok, '警長競選中');
    const dead3 = E.boom(play(newGame(KG), { wolf: 8 }), id(3), 8);
    assert.equal(dead3.ok, false, '對象昨晚已經死了：自爆不算');
    assert.equal(dead3.room.game.alive[3], true);
    assert.ok(E.boom(ok(E.startVote(night(newGame(KG)))), id(3), 8).ok, '投票中');
    const ws = ok(E.boom(ok(E.setSheriff(night(newGame(KG)), 8)), id(3), 8));
    assert.equal(ws.game.narration.text, '3 號白狼王自爆，帶走了 8 號。', '帶走的是警長：選完警徽才唸天黑');
  },
  'whiteKing-3': () => {
    const h = ok(E.boom(night(newGame(KG)), id(3), 6));
    assert.deepEqual(h.game.canShoot, [6]);
    assert.ok(!h.game.narration.text.includes(LINES.nightStart));
    assert.ok(ok(E.shoot(h, id(6), 8)).game.narration.text.endsWith(LINES.nightStart));
    const b = ok(E.boom(night(newGame(F), { charm: 15 }), id(4), 5));
    assert.equal(b.game.alive[15], false, '帶走狼美人 → 殉情');
    assert.ok(b.game.narration.text.includes('15 號殉情出局。'));
  },
  'whiteKing-4': () => {
    no(E.boom(night(newGame(KG)), id(1), 8), '一般狼人自爆不能帶人');
    assert.deepEqual(play(newGame(KG, { police: false }), { wolf: 3 }).game.canShoot, [], '被刀沒有技能');
    const ex = voteAll(night(newGame(KG)), { 4: 3, 5: 3 });
    assert.equal(ex.game.alive[3], false);
    assert.deepEqual(ex.game.canShoot, [], '被放逐沒有技能');
    no(E.boom(voteAll(night(newGame(KG)), { 4: 9, 5: 9 }), id(3), 8), '放逐之後不能自爆');
    no(E.boom(ok(E.exile(night(newGame(KG)), 0)), id(3), 8), '沒人出局之後也不能');
  },

  /* 狼美人 */
  'beauty-1': () => {
    const r = toNight(night(newGame(F)), 'beauty');
    assert.equal(r.game.narration.text, says('beauty-1')[0]);
    no(E.nightAction(r, id(5), { target: 5 }, everyone(r), 0, minRand), '不能選自己');
    assert.equal(ok(E.nightAction(r, id(5), { target: 0 }, everyone(r), 0, minRand)).game.night.charmTarget, null, '可以不魅惑');
    const mate = voteAll(night(newGame(F), { charm: 3 }), { 8: 5, 9: 5 });
    assert.equal(mate.game.alive[3], false, '可以魅惑狼隊友（狼王），一樣殉情');
    assert.ok(!mate.game.canShoot.includes(3), '殉情的狼王不能開槍');
  },
  'beauty-2': () => {
    let r = night(newGame(F), { charm: 15 });
    assert.equal(r.game.charm, 15);
    r = nextDay(r, { charm: 16 });
    assert.equal(r.game.charm, 16, '每晚換新');
    assert.equal(nextDay(r, { charm: 0 }).game.charm, null, '前一晚沒魅惑＝沒有人，前天的不延續');
    r = nextDay(withDead(r, [5]), {});
    assert.equal(r.game.charm, null, '狼美人死了就沒有魅惑');
  },
  'beauty-3': () => {
    const [line] = says('beauty-3');
    const r = voteAll(night(newGame(F), { charm: 10 }), { 8: 5, 9: 5 });
    assert.equal(r.game.alive[10], false, '被放逐 → 殉情');
    assert.ok(r.game.narration.text.endsWith(fill(line, { M: 10 })));
    assert.ok(!r.game.canShoot.includes(10), '殉情的獵人不能開槍');
    const s = ok(E.shoot(voteAll(night(newGame(F), { charm: 15 }), { 8: 10, 9: 10 }), id(10), 5));
    assert.equal(s.game.alive[15], false, '被槍帶走 → 殉情');
  },
  'beauty-4': () => {
    // 房間最少 4 人：1 狼美人、2 預言家、3 女巫、4–5 平民，第一晚後只留 1、2、4（一狼美、一神、一民）
    const BW = { beauty: 1, seer: 1, witch: 1, villager: 2 };
    const run = (rules, charm) => voteAll(withDead(night(newGame(BW, rules), { charm }), [3, 5]), { 2: 1, 4: 1, 1: 2 });
    assert.equal(run({}, 2).game.winner, 'wolf', '屠邊：殉情算狼刀');
    assert.equal(run({ win: 'all' }, 2).game.winner, 'good', '屠城：剩下的是好人');
    assert.equal(run({}, 0).game.winner, 'good', '沒魅惑就沒殉情');
  },
  'beauty-5': () => {
    const r = toNight(night(newGame(F), { charm: 15 }), 'beauty');
    no(E.nightAction(r, id(5), { target: 15 }, everyone(r), 0, minRand), '不能連續兩晚同一位');
    assert.ok(E.nightAction(r, id(5), { target: 16 }, everyone(r), 0, minRand).ok);
    assert.match(mount(r, id(5)).html('#actionBox'), /昨晚魅惑過/);
  },
  'beauty-6': () => {
    const d = ok(E.duel(night(newGame(F), { charm: 15 }), id(13), 5));
    assert.equal(d.game.alive[5], false);
    assert.equal(d.game.alive[15], true, '被騎士撞死：不殉情');
    const p = play(newGame(F, { police: false }), { charm: 15, poison: 5 });
    assert.equal(p.game.alive[5], false);
    assert.equal(p.game.alive[15], true, '被毒死：不殉情');
    const ui = mount(toNight(night(newGame(F)), 'beauty'), id(5)).html('#actionBox');
    assert.match(ui, /被騎士撞死、被女巫毒死不會殉情/, '夜裡畫面也寫例外');
  },
  'beauty-7': () => {
    const r = toNight(night(newGame(F)), 'wolf');
    no(E.nightAction(r, id(2), { target: 5 }, everyone(r), 0, minRand), '狼隊不能刀狼美人');
    no(E.boom(night(newGame(F)), id(5), 0), '狼美人不能自爆');
    assert.equal(pick(night(newGame(F)), 5).canBoom, undefined, '沒有自爆鈕');
  },

  /* 隱狼 */
  'hidden-1': () => {
    const r = night(newGame(F));
    assert.deepEqual(pick(r, 6).wolves.map(w => w.seat), [1, 2, 3, 4, 5, 6], '隱狼看得到狼隊');
    assert.ok(!pick(r, 1).wolves.some(w => w.seat === 6), '狼隊不知道隱狼');
    assert.ok(!pick(r, 6).wolves.some(w => w.seat === 7) && !pick(r, 7).wolves.some(w => w.seat === 6), '隱狼、石像鬼互相不知道');
    const late = withDead(r, [1, 2, 3, 4, 5]);
    assert.ok(!pick(late, 6).wolves.some(w => w.seat === 7) && !pick(late, 7).wolves.some(w => w.seat === 6), '狼隊死光也不見面');
    const h = mount(r, id(6));
    h.click('#myInfo', 'me', 'show');
    assert.match(h.html('#myInfo'), /其他狼還活著時你不刀人、也不能自爆；其他狼都出局（只剩你）時/, '「看我的身分」照新規則寫');
  },
  'hidden-2': () => {
    let r = toNight(night(newGame(F)), 'wolf');
    assert.ok(!E.actors(r.game, 'wolf').includes(6), '狼人那步沒有隱狼');
    assert.equal(pick(r, 6).action, undefined, '隱狼手機沒有動作');
    no(E.nightAction(r, id(6), { target: 15 }, everyone(r), 0, minRand));
    for (const w of [1, 2, 3, 4, 5]) r = act(r, w, { target: 15 });
    assert.equal(r.game.night.wolfProposal, 15, '狼隊自己一致就確定');
    // 隱狼請睜眼：看得到狼同伴，不用動作、照樣假等
    let h = toNight(withDead(night(newGame(F)), [2]), 'hidden');
    assert.equal(h.game.night.wait, 'fake');
    assert.deepEqual(pick(h, 6).action, { kind: 'hiddenMates' });
    no(E.nightAction(h, id(6), { target: 15 }, everyone(h), 0, minRand));
    const view = mount(h, id(6)).html('#actionBox');
    assert.match(view, /隱狼：你的狼同伴/);
    assert.match(view, /狼同伴：<b class="digits">1<\/b> 號、<b class="digits">2<\/b> 號（已出局）、<b class="digits">3<\/b> 號（狼王）、<b class="digits">4<\/b> 號、<b class="digits">5<\/b> 號/);
    assert.ok(!view.includes('7</b> 號'), '石像鬼不在名單');
  },
  'hidden-3': () => {
    assert.equal(play(newGame(F), { seer: 6 }).game.seerChecks[0].wolf, false, '預言家查是好人');
    assert.equal(play(newGame(F), { gargoyle: 6 }).game.gargoyleChecks[0].role, 'hidden', '石像鬼看到「隱狼」');
    assert.equal(voteAll(night(newGame(F)), { 8: 6, 9: 6 }).game.graveInfo.wolf, false, '守墓人看是好人');
    const d = ok(E.duel(night(newGame(F)), id(13), 6));
    assert.equal(d.game.alive[6], false, '騎士撞到＝狼人');
    assert.equal(d.game.alive[13], true);
    // 接手刀人之後（其他狼都出局）：預言家、守墓人看是狼人
    const late = withDead(night(newGame(F)), [1, 2, 3, 4, 5, 7]);
    assert.equal(nextDay(late, { seer: 6 }).game.seerChecks.at(-1).wolf, true, '接手後預言家查是狼人');
    assert.equal(ok(E.exile(late, 6)).game.graveInfo.wolf, true, '接手後被放逐，守墓人看是狼人');
    const still = withDead(night(newGame(F)), [1, 2, 3, 4, 5]);
    assert.equal(nextDay(still, { seer: 6 }).game.seerChecks.at(-1).wolf, false, '石像鬼還活著＝還沒接手，照樣是好人');
  },
  'hidden-4': () => {
    const [open, close] = says('hidden-4');
    const r = withDead(night(newGame(F)), [1, 2, 3, 4, 5, 7]);
    let n = toNight(r, 'hidden');
    assert.equal(n.game.narration.text, open, '主機只唸隱狼請睜眼');
    assert.equal(LINES.hiddenOpen, open);
    assert.deepEqual(E.actors(n.game, 'wolf'), [], '狼人那步沒人');
    assert.deepEqual(E.actors(n.game, 'hidden'), [6]);
    assert.equal(pick(n, 6).action.hiddenAlone, true);
    assert.match(mount(n, id(6)).html('#actionBox'), /隱狼：請選擇今晚要擊殺的玩家[\s\S]*主機不會唸出來/, '手機上寫出來');
    const again = E.advance(n, n.game.timer.at, minRand).room;
    assert.equal(again.game.narration.text, open, '太久沒選：重唸隱狼請睜眼');
    n = act(n, 6, { target: 15 });
    n = act(n, 6, { confirm: true });
    for (let i = 0; i < 10 && n.game.night.stage !== 'closed'; i++) n = E.advance(n, n.game.timer.at, minRand).room;
    assert.equal(n.game.narration.text, close, '選好就閉眼');
    assert.ok(!nextDay(r, { wolf: 15 }).game.alive[15], '隱狼刀成功');
    assert.ok(E.actors(ok(E.nextNight(night(newGame(F)), 0)).game, 'hidden').length === 0, '其他狼還活著：假等');
    let alive = toNight(night(newGame(F)), 'hidden');
    assert.equal(alive.game.night.wait, 'fake');
    assert.equal(alive.game.narration.text, open, '照樣唸睜眼');
    const solo = play(newGame({ hidden: 1, seer: 1, villager: 4 }), {}, { step: 'hidden' });
    assert.deepEqual(E.actors(solo.game, 'hidden'), [1], '板子上的狼只有隱狼：第一晚就刀');
  },
  'hidden-5': () => {
    assert.ok(ok(E.startVote(night(newGame(F)))).game.day.vote.voters.includes(6));
    no(E.boom(night(newGame(F)), id(6), 0), '不能自爆');
    assert.equal(pick(night(newGame(F)), 6).canBoom, undefined);
    no(E.boom(withDead(night(newGame(F)), [1, 2, 3, 4, 5, 7]), id(6), 0), '接手之後也不能');
  },

  /* 石像鬼 */
  'gargoyle-1': () => {
    let r = toNight(night(newGame(F)), 'gargoyle');
    assert.equal(r.game.narration.text, says('gargoyle-1')[0]);
    no(E.nightAction(r, id(7), { target: 7 }, everyone(r), 0, minRand), '不能查自己');
    no(E.nightAction(r, id(7), { done: true }, everyone(r), 0, minRand), '不能不查就按知道了');
    r = act(r, 7, { target: 9 });
    assert.deepEqual(pick(r, 7).action.checked, { day: 2, target: 9, role: 'witch' }, '看到角色名稱');
    const d = toNight(withDead(night(newGame(F)), [15]), 'gargoyle');
    no(E.nightAction(d, id(7), { target: 15 }, everyone(d), 0, minRand), '不能查死人');
  },
  'gargoyle-2': () => {
    const r = withDead(night(newGame(F)), [1, 2, 3, 4, 5]);
    assert.deepEqual(E.killers(r.game), [7], '石像鬼單獨刀');
    assert.equal(r.game.alive[6], true, '隱狼還活著也一樣');
    assert.deepEqual(E.actors(ok(E.nextNight(r, 0)).game, 'hidden'), [], '石像鬼還活著：隱狼不刀');
    assert.deepEqual(pick(r, 7).wolves.map(w => w.seat), [7], '不跟隱狼見面');
    const solo = play(newGame({ gargoyle: 1, seer: 1, villager: 3 }), {}, { step: 'wolf' });
    assert.deepEqual(E.actors(solo.game, 'wolf'), [1], '沒有狼隊：第一晚就殺人');
    assert.ok(ok(E.nextNight(r, 0)).game.night.steps.includes('gargoyle'), '查驗照常');
  },
  'gargoyle-3': () => assert.equal(ok(E.boom(night(newGame(F)), id(7), 0)).game.narration.text, '7 號狼人自爆，天黑請閉眼。'),
  'gargoyle-4': () => {
    const r = night(newGame(F));
    assert.ok(!E.killers(r.game).includes(7), '狼隊還活著時不參與狼刀');
    assert.deepEqual(pick(r, 7).wolves.map(w => w.seat), [7]);
    assert.ok(!pick(r, 1).wolves.some(w => w.seat === 7));
    assert.equal(play(newGame(F), { seer: 7 }).game.seerChecks[0].wolf, true, '預言家查是狼人');
  },

  /* 預言家 */
  'seer-1': () => {
    let r = toNight(withDead(night(newGame(B)), [9]), 'seer');
    assert.equal(r.game.narration.text, says('seer-1')[0]);
    no(E.nightAction(r, id(4), { done: true }, everyone(r), 0, minRand), '不能不查就按知道了');
    no(E.nightAction(r, id(4), { target: 4 }, everyone(r), 0, minRand), '不能查自己');
    no(E.nightAction(r, id(4), { target: 9 }, everyone(r), 0, minRand), '不能查死人');
    r = act(r, 4, { target: 1 });
    assert.equal(pick(r, 4).action.checked.wolf, true);
    no(E.nightAction(r, id(4), { target: 2 }, everyone(r), 0, minRand), '一晚一人');
  },
  'seer-2': () => {
    const sees = t => play(newGame(F), { seer: t }).game.seerChecks[0].wolf;
    assert.equal(sees(6), false, '隱狼是好人');
    for (const t of [1, 3, 4, 5, 7]) assert.equal(sees(t), true, `${t} 號是狼`);
    assert.equal(sees(15), false);
    assert.equal(nextDay(withDead(night(newGame(F)), [1, 2, 3, 4, 5, 7]), { seer: 6 }).game.seerChecks.at(-1).wolf, true, '隱狼接手刀人之後是狼人');
  },
  'seer-3': () => {
    let r = night(newGame(B), { seer: 1 });
    r = nextDay(r, { seer: 9 });
    assert.equal(pick(r, 4).seerChecks.length, 2, '紀錄一直在');
    assert.equal(pick(r, 9).seerChecks, undefined, '別人看不到');
  },

  /* 女巫 */
  'witch-1': () => {
    const r = play(newGame(B), { wolf: 9 }, { step: 'witch' });
    assert.equal(r.game.narration.text, says('witch-1')[0]);
    assert.equal(pick(r, 5).action.victim, 9);
    let s = nextDay(night(newGame(B), { wolf: 9, save: true }), {});
    s = toNight(s, 'witch', 0, { wolf: 10 });
    assert.equal(pick(s, 5).action.victim, null, '解藥用掉後看不到');
    const e = play(newGame(B), { wolf: 0 }, { step: 'witch' });
    no(E.nightAction(e, id(5), { use: 'save' }, everyone(e), 0, minRand), '空刀沒人可救');
  },
  'witch-2': () => {
    const r = play(newGame(B), {}, { step: 'witch', beat: 1 });
    assert.equal(r.game.narration.text, says('witch-2')[0]);
    assert.equal(play(newGame(B, { police: false }), { poison: 10 }).game.alive[10], false);
    assert.deepEqual(play(newGame(B, { police: false }), { poison: 6 }).game.canShoot, [], '被毒不能開槍');
    assert.equal(play(newGame(B, { police: false }), { poison: 10, guard: 10 }).game.alive[10], false, '守不住毒');
  },
  'witch-3': () => {
    const r = play(newGame(B), { wolf: 9, save: true }, { step: 'witch', beat: 1 });
    no(E.nightAction(r, id(5), { use: 'poison', target: 1 }, everyone(r), 0, minRand), '一晚一瓶');
    const s = toNight(night(newGame(B), { wolf: 9, save: true }), 'witch', 0, { wolf: 10 });
    no(E.nightAction(s, id(5), { use: 'save' }, everyone(s), 0, minRand), '解藥只有一次');
    const p = toNight(night(newGame(B), { poison: 9 }), 'witch', 1);
    no(E.nightAction(p, id(5), { use: 'poison', target: 1 }, everyone(p), 0, minRand), '毒藥只有一次');
  },
  'witch-4': () => {
    const p = play(newGame(B), {}, { step: 'witch', beat: 1 });
    no(E.nightAction(p, id(5), { use: 'poison', target: 5 }, everyone(p), 0, minRand), '不能毒自己');
    const self = (rules, nights) => {
      let r = newGame(B, rules);
      for (let i = 1; i < nights; i++) r = nextDay(i === 1 ? night(r) : r, {});
      r = nights === 1 ? play(r, { wolf: 5 }, { step: 'witch' }) : toNight(r, 'witch', 0, { wolf: 5 });
      return E.nightAction(r, id(5), { use: 'save' }, everyone(r), 0, minRand).ok;
    };
    assert.equal(self({}, 1), false, '預設不能自救');
    assert.equal(self({ witchSelfSave: 'first' }, 1), true, '第一晚能');
    assert.equal(self({ witchSelfSave: 'first' }, 2), false, '第二晚不能');
    assert.equal(self({ witchSelfSave: 'always' }, 2), true, '每晚都能');
  },
  'witch-5': () => assert.equal(play(newGame(B, { police: false }), { wolf: 9, save: true, guard: 9 }).game.alive[9], false),

  /* 獵人 */
  'hunter-1': () => {
    const [skill, took] = says('hunter-1');
    const n = play(newGame(B, { police: false }), { wolf: 6 });
    assert.deepEqual(n.game.canShoot, [6], '被刀');
    assert.ok(n.game.narration.text.endsWith(fill(skill, { N: 6 })));
    assert.equal(ok(E.shoot(n, id(6), 9)).game.narration.text, fill(took, { N: 6, M: 9 }));
    const quiet = ok(E.shoot(n, id(6), 0));
    assert.equal(quiet.game.narration.seq, n.game.narration.seq, '不開槍主機不唸');
    assert.equal(quiet.game.log.length, n.game.log.length);
    assert.match(mount(n, id(6)).html('#actionBox'), /你可以發動技能[\s\S]*不發動主機不唸/);
    assert.deepEqual(voteAll(night(newGame(B)), { 1: 6, 2: 6 }).game.canShoot, [6], '被放逐');
    assert.deepEqual(play(newGame(B, { police: false }), { wolf: 6, guard: 6, save: true }).game.canShoot, [6], '同守同救死也能開槍');
    const k = ok(E.shoot(voteAll(night(newGame(KG)), { 1: 2, 4: 2 }), id(2), 6));
    assert.deepEqual(k.game.canShoot, [6], '被狼王的槍帶走');
    assert.deepEqual(ok(E.boom(night(newGame(KG)), id(3), 6)).game.canShoot, [6], '被白狼王帶走');
    // 這一死讓遊戲結束（屠邊最後一個神）：不開槍
    const HL = { wolf: 2, seer: 1, hunter: 1, villager: 3 }; // 1、2 狼、3 預言家、4 獵人、5–7 平民
    const end = voteAll(withDead(night(newGame(HL)), [3]), { 1: 4, 2: 4 });
    assert.equal(end.phase, 'ended');
    assert.deepEqual(end.game.canShoot, [], '遊戲結束就不開槍');
    // 只是湊成一狼一神一民：先等他開槍
    const L3H = { wolf: 1, seer: 1, hunter: 1, villager: 2 }; // 1 狼、2 預言家、3 獵人、4、5 平民
    const wait = voteAll(night(newGame(L3H), { wolf: 5 }), { 1: 3, 2: 3 });
    assert.equal(wait.phase, 'day');
    assert.deepEqual(wait.game.canShoot, [3], '先等獵人開槍');
    assert.equal(ok(E.shoot(wait, id(3), 0)).game.winner, 'wolf', '不開槍才判一狼一神一民');
    assert.equal(ok(E.shoot(wait, id(3), 1)).game.winner, 'good', '帶走狼＝好人勝');
  },
  'hunter-2': () => {
    const r = play(newGame(B), {}, { step: 'hunter' });
    assert.equal(r.game.narration.text, says('hunter-2')[0]);
    assert.deepEqual(r.game.night.steps.slice(-2), ['hunter', 'police'], '第一晚獵人後面還有上警');
    const st = ok(E.nextNight(night(newGame(F)), 0)).game.night.steps;
    assert.equal(st.indexOf('hunter'), st.indexOf('gravekeeper') + 1, '守墓人之後');
    assert.equal(pick(r, 6).action.canShoot, true);
    const p = play(newGame(B), { poison: 6 }, { step: 'hunter' });
    assert.equal(pick(p, 6).action.canShoot, false, '今晚被毒：👎 今晚不能開槍');
    assert.match(mount(p, id(6)).html('#actionBox'), /今晚不能開槍/);
  },
  'hunter-3': () => {
    assert.deepEqual(play(newGame(B, { police: false }), { poison: 6 }).game.canShoot, []);
    const c = voteAll(night(newGame(F), { charm: 10 }), { 8: 5, 9: 5 });
    assert.ok(!c.game.canShoot.includes(10), '殉情不能開槍');
  },
  'hunter-4': () => {
    const r = voteAll(night(newGame(B)), { 1: 6, 2: 6 });
    no(E.startVote(r)); no(E.exile(r, 9));
    const n = ok(E.nextNight(r, 0));
    assert.deepEqual(n.game.canShoot, [], '主機按天黑＝作廢');
  },

  /* 守衛 */
  'guard-1': () => {
    const r = play(newGame(B), {}, { step: 'guard' });
    assert.equal(r.game.narration.text, says('guard-1')[0]);
    assert.ok(E.nightAction(r, id(7), { target: 7 }, everyone(r), 0, minRand).ok, '可以守自己');
    assert.ok(E.nightAction(r, id(7), { target: 0 }, everyone(r), 0, minRand).ok, '可以空守');
    assert.equal(play(newGame(B, { police: false }), { wolf: 9, guard: 9 }).game.alive[9], true);
  },
  'guard-2': () => {
    let r = night(newGame(B), { guard: 9 });
    const n2 = toNight(r, 'guard');
    no(E.nightAction(n2, id(7), { target: 9 }, everyone(n2), 0, minRand), '不能連續兩晚');
    assert.ok(E.nightAction(n2, id(7), { target: 10 }, everyone(n2), 0, minRand).ok);
    r = nextDay(r, { guard: 0 });
    const n3 = toNight(r, 'guard');
    assert.ok(E.nightAction(n3, id(7), { target: 9 }, everyone(n3), 0, minRand).ok, '空守之後守誰都可以');
  },
  'guard-3': () => {
    assert.equal(play(newGame(B, { police: false }), { guard: 9, poison: 9 }).game.alive[9], false);
    assert.equal(play(newGame(B, { police: false }), { wolf: 9, guard: 9, save: true }).game.alive[9], false);
  },

  /* 守墓人 */
  'gravekeeper-1': () => {
    assert.ok(!newGame(F).game.night.steps.includes('gravekeeper'));
    const ng = ok(E.nextNight(night(newGame({ wolf: 2, seer: 1, gravekeeper: 1, hunter: 1, villager: 3 })), 0)).game.night.steps;
    assert.equal(ng.indexOf('gravekeeper'), ng.indexOf('seer') + 1, '沒有石像鬼：接在預言家後面');
    const r = toNight(voteAll(night(newGame(F)), { 8: 1, 9: 1 }), 'gravekeeper');
    assert.equal(r.game.narration.text, says('gravekeeper-1')[0]);
    assert.deepEqual(pick(r, 12).action.info, { day: 1, seat: 1, wolf: true });
    assert.equal(pick(toNight(voteAll(night(newGame(F)), { 8: 6, 9: 6 }), 'gravekeeper'), 12).action.info.wolf, false, '隱狼顯示好人');
  },
  'gravekeeper-2': () => {
    const info = r => pick(toNight(r, 'gravekeeper'), 12).action.info;
    const day = () => night(newGame(F));
    assert.equal(info(ok(E.exile(voteAll(day(), { 8: 1, 9: 2 }), 0))), null, '平票沒人出局');
    assert.equal(info(ok(E.idiotChoose(voteAll(day(), { 1: 14, 2: 14 }), id(14), true))), null, '白癡翻牌');
    assert.equal(info(ok(E.boom(day(), id(1), 0))), null, '自爆');
    assert.equal(info(ok(E.duel(day(), id(13), 1))), null, '騎士撞死');
    assert.equal(info(ok(E.shoot(voteAll(day(), { 8: 10, 9: 10 }), id(10), 1))).seat, 10, '被槍帶走的不算（看的是被放逐的獵人）');
    assert.equal(info(voteAll(night(newGame(F), { charm: 15 }), { 8: 5, 9: 5 })).seat, 5, '殉情的不算');
    assert.deepEqual(info(ok(E.idiotChoose(voteAll(day(), { 1: 14, 2: 14 }), id(14), false))), { day: 1, seat: 14, wolf: false }, '白癡不翻牌算放逐');
    assert.deepEqual(info(ok(E.exile(day(), 1))), { day: 1, seat: 1, wolf: true }, '主機手動登記放逐也算');
    const ui = mount(toNight(ok(E.boom(day(), id(1), 0)), 'gravekeeper'), id(12)).html('#actionBox');
    assert.match(ui, /昨天沒有人被放逐出局/);
  },

  /* 騎士 */
  'knight-1': () => {
    const p = ok(E.duel(play(newGame(B), { wolf: 9 }), id(8), 1));
    assert.ok(p.game.narration.text.startsWith('昨晚死亡的是 9 號。'), '警長競選中＝先公布死訊');
    // 對象或騎士自己昨晚已經死了：死訊照樣公布、決鬥不算、沒用掉
    for (const [knife, target] of [[1, 1], [8, 1]]) {
      const res = E.duel(play(newGame(B), { wolf: knife }), id(8), target);
      assert.equal(res.ok, false);
      assert.equal(res.room.game.day.pendingDeaths, null, '死訊照樣公布');
      assert.equal(res.room.game.alive[knife], false);
      assert.equal(res.room.game.knightUsed, false, '沒有用掉');
    }
    assert.equal(p.game.alive[1], false);
    assert.equal(ok(E.duel(ok(E.startVote(night(newGame(B)))), id(8), 1)).game.day.vote, null, '投票中＝作廢');
    assert.ok(E.duel(voteAll(night(newGame(B)), { 1: 10, 2: 10 }), id(8), 1).ok, '放逐之後也可以');
    const k = mount(night(newGame(B)), id(8));
    k.click('#myInfo', 'me', 'show');
    assert.match(k.html('#myInfo'), /data-do="duelOpen"/, '在「看我的身分」裡');
  },
  'knight-2': () => {
    const [line] = says('knight-2');
    const r = ok(E.duel(night(newGame(B)), id(8), 1));
    assert.equal(r.game.narration.text, fill(line, { N: 8, M: 1 }));
    no(E.startVote(r), '今天不放逐');
    // 最後一隻狼是狼王：先等他開槍再判勝負，不唸天黑
    const lk = ok(E.duel(withDead(night(newGame(KG)), [1, 3]), id(7), 2));
    assert.equal(lk.game.narration.text, '騎士 7 號決鬥 2 號：2 號是狼人，出局！2 號，請啟動角色技能。');
    assert.equal(lk.phase, 'day');
    assert.equal(ok(E.shoot(lk, id(2), 0)).game.narration.text, '遊戲結束，好人陣營獲勝！', '開完（或放棄）才判、不唸天黑');
    const last = ok(E.duel(withDead(night(newGame(B)), [2, 3]), id(8), 1));
    assert.equal(last.game.narration.text, '騎士 8 號決鬥 1 號：1 號是狼人，出局！遊戲結束，好人陣營獲勝！', '撞到最後一隻狼：直接唸勝負');
    assert.equal(ok(E.duel(night(newGame(F)), id(13), 6)).game.alive[6], false, '隱狼算狼');
    assert.equal(ok(E.duel(night(newGame(F)), id(13), 7)).game.alive[7], false, '石像鬼算狼');
    const k = ok(E.duel(night(newGame(KG)), id(7), 2));
    assert.deepEqual(k.game.canShoot, [2], '狼王先開槍');
  },
  'knight-3': () => {
    const [line] = says('knight-3');
    const r = ok(E.duel(night(newGame(B)), id(8), 9));
    assert.equal(r.game.alive[8], false);
    assert.equal(r.game.alive[9], true);
    assert.equal(r.game.narration.text, fill(line, { N: 8, M: 9 }));
    assert.ok(E.startVote(r).ok, '白天繼續');
    const k = mount(night(newGame(B)), id(8));
    k.click('#myInfo', 'me', 'show');
    k.click('#myInfo', 'do', 'duelOpen');
    assert.match(k.html('#myInfo'), /你出局，白天繼續。/);
  },
  'knight-4': () => {
    const day = () => night(newGame(B));
    const once = nextDay(ok(E.duel(day(), id(8), 1)), {});
    no(E.duel(once, id(8), 2), '只能一次');
    no(E.duel(day(), id(8), 8), '不能選自己');
    no(E.duel(withDead(day(), [9]), id(8), 9), '不能選死人');
    no(E.duel(voteAll(day(), { 1: 6, 2: 6 }), id(8), 1), '等開槍');
    no(E.duel(voteAll(night(newGame(F)), { 1: 14, 2: 14 }), id(13), 1), '等白癡選');
    no(E.duel(ok(E.boom(day(), id(2), 0)), id(8), 1), '今天要天黑');
    assert.ok(!E.NIGHT_ORDER.includes('knight'), '夜裡沒有動作');
  },

  /* 白癡 */
  'idiot-1': () => {
    const r = voteAll(night(newGame(F)), { 1: 14, 2: 14 });
    assert.equal(r.game.day.idiotChoice, 14);
    no(E.idiotChoose(r, 'host', true), '主機不能代按');
    no(E.idiotChoose(r, id(1), true));
    assert.match(mount(r, id(14)).html('#actionBox'), /你被放逐了[\s\S]*翻牌（免於出局）[\s\S]*不翻牌，出局/);
    const f = ok(E.idiotChoose(r, id(14), true));
    assert.equal(f.game.narration.text, fill(says('idiot-1')[0], { N: 14 }));
    no(E.startVote(f), '今天的放逐算完成：不能再投票');
    no(E.boom(f, id(1), 0), '狼人也不能自爆');
    assert.equal(f.game.alive[14], true);
    const out = ok(E.idiotChoose(r, id(14), false));
    assert.equal(out.game.alive[14], false);
    assert.equal(out.game.narration.text, fill(says('idiot-1')[1], { N: 14 }), '不翻牌唸被放逐出局');
    assert.deepEqual(out.game.graveInfo, { day: 1, seat: 14, wolf: false }, '守墓人看得到');
  },
  'idiot-2': () => {
    let r = ok(E.idiotChoose(voteAll(night(newGame(F)), { 1: 14, 2: 14 }), id(14), true));
    r = nextDay(r, {});
    assert.ok(!ok(E.startVote(r)).game.day.vote.voters.includes(14), '沒有投票權');
    assert.ok(ok(E.startVote(r)).game.day.vote.candidates.includes(14), '別人還是可以投他');
    const again = ok(E.exile(r, 14));
    assert.equal(again.game.alive[14], false, '再被放逐直接出局');
    assert.equal(again.game.day.idiotChoice ?? null, null);
  },
  'idiot-3': () => {
    assert.equal(play(newGame(F, { police: false }), { wolf: 14 }).game.alive[14], false);
    assert.equal(play(newGame(F, { police: false }), { poison: 14 }).game.alive[14], false);
    assert.ok(!E.NIGHT_ORDER.includes('idiot'));
  },

  /* 平民 */
  'villager-1': () => {
    assert.ok(!E.NIGHT_ORDER.includes('villager'));
    const r = play(newGame(B), {}, { step: 'guard' });
    assert.equal(pick(r, 9).action, undefined, '夜裡不睜眼');
    assert.ok(ok(E.startVote(night(newGame(B)))).game.day.vote.voters.includes(9));
    const g = night(newGame(B)).game;
    assert.equal(E.winnerOf({ ...g, alive: { ...g.alive, ...dead([9, 10, 11]) } }, B, R.DEFAULT_RULES), 'wolf');
  },
};

/* ───────── 頁面結構 ───────── */
test('角色說明頁：每一條規則都有檢查、每個檢查都在頁面上（不多不少）', () => {
  const onPage = [...HTML.matchAll(/data-rule="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(onPage).size, onPage.length, '編號不能重複');
  assert.deepEqual([...onPage].sort(), Object.keys(CHECKS).sort());
});

test('角色說明頁：14 個角色都有一張卡，名字、陣營、遊戲裡的簡介都跟 roles.js 一字不差；目錄連得到', () => {
  const teamLabel = { wolf: '狼人陣營', god: '神職', villager: '平民' };
  for (const r of R.ROLE_ORDER) {
    const m = HTML.match(new RegExp(`<section class="panel (\\w+)" id="${r}" data-role="${r}">\\s*<h2>([^<]+) <span class="team (\\w+)">([^<]+)</span></h2>\\s*<ol class="key">[\\s\\S]*?</ol>\\s*<details class="full">\\s*<summary>完整判定</summary>\\s*<p class="blurb" data-desc="${r}">([^<]*)</p>`));
    assert.ok(m, `沒有 ${r} 的角色卡`);
    const [, cls, name, teamCls, team, desc] = m;
    assert.equal(name, R.ROLES[r].name);
    assert.equal(cls, R.ROLES[r].team);
    assert.equal(teamCls, R.ROLES[r].team);
    assert.equal(team, teamLabel[R.ROLES[r].team]);
    assert.equal(desc, R.ROLES[r].desc, `${r} 的簡介跟遊戲裡不一樣`);
    assert.ok(HTML.includes(`<a class="${R.ROLES[r].team}" href="#${r}">${R.ROLES[r].name}</a>`), `目錄沒有 ${r}`);
  }
  assert.equal([...HTML.matchAll(/data-role="/g)].length, R.ROLE_ORDER.length);
  // 角色出現的順序＝遊戲設定畫面的順序
  const order = [...HTML.matchAll(/data-role="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(order, R.ROLE_ORDER);
});

test('角色說明頁：秒數跟程式設定一樣；黑夜順序跟 NIGHT_ORDER 一樣；台詞都是遊戲裡有的句子', () => {
  const want = {
    fakeWaitMin: R.DEFAULT_RULES.fakeWaitMin, fakeWaitMax: R.DEFAULT_RULES.fakeWaitMax, FAKE_WAIT_CAP: R.FAKE_WAIT_CAP,
    REPEAT_MS: E.REPEAT_MS / 1000, SKIP_MS: E.SKIP_MS / 1000, POLICE_MS: E.POLICE_MS / 1000,
  };
  const seen = [...HTML.matchAll(/<b data-const="(\w+)">(\d+)<\/b>/g)];
  assert.ok(seen.length >= Object.keys(want).length);
  for (const [, k, v] of seen) assert.equal(Number(v), want[k], k);
  // 黑夜順序那一排
  const name = { guard: '守衛', wolf: '狼人', beauty: '狼美人', hidden: '隱狼', witch: '女巫', seer: '預言家', gargoyle: '石像鬼', gravekeeper: '守墓人', hunter: '獵人' };
  const row = HTML.match(/<div class="order" data-rule-order>([\s\S]*?)<\/div>/)[1];
  const spans = [...row.matchAll(/<span>([^<]+)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(spans, ['天黑請閉眼', ...E.NIGHT_ORDER.map(s => name[s]), '上警（第一晚）', '天亮']);
  // 「還沒錄音」那行＝頁面台詞用到、但 public/voice/manifest.json 還沒有的片段（錄好之後這行要拿掉）
  const manifest = JSON.parse(readFileSync(new URL('../public/voice/manifest.json', import.meta.url), 'utf8')).files;
  const used = new Set();
  for (const [, s] of HTML.matchAll(/<span class="say">([^<]*)<\/span>/g)) {
    let rest = s.replaceAll('N 號', '').replaceAll('M 號', '');
    while (rest) { const k = Object.keys(LINES).filter(x => LINES[x] && rest.startsWith(LINES[x])).sort((a, b) => LINES[b].length - LINES[a].length)[0]; used.add(k); rest = rest.slice(LINES[k].length); }
  }
  used.add('wolfBoom'); // 「N 號狼人自爆」寫在 wolf-3 的台詞裡
  const missing = [...used].filter(k => !['end', 'sep', 'colon', 'comma'].includes(k) && !manifest[k]).sort();
  const listed = (HTML.match(/data-unrecorded="([^"]*)"/)?.[1] ?? '').split(',').filter(Boolean).sort(); // 全部錄好就沒有這一行
  assert.deepEqual(listed, missing, '「還沒錄音」那行要跟音檔清單一致');
  // 每一句台詞（N、M 換成號碼後）都要能用片段表拼出來：拆掉號碼後的每一段都是某個片段的文字
  const pieces = Object.values(LINES).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const [, s] of HTML.matchAll(/<span class="say">([^<]*)<\/span>/g)) {
    let rest = s.replaceAll('N 號', '').replaceAll('M 號', '');
    for (let guard = 0; rest && guard < 50; guard++) {
      const p = pieces.find(x => rest.startsWith(x));
      assert.ok(p, `台詞拼不出來：「${s}」卡在「${rest}」`);
      rest = rest.slice(p.length);
    }
  }
});

// Leo 2026-10-28：每段攤開 2～5 條重點（1. 2. 3.），細節收在「完整判定」；畫面上不出現 wolf-3 這種編號
test('角色說明頁：每段都有 2～5 條重點、完整判定收起來；畫面文字沒有規則編號', () => {
  const sections = [...HTML.matchAll(/<section class="panel[^"]*" id="(\w+)"[^>]*>([\s\S]*?)<\/section>/g)];
  assert.equal(sections.length, 3 + R.ROLE_ORDER.length);
  for (const [, id, inner] of sections) {
    const key = inner.match(/<ol class="key">([\s\S]*?)<\/ol>/);
    assert.ok(key, `${id} 沒有重點`);
    const n = [...key[1].matchAll(/<li>/g)].length;
    assert.ok(n >= 2 && n <= 5, `${id} 重點 ${n} 條`);
    assert.ok(!/data-|class="say"/.test(key[1]), `${id} 的重點不放台詞、秒數（那些在完整判定裡核對）`);
    assert.ok(inner.indexOf('<details class="full">') > inner.indexOf('<ol class="key">'), `${id} 的完整判定要收在重點後面`);
    assert.ok(!/<details class="full" open/.test(inner));
  }
  const visible = HTML.replace(/<(style|script)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '');
  assert.deepEqual(visible.match(/\b[a-zA-Z]+-\d+\b/g) ?? [], []);
});

for (const [rule, check] of Object.entries(CHECKS)) {
  test(`規則 ${rule}：${textOf(rule).slice(0, 40)}…`, check);
}
