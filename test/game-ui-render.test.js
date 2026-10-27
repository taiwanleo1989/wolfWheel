// 手機畫面（public/judge/game-ui.js）真的畫一次：新角色的按鈕與資訊有出來、畫的時候不會丟錯
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/lobby.js';
import * as G from '../src/game.js';
import * as E from '../src/engine.js';

globalThis.document = { body: { classList: { toggle() {} } } };
// 主機夜裡的「跳過」會掛一個 30 秒計時器重畫；測試不需要，換成不做事（不然整個測試多等 30 秒）
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
const { renderGame, bindGame } = await import('../public/judge/game-ui.js');

// FULL：1–2 狼人、3 白狼王、4 狼美人、5 隱狼、6 石像鬼、7 預言家、8 女巫、9 獵人、10 守衛、11 守墓人、12–14 平民
const FULL = { wolf: 2, whiteKing: 1, beauty: 1, hidden: 1, gargoyle: 1, seer: 1, witch: 1, hunter: 1, guard: 1, gravekeeper: 1, villager: 3 };
const id = n => 'p' + n;
const minRand = () => 0;

function newGame() {
  let r = L.newRoom('1234', 14, 'host', 0);
  for (let n = 1; n <= 14; n++) r = L.claimSeat(r, id(n), n, new Set()).room;
  r = G.setSetup(r, { counts: FULL }).room;
  r = G.startDeal(r, n => n - 1).room;
  return E.startGame(r, 0, minRand).room;
}
const everyone = r => new Set(Object.values(r.seats));
const step = r => r.game.night.steps[r.game.night.idx];
const waiting = r => r.phase === 'night' && r.game.night.stage === 'acting' && r.game.night.wait === 'people';
// 一路往下走到某一步在等人（'none'＝走到天亮）；其他步驟照預設動作
function toStep(r, name) {
  for (let i = 0; i < 200; i++) {
    if (r.phase !== 'night') return r;
    if (waiting(r) && step(r) === name) return r;
    if (!waiting(r)) { r = E.advance(r, r.game.timer.at, minRand).room; continue; }
    const who = E.actors(r.game, step(r));
    const a = E.scriptFor(step(r), r.setup.counts).beats[r.game.night.beat].act;
    const go = (s, p) => { const res = E.nightAction(r, id(s), p, everyone(r), 0, minRand); assert.ok(res.ok, res.error); r = res.room; };
    if (a === 'wolf') { for (const w of who) go(w, { target: 0 }); go(who[0], { confirm: true }); }
    else if (a === 'seer' || a === 'gargoyle') { go(who[0], { target: 12 }); go(who[0], { done: true }); }
    else if (a === 'witchSave') go(who[0], { use: 'skip' });
    else if (a === 'witchPoison') go(who[0], { use: 'none' });
    else if (a === 'guard' || a === 'beauty') go(who[0], { target: 0 });
    else go(who[0], { seen: true });
  }
  throw new Error('走不到 ' + name);
}

// 跟 app.js 一樣的介面：畫一次；click(區塊, 屬性, 值) 模擬點按鈕後重畫
function mount(room, clientId) {
  const els = {}, sent = [], voiceCalls = [];
  const $ = s => (els[s] ??= { hidden: false, textContent: '', innerHTML: '', className: '', addEventListener(_, fn) { this.fn = fn; } });
  const ctx = {
    state: G.viewFor(room, everyone(room), clientId), $, esc: s => String(s), send: m => sent.push(m), toast() {},
    render: () => renderGame(ctx), setHTML: (el, h) => { el.innerHTML = h; },
    voice: { unlocked: true, bgmOn: false, voiceName: '測試', unlock() {}, stop() {}, setNight() {}, expectFresh: () => voiceCalls.push('expectFresh'), holdUntil: clip => voiceCalls.push('holdUntil:' + clip) },
  };
  renderGame(ctx);
  bindGame($);
  const click = (box, attr, value) => $(box).fn({ target: { closest: q => (q === `[data-${attr}]` ? { dataset: { [attr]: value } } : null) } });
  return { $, click, html: box => $(box).innerHTML, sent, voiceCalls };
}

test('夜裡：狼美人、石像鬼、守墓人的手機畫面', () => {
  let r = toStep(newGame(), 'beauty');
  assert.match(mount(r, id(4)).html('#actionBox'), /請選擇今晚要魅惑的玩家[\s\S]*今晚不魅惑/);
  assert.equal(mount(r, id(1)).html('#actionBox'), '', '別人不出現操作');
  const m = mount(r, id(4));
  m.click('#actionBox', 'do', 'beauty0');
  assert.match(m.html('#actionBox'), /今晚不魅惑任何人，是否正確/);

  r = toStep(newGame(), 'gargoyle');
  assert.match(mount(r, id(6)).html('#actionBox'), /石像鬼看得到具體身分/);
  r = E.nightAction(r, id(6), { target: 5 }, everyone(r), 0, minRand).room;
  assert.match(mount(r, id(6)).html('#actionBox'), /5<\/span> 號是 <b>隱狼<\/b>/);

  r = toStep(E.nextNight(E.exile(E.announceDeaths(toStep(newGame(), 'none')).room, 1).room, 1e6).room, 'gravekeeper');
  assert.match(mount(r, id(11)).html('#actionBox'), /1<\/span> 號是 <b>👎 狼人<\/b>/);
  assert.match(mount(r, 'host').html('#hostCtl'), /現在輪到：<b>守墓人<\/b>/);
});

test('狼人那步：隊友只列狼隊；隱狼、石像鬼看閉眼畫面', () => {
  const r = toStep(newGame(), 'wolf');
  const a = mount(r, id(1)).html('#actionBox');
  assert.match(a, /你的隊友：2 號、3 號、4 號/);
  const votes = a.match(/<ul class="votes">([\s\S]*?)<\/ul>/)[1];
  assert.deepEqual([...votes.matchAll(/<li>(\d+) 號/g)].map(x => Number(x[1])), [1, 2, 3, 4], '投票名單沒有隱狼、石像鬼');
  assert.equal(mount(r, id(5)).html('#actionBox'), '');
  assert.equal(mount(r, id(6)).html('#actionBox'), '');
});

test('白天：白狼王的自爆按鈕收在「看我的身分」裡，所有活人的畫面一樣（Leo 2026-10-22 B1）；自爆後主機畫面', () => {
  let r = E.announceDeaths(toStep(newGame(), 'none')).room;
  for (let s = 1; s <= 14; s++) {
    const v = mount(r, id(s));
    if (r.game.alive[s]) assert.equal(v.html('#actionBox'), '', `${s} 號白天的動作區要是空的`);
    assert.match(v.html('#myInfo'), /看我的身分/);
  }
  const m = mount(r, id(3));
  assert.ok(!m.html('#myInfo').includes('自爆'), '身分蓋著時看不到');
  m.click('#myInfo', 'me', 'show');
  assert.match(m.html('#myInfo'), /自爆（白狼王技能）/);
  m.click('#myInfo', 'do', 'boomOpen');
  assert.match(m.html('#myInfo'), /<h2>白狼王自爆<\/h2>[\s\S]*自爆，不帶人/);
  m.click('#myInfo', 'pick', '7');
  assert.match(m.html('#myInfo'), /自爆，帶走 7 號/);
  // 2026-10-27 起一般狼人也能自爆（不帶人）；狼美人不行、好人沒有
  const other = mount(r, id(1));
  other.click('#myInfo', 'me', 'show');
  other.click('#myInfo', 'do', 'boomClose'); // 測試裡每支手機共用同一份畫面狀態，先關掉上一支打開的
  assert.match(other.html('#myInfo'), /自爆（狼人）/);
  other.click('#myInfo', 'do', 'boomOpen');
  assert.match(other.html('#myInfo'), /<h2>狼人自爆<\/h2>[\s\S]*確定自爆/);
  assert.ok(!other.html('#myInfo').includes('帶走'), '一般狼人不能帶人');
  for (const s of [4, 7, 12]) {
    const x = mount(r, id(s));
    x.click('#myInfo', 'me', 'show');
    assert.ok(!x.html("#myInfo").includes("data-do=\"boomOpen\""), `${s} 號沒有自爆鈕`);
  }
  const wb = E.boom(r, id(1), 0).room;
  assert.equal(wb.game.narration.text, '1 號狼人自爆，天黑請閉眼。');
  assert.match(mount(wb, 'host').html('#hostCtl'), /<h2>狼人自爆<\/h2>[\s\S]*進入黑夜/);
  const b = E.boom(r, id(3), 7).room;
  assert.match(mount(b, 'host').html('#hostCtl'), /<h2>白狼王自爆<\/h2>[\s\S]*進入黑夜/);
  assert.ok(!mount(b, 'host').html('#hostCtl').includes('被放逐的是'), '主機不出現放逐');
});

test('看自己的身分：隱狼看得到狼隊、石像鬼不認得隊友、狼美人看得到魅惑誰、守墓人有紀錄', () => {
  const r = E.announceDeaths(toStep(newGame(), 'none')).room;
  const show = cid => {
    const m = mount(r, cid);
    m.click('#myInfo', 'me', 'show');
    const h = m.html('#myInfo');
    m.click('#myInfo', 'me', 'hide');
    return h;
  };
  assert.match(show(id(5)), /隱狼[\s\S]*狼隊友：1 號、2 號、3 號、4 號/);
  assert.match(show(id(6)), /不知道（石像鬼不跟狼隊友見面）/);
  assert.match(show(id(6)), /查驗紀錄：第 1 夜 12 號是平民/);
  assert.match(show(id(4)), /目前魅惑：沒有/);
  assert.match(show(id(11)), /守墓紀錄：還沒有/);
  assert.match(show(id(3)), /白狼王/);
  assert.match(show(id(1)), /狼隊友：2 號、3 號、4 號/, '狼人看不到隱狼、石像鬼');
});

test('夜裡：獵人的帶槍手勢畫面有「知道了」按鈕；狼王沒有這一步了（Leo 2026-10-27 取消）', () => {
  // 1–2 狼人、3 狼王、4 預言家、5 女巫、6 獵人、7–12 平民
  const KING = { wolf: 2, king: 1, seer: 1, witch: 1, hunter: 1, villager: 6 };
  let r = L.newRoom('1234', 12, 'host', 0);
  for (let n = 1; n <= 12; n++) r = L.claimSeat(r, id(n), n, new Set()).room;
  r = G.setSetup(r, { counts: KING }).room;
  r = G.startDeal(r, n => n - 1).room;
  r = E.startGame(r, 0, minRand).room;
  assert.ok(!r.game.night.steps.includes('king'));
  r = toStep(r, 'hunter');
  const m = mount(r, id(6));
  assert.match(m.html('#actionBox'), /你今晚的帶槍手勢是[\s\S]*👍 可以開槍[\s\S]*data-do="hunterSeen"[\s\S]*知道了/);
  assert.equal(mount(r, id(3)).html('#actionBox'), '', '狼王沒有');
  assert.match(mount(r, 'host').html('#hostCtl'), /現在輪到：<b>獵人<\/b>/);
  assert.match(mount(r, 'host').html('#hostCtl'), /睜眼 25 秒後可按/);
  // 舊網頁不認得的步驟：不能一片空白，要叫他重新整理
  const v = G.viewFor(r, everyone(r), id(3));
  v.you.game.action = { kind: 'somethingNew' };
  const els = {};
  const $ = s => (els[s] ??= { hidden: false, innerHTML: '', textContent: '', className: '', addEventListener() {} });
  renderGame({ state: v, $, esc: s => String(s), send() {}, toast() {}, render() {}, setHTML: (el, h) => { el.innerHTML = h; }, voice: { unlocked: true, bgmOn: false, voiceName: '測試', unlock() {} } });
  assert.match($('#actionBox').innerHTML, /網頁是舊版[\s\S]*data-do="reload"/);
  assert.equal($('#actionBox').hidden, false);
});

test('女巫：救、不救、毒藥不使用都先問「是否正確」；沒得選的「繼續」直接走（Leo 2026-10-22 ⑦A）', () => {
  let r = toStep(newGame(), 'wolf');
  for (const w of E.actors(r.game, 'wolf')) r = E.nightAction(r, id(w), { target: 12 }, everyone(r), 0, minRand).room;
  r = E.nightAction(r, id(1), { confirm: true }, everyone(r), 0, minRand).room;
  r = toStep(r, 'witch');
  for (const [btn, text] of [['save', /今晚要用解藥救 12 號，是否正確/], ['noSave', /今晚不使用解藥，是否正確/]]) {
    const m = mount(r, id(8));
    m.click('#actionBox', 'do', btn);
    assert.match(m.html('#actionBox'), text);
    assert.deepEqual(m.sent, [], '按「正確」之前不送出');
    m.click('#actionBox', 'do', 'yes');
    assert.deepEqual(m.sent.map(s => s.payload.use), [btn === 'save' ? 'save' : 'skip']);
  }
  r = E.nightAction(r, id(8), { use: 'skip' }, everyone(r), 0, minRand).room;
  r = toStep(r, 'witch');
  const m = mount(r, id(8));
  m.click('#actionBox', 'do', 'none');
  assert.match(m.html('#actionBox'), /今晚不使用毒藥，是否正確/);
  assert.deepEqual(m.sent, []);
  // 今晚沒人死、解藥沒得用：「繼續」直接走
  const quiet = toStep(newGame(), 'witch');
  const q = mount(quiet, id(8));
  q.click('#actionBox', 'do', 'noSave');
  assert.deepEqual(q.sent.map(s => s.payload.use), ['skip']);
});

test('直接重開：主機不把台詞序號歸零（序號由伺服器接著往上算，見 game.test；2026-10-22 瀏覽器實測）', () => {
  const r = toStep(newGame(), 'guard');
  globalThis.window = { confirm: () => true };
  try {
    const m = mount(r, 'host');
    m.click('#hostCtl', 'host', 'restart');
    assert.deepEqual(m.voiceCalls, ['holdUntil:checkRole'], '不歸零（舊台詞會被當新的唸）；先擋住舊局台詞，等到「請確認角色身分」');
    assert.deepEqual(m.sent, [{ type: 'restart' }]);
  } finally { delete globalThis.window; }
});

test('新的一局：上一局打開的身分、沒按完的確認框全部清掉（2026-10-22 驗測：新身分直接攤在螢幕上）', () => {
  // 第 1 夜守衛：選 1 號 → 出現確認框；打開身分
  let r = toStep(newGame(), 'guard');
  const m = mount(r, id(10));
  m.click('#actionBox', 'pick', '1');
  m.click('#actionBox', 'do', 'guard');
  m.click('#myInfo', 'me', 'show');
  assert.match(m.html('#actionBox'), /今晚要守護的玩家是 1 號，是否正確/);
  assert.match(m.html('#myInfo'), /蓋起來/);
  // 直接重開（同一支手機、同一個畫面模組）→ 新局第 1 夜又輪到守衛
  let again = G.restart(r, n => n - 1).room;
  for (let s = 1; s <= 14; s++) again = G.ack(again, id(s)).room;
  again = toStep(E.startGame(again, 0, minRand).room, 'guard');
  const m2 = mount(again, id(10));
  assert.ok(!m2.html('#actionBox').includes('是否正確'), '舊的確認框不能留著');
  assert.match(m2.html('#myInfo'), /看我的身分/, '身分要重新蓋起來');
  assert.ok(!m2.html('#myInfo').includes('蓋起來'));
});

test('換手機：對局中沒坐下的手機看得到「接手座位」（離線的號碼），主機看得到申請、按同意送出（Leo 2026-10-22 A1）', () => {
  const r = toStep(newGame(), 'guard');
  const online = new Set(Object.values(r.seats).filter(c => c !== id(5)).concat(['host', 'newPhone']));
  const v = G.viewFor(r, online, 'newPhone');
  const els = {}, sent = [];
  const $ = s => (els[s] ??= { hidden: false, textContent: '', innerHTML: '', className: '', addEventListener(_, fn) { this.fn = fn; } });
  const ctx = { state: v, $, esc: s => String(s), send: m => sent.push(m), toast() {}, render: () => renderGame(ctx), setHTML: (el, h) => { el.innerHTML = h; }, voice: { unlocked: true, bgmOn: false, voiceName: '測試', unlock() {} } };
  renderGame(ctx); bindGame($);
  assert.equal($('#takeover').hidden, false);
  assert.match($('#takeover').innerHTML, /換手機接手座位[\s\S]*data-take-seat="5"/);
  assert.ok(!$('#takeover').innerHTML.includes('data-take-seat="4"'), '在線上的座位不能點');
  $('#takeover').fn({ target: { closest: q => (q === '[data-take-seat]' ? { dataset: { takeSeat: '5' } } : null) } });
  assert.deepEqual(sent, [{ type: 'claimSeat', seat: 5 }]);
  // 主機看到申請
  const req = G.claimSeat(r, 'newPhone', 5, online).room;
  const hv = G.viewFor(req, online, 'host');
  const hels = {}, hsent = [];
  const h$ = s => (hels[s] ??= { hidden: false, textContent: '', innerHTML: '', className: '', addEventListener(_, fn) { this.fn = fn; } });
  const hctx = { state: hv, $: h$, esc: s => String(s), send: m => hsent.push(m), toast() {}, render: () => renderGame(hctx), setHTML: (el, h) => { el.innerHTML = h; }, voice: { unlocked: true, bgmOn: false, voiceName: '測試', unlock() {} } };
  renderGame(hctx); bindGame(h$);
  assert.match(h$('#hostCtl').innerHTML, /換手機接手座位[\s\S]*5 號[\s\S]*data-approve="5" data-yes="1"/);
  globalThis.window = { confirm: () => true };
  try {
    h$('#hostCtl').fn({ target: { closest: q => (q === '[data-approve]' ? { dataset: { approve: '5', yes: '1' } } : null) } });
  } finally { delete globalThis.window; }
  assert.deepEqual(hsent, [{ type: 'approveSeat', seat: 5, yes: true }]);
});
