// 真連線：投票全照手機（Leo 2026-10-28）＋警長獵人先開槍再選警徽＋全場紀錄寫誰投誰（警長 1.5 票）。
// 7 人房（狼×2、預言家、女巫、獵人、平民×2），走兩晚，約 1～2 分鐘：
//   第一天：主機登記獵人當警長＝唸「N 號玩家當選警長。昨晚死亡的是…」；主機送放逐被拒；A、B 互投平票 → 自動 PK →
//           PK 又平票 → 自動「平票，今天沒有人出局。天黑請閉眼。」；紀錄有第 1 輪、第 2 輪 PK 誰投誰
//   第二天：警長獵人昨晚被刀 → 手機先開槍（選警徽被擋）→ 開完才選警徽 → 移交；新警長投票紀錄寫「警長 1.5 票」
//   本機：先開 wrangler dev（port 8787），再 node scripts/e2e-vote.mjs
//   線上：WOLF_BASE=https://wolfwheel.jinliu-intake-worker.workers.dev node scripts/e2e-vote.mjs（測試房放著會自己清掉）
const BASE = process.env.WOLF_BASE ?? 'http://localhost:8787', WS = BASE.replace(/^http/, 'ws');
const N = 7;
const COUNTS = { wolf: 2, seer: 1, witch: 1, hunter: 1, villager: 2 };
const log = [], fails = [];
const check = (name, cond, extra = '') => { log.push(`${cond ? '✅' : '❌'} ${name}${extra ? '  — ' + extra : ''}`); if (!cond) fails.push(name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(pred, ms = 90000, what = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(100); }
  throw new Error('等太久：' + what);
}

const { code } = await fetch(`${BASE}/api/rooms`, { method: 'POST', body: JSON.stringify({ clientId: 'host', players: N }) }).then(r => r.json());
const clients = {};
const connect = (id, asHost = false) => new Promise(ok => {
  const ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
  const c = { id, ws, state: null, narr: [], errors: [] };
  ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello', clientId: id, asHost })); ok(c); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'error') { c.errors.push(m.error); return; }
    c.state = m;
    const t = m.game?.narration?.text;
    if (t && c.narr.at(-1) !== t) c.narr.push(t);
  };
  clients[id] = c;
});
const send = (id, msg) => clients[id].ws.send(JSON.stringify(msg));
const p = n => clients['p' + n];
const logText = () => host.state.game.log.map(e => e.text);

const host = await connect('host', true);
for (let n = 1; n <= N; n++) await connect('p' + n);
await sleep(300);
for (let n = 1; n <= N; n++) send('p' + n, { type: 'claimSeat', seat: n });
await sleep(300);
send('host', { type: 'setSetup', setup: { counts: COUNTS, rules: { police: true, fakeWaitMin: 3, fakeWaitMax: 3 } } });
await sleep(300);
send('host', { type: 'deal' });
await until(() => Object.values(clients).every(c => c.id === 'host' || c.state?.you?.role), 10000, '發牌');
const roleOf = {}; for (let n = 1; n <= N; n++) roleOf[n] = p(n).state.you.role;
const seatsOf = role => Object.keys(roleOf).map(Number).filter(s => roleOf[s] === role);
const [W1, W2] = seatsOf('wolf'), [V1, V2] = seatsOf('villager'), SEER = seatsOf('seer')[0], WITCH = seatsOf('witch')[0], HUNTER = seatsOf('hunter')[0];
for (let n = 1; n <= N; n++) send('p' + n, { type: 'ack' });
await sleep(300);
send('host', { type: 'start' });
await until(() => host.state?.phase === 'night', 10000, '開始');

// 跑一晚：狼刀 victim、女巫不用藥、預言家查 victim、獵人看手勢；上警那步主機按「大家都起立好了」
async function runNight(victim) {
  const handled = new Set();
  while (host.state.phase === 'night') {
    const g = host.state.game;
    if (g.night?.step === 'police' && g.night.eyesOpen && !handled.has('police' + g.dayNo)) { handled.add('police' + g.dayNo); send('host', { type: 'skip' }); }
    for (let n = 1; n <= N; n++) {
      const a = p(n).state?.you?.game?.action; if (!a) continue;
      const key = `${g.dayNo}:${g.night?.step}:${g.night?.beat}:${n}:${a.proposal ?? ''}:${a.checked ? 1 : 0}`;
      if (handled.has(key)) continue; handled.add(key);
      if (a.kind === 'wolf') send('p' + n, { type: 'act', payload: a.proposal == null ? { target: victim } : { confirm: true } });
      else if (a.kind === 'seer') send('p' + n, { type: 'act', payload: a.checked ? { done: true } : { target: victim } });
      else if (a.kind === 'witchSave') send('p' + n, { type: 'act', payload: { use: 'skip' } });
      else if (a.kind === 'witchPoison') send('p' + n, { type: 'act', payload: { use: 'none' } });
      else if (a.kind === 'hunter' || a.kind === 'king' || a.kind === 'grave') send('p' + n, { type: 'act', payload: { seen: true } });
    }
    await sleep(150);
  }
  await until(() => host.state.phase === 'day' || host.state.phase === 'ended', 30000, '天亮');
}
// 每個有票的人照 plan 投（沒寫的棄票）
async function voteRound(plan) {
  await until(() => host.state.game.vote?.open, 10000, '投票開始');
  const v = host.state.game.vote;
  for (const s of v.voters) send('p' + s, { type: 'vote', target: plan[s] ?? 0 });
  await until(() => host.state.game.vote?.round !== v.round || !host.state.game.vote?.open, 10000, '投完');
  await sleep(300);
}

// ── 第一天 ──
await runNight(V1);
check('第一天：天亮先只唸「天亮請睜眼。」', host.narr.at(-1) === '天亮請睜眼。', host.narr.at(-1));
send('host', { type: 'sheriff', seat: HUNTER });
await until(() => host.state.game.deathsPending === false, 10000, '登記警長');
check(`主機登記警長＝唸「${HUNTER} 號玩家當選警長。昨晚死亡的是 ${V1} 號。」`, host.narr.at(-1) === `${HUNTER} 號玩家當選警長。昨晚死亡的是 ${V1} 號。`, host.narr.at(-1));
const e0 = host.errors.length;
send('host', { type: 'exile', target: W1 });
await until(() => host.errors.length > e0, 5000, '放逐被拒');
check('主機送放逐（舊網頁）被伺服器拒絕', /主機不能登記/.test(host.errors.at(-1)) && host.state.game.alive[W1] === true, host.errors.at(-1));
send('host', { type: 'startVote', pk: true });
await until(() => host.state.game.vote?.open, 5000, '開始投票');
check('主機送 pk:true 也只會開第一輪', host.state.game.vote.pk === false && host.narr.at(-1) === '請大家進行投票。');
const [A, B] = [V2, SEER];
await voteRound({ [A]: B, [B]: A });
const pk = host.state.game.vote;
check(`平票自動 PK：唸「${Math.min(A, B)} 號、${Math.max(A, B)} 號平票，請其他玩家進行投票。」`, host.narr.at(-1) === `${Math.min(A, B)} 號、${Math.max(A, B)} 號平票，請其他玩家進行投票。`, host.narr.at(-1));
check('PK：平票的人不投，其他活人投', pk.open && pk.pk && !pk.voters.includes(A) && !pk.voters.includes(B) && pk.voters.length === 4, JSON.stringify(pk.voters));
check('PK 中每支手機看得到上一輪統計', pk.prev?.top?.length === 2);
const [c1, c2] = pk.voters.filter(s => s !== HUNTER);
await voteRound({ [c1]: A, [c2]: B });
check('PK 又平票＝自動「平票，今天沒有人出局。天黑請閉眼。」', host.narr.at(-1) === '平票，今天沒有人出局。天黑請閉眼。' && host.state.game.nightCalled === true, host.narr.at(-1));
const L1 = logText().find(t => t.startsWith('第 1 輪投票統計：')), L2 = logText().find(t => t.startsWith('第 2 輪 PK 投票統計：'));
const R1 = host.state.game.log.find(e => e.vote?.round === 1);
check('紀錄：第 1 輪統計（警長寫 1.5 票），帶統計表資料', Boolean(L1) && L1.includes(`${B} 號 1 票 ← ${A} 號`) && L1.includes(`${HUNTER} 號（警長 1.5 票）`) && R1?.vote.rows.length === 2, L1);
check('紀錄：第 2 輪 PK 統計', Boolean(L2) && L2.includes(`${A} 號 1 票 ← ${c1} 號`) && L2.includes('平票'), L2);
check('每支玩家手機的紀錄跟主機一樣', p(W1).state.game.log.length === host.state.game.log.length);
send('host', { type: 'nextNight' });
await until(() => host.state.phase === 'night', 10000, '進入黑夜');

// ── 第二天：警長獵人昨晚被刀 → 先開槍、再選警徽 ──
await runNight(HUNTER);
await until(() => p(HUNTER).state?.you?.game?.canShoot, 10000, '獵人能開槍');
check('警長獵人出局：手機先出現開槍、還沒有選警徽', p(HUNTER).state.you.game.canShoot === true && !p(HUNTER).state.you.game.passBadge);
const e1 = p(HUNTER).errors.length;
send('p' + HUNTER, { type: 'passBadge', target: SEER });
await until(() => p(HUNTER).errors.length > e1, 5000, '選警徽被擋');
check('還沒開槍就選警徽：伺服器擋', /先發動技能/.test(p(HUNTER).errors.at(-1)), p(HUNTER).errors.at(-1));
send('p' + HUNTER, { type: 'shoot', target: W1 });
await until(() => p(HUNTER).state.you.game.passBadge, 10000, '開完槍出現選警徽');
await until(() => host.state.game.alive[W1] === false, 5000, '主機收到開槍結果'); // 每支手機各自收廣播，主機那份可能晚幾毫秒
check(`開槍帶走 ${W1} 號後才出現選警徽`, host.state.game.alive[W1] === false && p(HUNTER).state.game.alive[W1] === false);
send('p' + HUNTER, { type: 'passBadge', target: SEER });
await until(() => host.state.game.sheriff === SEER && !host.state.game.badgePending, 10000, '移交警徽');
check(`警徽移交給 ${SEER} 號：主機唸「警徽移交給 ${SEER} 號。」、紀錄寫一行`, logText().includes(`${HUNTER} 號警長把警徽移交給 ${SEER} 號。`) && host.narr.at(-1) === `警徽移交給 ${SEER} 號。`, host.narr.at(-1));
send('host', { type: 'startVote' });
const alive = Object.keys(host.state.game.alive).map(Number).filter(s => host.state.game.alive[s]);
await voteRound(Object.fromEntries(alive.filter(s => s !== W2).map(s => [s, W2])));
const L3 = logText().find(t => t.startsWith('第 1 輪投票統計：') && t !== L1);
check(`新警長那票：紀錄寫「${W2} 號 … ← … ${SEER} 號（警長 1.5 票）」`, Boolean(L3) && L3.startsWith(`第 1 輪投票統計：${W2} 號`) && L3.includes(`${SEER} 號（警長 1.5 票）`), L3);
check('最後一隻狼被票走：遊戲結束、好人勝', host.state.phase === 'ended' && host.state.game.winner === 'good');

for (const c of Object.values(clients)) c.ws.close();
console.log(log.join('\n'));
console.log(`\n${log.filter(l => l.startsWith('✅')).length}／${log.filter(l => /^[✅❌]/.test(l)).length} 通過`);
process.exit(fails.length ? 1 : 0);
