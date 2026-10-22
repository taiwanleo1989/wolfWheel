import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/lobby.js';
import * as G from '../src/game.js';
import * as R from '../public/shared/roles.js';

const rand = n => Math.floor(Math.random() * n);
function fullRoom(players = 12) {
  let r = L.newRoom('1234', players, 'host', 0);
  for (let n = 1; n <= players; n++) r = L.claimSeat(r, 'p' + n, n, new Set()).room;
  return G.withSetup(r);
}

test('角色數量整理：亂填歸零、限定一人的最多 1', () => {
  assert.deepEqual(R.cleanCounts({ wolf: 3.7, seer: 2, witch: -1, bogus: 5, villager: '4' }), { wolf: 3, seer: 1, villager: 4 });
});

test('規則整理：不認得的值退回預設、假等秒數上下限', () => {
  assert.deepEqual(R.cleanRules({ witchSelfSave: 'x', win: 'all', fakeWaitMin: 1, fakeWaitMax: 999 }), { witchSelfSave: 'never', win: 'all', police: true, fakeWaitMin: 3, fakeWaitMax: 60 });
  assert.equal(R.cleanRules({ fakeWaitMin: 20, fakeWaitMax: 10 }).fakeWaitMax, 20);
});

const KING_GUARD = { wolf: 3, king: 1, seer: 1, witch: 1, hunter: 1, guard: 1, villager: 4 };
const SEER_IDIOT = { wolf: 4, seer: 1, witch: 1, hunter: 1, idiot: 1, villager: 4 };

test('沒有預設板子（Leo 2026-10-11）：新房間先放狼人＋平民湊滿人數、可以直接發牌，主機自己加角色', () => {
  assert.equal(R.PRESETS, undefined);
  for (const players of [4, 6, 9, 12, 20]) {
    const r = fullRoom(players);
    assert.equal(r.setup.preset, undefined);
    assert.deepEqual(R.problems(r.setup.counts, players), [], `${players} 人`);
    assert.deepEqual(Object.keys(r.setup.counts).sort(), ['villager', 'wolf']);
  }
  assert.deepEqual(fullRoom(12).setup.counts, { wolf: 3, villager: 9 });
});

test('開局檢查：人數不符、沒狼、狼太多', () => {
  assert.match(R.problems({ wolf: 4, villager: 7 }, 12)[0], /11 個.*12 個/);
  assert.ok(R.problems({ villager: 12 }, 12).some(s => /至少要有 1 隻狼/.test(s)));
  assert.ok(R.problems({ wolf: 6, villager: 6 }, 12).some(s => /少於一半/.test(s)));
});

test('發牌：每種角色張數正確、每個座位都有角色', () => {
  const counts = KING_GUARD;
  const roles = R.deal(counts, 12, rand);
  assert.equal(Object.keys(roles).length, 12);
  const tally = {};
  for (const id of Object.values(roles)) tally[id] = (tally[id] ?? 0) + 1;
  assert.deepEqual(tally, counts);
});

test('發牌是真的亂：同一個座位 2000 次裡各角色都出現過', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(R.deal(SEER_IDIOT, 12, rand)[1]);
  assert.deepEqual([...seen].sort(), ['idiot', 'hunter', 'seer', 'villager', 'witch', 'wolf'].sort());
});

test('座位沒坐滿不能發牌', () => {
  let r = L.newRoom('1234', 12, 'host', 0);
  r = L.claimSeat(r, 'a', 1, new Set()).room;
  const res = G.startDeal(r, rand);
  assert.equal(res.ok, false);
  assert.match(res.error, /還有 11 個座位沒人/);
});

test('發牌後：每支手機只拿到自己的角色，主機（沒坐下）拿不到任何角色', () => {
  const r = G.startDeal(fullRoom(), rand).room;
  const online = new Set(Object.values(r.seats).concat('host'));
  const v3 = G.viewFor(r, online, 'p3');
  assert.equal(v3.you.role, r.game.roles[3]);
  const others = Object.entries(r.game.roles).filter(([s]) => s !== '3');
  // 3 號的畫面資料裡，不能出現「座位 → 角色」的對應
  assert.equal(JSON.stringify(v3).includes('"roles"'), false);
  const hostView = G.viewFor(r, online, 'host');
  assert.equal(hostView.you.role, undefined);
  assert.equal(JSON.stringify(hostView).includes('"roles"'), false);
  assert.ok(others.length === 11);
});

test('確認看過身分、重新發牌會清掉確認', () => {
  let r = G.startDeal(fullRoom(), rand).room;
  r = G.ack(r, 'p2').room;
  r = G.ack(r, 'p5').room;
  assert.deepEqual(G.viewFor(r, new Set(), 'host').acked, [2, 5]);
  r = G.redeal(r, rand).room;
  assert.deepEqual(G.viewFor(r, new Set(), 'host').acked, []);
});

test('發牌後不能換座位、不能改板子；接手離線的座位要主機按同意（Leo 2026-10-22 A1）', () => {
  const r = G.startDeal(fullRoom(), rand).room;
  const on = new Set(['newPhone', 'host']);
  assert.equal(G.claimSeat(r, 'p1', 2, new Set(['p1'])).ok, false);
  assert.equal(G.setSetup(r, { counts: { wolf: 1 } }).ok, false);
  assert.equal(G.leaveSeat(r, 'p1').ok, false);
  assert.equal(G.claimSeat(r, 'newPhone', 4, new Set(['p4', 'newPhone'])).ok, false, '原主人還在線上就不行');
  // 申請：還沒接回、看不到身分；主機只看到號碼
  const req = G.claimSeat(r, 'newPhone', 4, on).room;
  assert.equal(G.viewFor(req, on, 'newPhone').you.role, undefined, '主機同意前看不到身分');
  assert.equal(G.viewFor(req, on, 'newPhone').you.requestedSeat, 4);
  assert.deepEqual(G.viewFor(req, on, 'host').seatRequests, [4]);
  assert.equal(G.viewFor(req, on, 'host').you.role, undefined, '主機看不到 4 號的角色');
  assert.equal(G.viewFor(req, on, 'p1').seatRequests, undefined, '別人看不到申請');
  // 拒絕：申請消失
  assert.deepEqual(G.viewFor(G.approveSeat(req, 4, false, on).room, on, 'host').seatRequests, []);
  // 同意：接回座位，身分跟著座位走
  const ok = G.approveSeat(req, 4, true, on);
  assert.equal(ok.ok, true);
  assert.equal(G.viewFor(ok.room, on, 'newPhone').you.role, r.game.roles[4], '身分跟著座位走');
  // 同意前原主人回來了：不接、申請清掉
  const back = G.approveSeat(req, 4, true, new Set([...on, 'p4']));
  assert.equal(back.ok, false);
  assert.deepEqual(back.room.seatRequests, {});
  // 主機自己不能接手座位（不然點一下離線座位就看到他的身分）
  assert.equal(G.claimSeat(r, 'host', 4, on).error, '對局中主機不能接手座位');
});

test('對局中接手主機：原主機斷線滿 1 分鐘才行，接手後紀錄寫一行（Leo 2026-10-22 A1）', async () => {
  const E = await import('../src/engine.js');
  const r = E.startGame(G.startDeal(fullRoom(), rand).room, 0, rand).room;
  const gone = { ...r, hostLeftAt: 1000 };
  const early = G.takeHost(gone, 'x', new Set(), 1000 + 30000);
  assert.equal(early.ok, false);
  assert.match(early.error, /還要 30 秒/);
  assert.equal(G.takeHost({ ...r, hostLeftAt: 1000 }, 'x', new Set(['host']), 1e9).error, '主機還在線上');
  const ok = G.takeHost(gone, 'x', new Set(), 1000 + 60000);
  assert.equal(ok.ok, true);
  assert.equal(ok.room.hostClientId, 'x');
  assert.equal(ok.room.hostLeftAt, null);
  assert.equal(ok.room.game.log.at(-1).text, '主機換成另一支手機了。');
  assert.equal(L.claimHost({ ...fullRoom(), hostLeftAt: 1000 }, 'x', new Set(), 1001).ok, true, '大廳不用等');
});

test('直接重開：「請確認角色身分。」的序號接著上一局往上算，dealNo 加一（2026-10-22 瀏覽器實測：歸零會被舊台詞蓋掉）', async () => {
  const E = await import('../src/engine.js');
  const g = E.startGame(G.startDeal(fullRoom(), rand).room, 0, rand).room;
  const seq = g.game.narration.seq;
  const again = G.restart(g, rand).room;
  assert.equal(again.game.narration.seq, seq + 1);
  assert.equal(again.game.narration.text, '請確認角色身分。');
  assert.equal(again.dealNo, g.dealNo + 1);
  assert.equal(G.viewFor(again, new Set(), 'p1').dealNo, again.dealNo);
});

test('改板子：只改規則不動角色；改角色不動規則；送來的 preset 一律不理', () => {
  const r = fullRoom();
  const counts = r.setup.counts;
  assert.deepEqual(G.setSetup(r, { rules: { win: 'all' } }).room.setup.counts, counts);
  const c = G.setSetup(r, { counts: KING_GUARD, preset: 'lang-wang-qi-shi' }).room.setup;
  assert.deepEqual(c, { counts: KING_GUARD, rules: r.setup.rules });
});

test('直接重開（Leo 2026-10-11）：夜裡、白天、結束、發牌中都能按；座位板子不變、馬上重新發牌', async () => {
  const E = await import('../src/engine.js');
  const base = G.setSetup(fullRoom(), { counts: KING_GUARD }).room;
  const dealt = G.startDeal(base, rand).room;
  const night = E.startGame(dealt, 0, () => 0).room;
  for (const r of [dealt, night]) {
    const x = G.restart(r, rand);
    assert.equal(x.ok, true, x.error);
    assert.equal(x.room.phase, 'deal');
    assert.deepEqual(x.room.game.acked, {}, '大家要重新看身分');
    assert.equal(x.room.game.alive, undefined, '舊的對局資料清光');
    assert.deepEqual(x.room.seats, r.seats);
    assert.deepEqual(x.room.setup, r.setup);
    const tally = {};
    for (const id of Object.values(x.room.game.roles)) tally[id] = (tally[id] ?? 0) + 1;
    assert.deepEqual(tally, KING_GUARD);
  }
  assert.equal(G.restart(base, rand).ok, false, '大廳不用重開');
  assert.equal(G.restart({ ...night, phase: 'day' }, rand).ok, true);
  assert.equal(G.restart({ ...night, phase: 'ended' }, rand).ok, true);
});

test('回到設定：清掉身分、回大廳', () => {
  const r = G.backToSetup(G.startDeal(fullRoom(), rand).room).room;
  assert.equal(r.phase, 'lobby');
  assert.equal(r.game, undefined);
});

test('本局板子：依陣營分組、寫出狼人陣營總數（狼王也算），沒有的陣營不列', () => {
  assert.deepEqual(R.boardByTeam({ wolf: 2, king: 1, seer: 1, witch: 1, villager: 3 }), [
    { label: '狼人陣營 3 隻', text: '狼人 ×2、狼王' },
    { label: '神職', text: '預言家、女巫' },
    { label: '平民', text: '平民 ×3' },
  ]);
  assert.deepEqual(R.boardByTeam({ wolf: 1, seer: 1, hunter: 1, idiot: 1 }).map(x => x.label), ['狼人陣營 1 隻', '神職']);
});

test('發牌時主機唸「請確認角色身分。」；重新發牌再唸一次（序號變大）；開局後天黑請閉眼接著往上數', async () => {
  const E = await import('../src/engine.js');
  const { LINES } = await import('../public/shared/voice-lines.js');
  let r = G.startDeal(fullRoom(), rand).room;
  assert.deepEqual(r.game.narration, { seq: 1, text: '請確認角色身分。', clips: ['checkRole'] });
  assert.ok('checkRole' in LINES);
  assert.equal(G.viewFor(r, new Set(['host']), 'host').narration.text, '請確認角色身分。', '主機在發牌畫面收得到這句');
  r = G.redeal(r, rand).room;
  assert.equal(r.game.narration.seq, 2);
  r = E.startGame(r, 0, () => 0).room;
  assert.equal(r.game.narration.text, '天黑請閉眼。');
  assert.equal(r.game.narration.seq, 3);
  assert.equal(G.viewFor(r, new Set(), 'host').narration, undefined, '開局後只用 game.narration');
});
