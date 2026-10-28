// 主持台詞頁（public/lines/index.html，Leo 2026-10-28）跟遊戲一致：
// 每一句的片段都在台詞表、都有錄音；遊戲用得到的片段都列在頁面上；有號碼的組合句是引擎真的會唸的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as L from '../src/lobby.js';
import * as G from '../src/game.js';
import * as E from '../src/engine.js';
import * as R from '../public/shared/roles.js';
import { LINES, SILENT } from '../public/shared/voice-lines.js';

const HTML = readFileSync(new URL('../public/lines/index.html', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../public/voice/manifest.json', import.meta.url), 'utf8')).files;
const ENTRIES = [...HTML.matchAll(/<li data-clips="([^"]+)">/g)].map(m => m[1].split(' '));
// 已經不用、頁面上不列的片段：狼王帶槍手勢（2026-10-27 取消，scriptFor 的 'king' 只留給舊房間）、舊版開槍句
const RETIRED = ['kingOpen', 'kingClose', 'shootSkill'];
const isSeat = k => /^n\d+$/.test(k);

test('主持台詞頁：每個片段都在台詞表；還沒錄音的都寫在「還沒錄音」那行', () => {
  assert.ok(ENTRIES.length > 30);
  const missing = new Set();
  for (const clips of ENTRIES) for (const k of clips) {
    assert.ok(k in LINES, `台詞表沒有 ${k}`);
    if (!SILENT.has(k) && !MANIFEST[k]) missing.add(k);
  }
  const listed = (HTML.match(/data-unrecorded="([^"]*)"/)?.[1] ?? '').split(',').filter(Boolean).sort(); // 全部錄好就拿掉那一行
  assert.deepEqual(listed, [...missing].sort(), '「還沒錄音」那行要跟音檔清單一致');
  for (let n = 1; n <= 20; n++) assert.ok(MANIFEST['n' + n], `n${n} 沒有錄音`); // 號碼那格 1～20 號
});

test('主持台詞頁：遊戲用得到的片段都列在頁面上，已經不用的不列', () => {
  const onPage = new Set(ENTRIES.flat());
  const want = Object.keys(LINES).filter(k => !SILENT.has(k) && !isSeat(k) && !RETIRED.includes(k));
  assert.deepEqual(want.filter(k => !onPage.has(k)), [], '新台詞要加進主持台詞頁');
  assert.deepEqual(RETIRED.filter(k => onPage.has(k)), []);
  // 不用的真的不用：新開的局夜裡沒有狼王那步；程式不再唸 shootSkill
  assert.ok(!E.NIGHT_ORDER.includes('king'));
  const src = readdirSync(new URL('../src/', import.meta.url)).map(f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')).join('');
  assert.ok(!src.includes("'shootSkill'"));
});

test('主持台詞頁：秒數、黑夜順序跟程式一樣', () => {
  const want = { REPEAT_MS: E.REPEAT_MS / 1000, POLICE_MS: E.POLICE_MS / 1000 };
  const seen = [...HTML.matchAll(/<b data-const="(\w+)">(\d+)<\/b>/g)];
  assert.equal(seen.length, Object.keys(want).length);
  for (const [, k, v] of seen) assert.equal(Number(v), want[k], k);
  const name = { guard: '守衛', wolf: '狼人', beauty: '狼美人', hidden: '隱狼', witch: '女巫', seer: '預言家', gargoyle: '石像鬼', gravekeeper: '守墓人', hunter: '獵人' };
  const row = HTML.match(/<div class="order" data-night-order>([\s\S]*?)<\/div>/)[1];
  assert.deepEqual([...row.matchAll(/<span>([^<]+)<\/span>/g)].map(m => m[1]), ['天黑', ...E.NIGHT_ORDER.map(s => name[s]), '上警（第一晚）']);
});

/* ───────── 有號碼的組合句：實際跑引擎，收集主機唸的每一句，頁面的句子要是其中一段 ───────── */
const id = n => 'p' + n;
const rand0 = () => 0;
const heard = [];
const hear = room => { const n = room.game?.narration; if (n) heard.push(n.clips); return room; };
const must = res => { assert.ok(res.ok, res.error); return hear(res.room); };
function newGame(counts) {
  const players = R.totalOf(counts);
  let r = L.newRoom('1234', players, 'host', 0);
  for (let s = 1; s <= players; s++) r = L.claimSeat(r, id(s), s, new Set()).room;
  r = G.setSetup(r, { counts, rules: {} }).room;
  r = G.startDeal(r, k => k - 1).room;
  return hear(E.startGame(r, 0, rand0).room);
}
const seat = (r, role, i = 0) => Object.keys(r.game.roles).map(Number).filter(s => r.game.roles[s] === role)[i];
const all = r => new Set(Object.values(r.seats));
// 跑一晚：plan.wolf＝刀誰、plan.poison＝女巫毒誰、plan.charm＝狼美人魅惑誰；其他角色不動作
function night(r, plan = {}) {
  for (let i = 0; i < 400 && r.phase === 'night'; i++) {
    const n = r.game.night;
    if (!(n.stage === 'acting' && n.wait === 'people')) { r = hear(E.advance(r, r.game.timer.at, rand0).room); continue; }
    const st = n.steps[n.idx], who = E.actors(r.game, st), act = E.scriptFor(st, r.setup.counts).beats[n.beat].act;
    const go = (s, p) => { r = must(E.nightAction(r, id(s), p, all(r), 0, rand0)); };
    if (act === 'wolf') { for (const w of who) go(w, { target: plan.wolf ?? 0 }); go(who[0], { confirm: true }); }
    else if (act === 'seer' || act === 'gargoyle') {
      go(who[0], { target: Object.keys(r.game.alive).map(Number).find(s => r.game.alive[s] && s !== who[0]) });
      go(who[0], { done: true });
    }
    else if (act === 'witchSave') go(who[0], { use: 'skip' });
    else if (act === 'witchPoison') go(who[0], plan.poison ? { use: 'poison', target: plan.poison } : { use: 'none' });
    else if (act === 'beauty') go(who[0], { target: plan.charm ?? 0 });
    else if (act === 'guard') go(who[0], { target: 0 });
    else go(who[0], { seen: true });
  }
  return r;
}
const announce = r => (r.game.day?.pendingDeaths ? must(E.announceDeaths(r)) : r);
const voteFor = (r, target) => { r = must(E.startVote(r)); for (const s of r.game.day.vote.voters) r = must(E.castVote(r, id(s), s === target ? 0 : target)); return r; };
const toNight = (r, plan) => { r = must(E.nextNight(r, 0)); return night(r, plan); };

test('主持台詞頁：有號碼的組合句都是引擎真的會唸的', () => {
  // A：狼人、狼美人、白狼王、預言家、女巫、獵人、守衛、守墓人、騎士、白癡、平民
  const A = { wolf: 2, whiteKing: 1, beauty: 1, seer: 1, witch: 1, hunter: 1, guard: 1, gravekeeper: 1, knight: 1, idiot: 1, villager: 3 };
  const v = i => s => seat(s, 'villager', i);
  { // 第一天警長競選：天亮只唸天亮 → 公布死訊；放逐、狼美人殉情、白癡翻牌、平票、全部棄票、第二天天亮
    let r = night(newGame(A), { wolf: R.totalOf(A) }); // 最後一位平民
    r = announce(r);
    r = voteFor(r, seat(r, 'idiot')); r = must(E.idiotChoose(r, id(seat(r, 'idiot')), true));
    r = toNight(r);
    r = must(E.startVote(r)); for (const s of r.game.day.vote.voters) r = must(E.castVote(r, id(s), 0)); r = must(E.exile(r, 0));
    r = toNight(r, { charm: seat(r, 'hunter') });
    r = voteFor(r, seat(r, 'beauty'));
    r = toNight(r, { wolf: v(1)(r) });
    r = must(E.exile(r, 0));
  }
  { // 第二天沒人死；放逐普通人；騎士撞好人、撞狼；獵人出局開槍；狼人自爆；白狼王自爆（帶人、不帶人）
    let r = announce(night(newGame(A)));
    r = must(E.exile(r, v(0)(r)));
    r = toNight(r);
    r = must(E.duel(r, id(seat(r, 'knight')), v(1)(r)));
    r = voteFor(r, seat(r, 'hunter')); r = must(E.shoot(r, id(seat(r, 'hunter')), v(2)(r)));
    r = toNight(r);
    r = must(E.boom(r, id(seat(r, 'wolf')), 0));
  }
  {
    let r = announce(night(newGame(A)));
    r = must(E.duel(r, id(seat(r, 'knight')), seat(r, 'wolf')));
    r = toNight(r);
    r = must(E.boom(r, id(seat(r, 'whiteKing')), 0));
  }
  {
    let r = announce(night(newGame(A)));
    r = must(E.boom(r, id(seat(r, 'whiteKing')), v(0)(r)));
  }
  { // 一晚死兩個：狼刀一個、女巫毒一個
    let r = announce(night(newGame(A)));
    r = must(E.exile(r, 0));
    r = toNight(r, { wolf: v(1)(r), poison: v(2)(r) });
  }
  const norm = clips => clips.map(k => (isSeat(k) ? 'n' : k)).join(' ');
  const said = heard.map(c => ` ${norm(c)} `);
  for (const clips of ENTRIES.filter(c => c.length > 1)) {
    const want = ` ${norm(clips)} `;
    assert.ok(said.some(s => s.includes(want)), `引擎沒唸過「${clips.join(' ')}」`);
  }
});
