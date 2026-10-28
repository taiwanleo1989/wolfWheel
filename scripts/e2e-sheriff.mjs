// 真連線：第一天有上警，主機登記警長＝唸「N 號當選警長。」接著昨晚死訊；沒人當選按「警徽流失」＝直接唸死訊（Leo 2026-10-28）。
// 開兩間 6 人房（狼、預言家、女巫、平民×3），各走第一晚，約 1 分鐘。
//   本機：先開 wrangler dev（port 8787），再 node scripts/e2e-sheriff.mjs
//   線上：WOLF_BASE=https://wolfwheel.jinliu-intake-worker.workers.dev node scripts/e2e-sheriff.mjs（測試房放著會自己清掉）
const BASE = process.env.WOLF_BASE ?? 'http://localhost:8787', WS = BASE.replace(/^http/, 'ws');
const N = 6;
const COUNTS = { wolf: 1, seer: 1, witch: 1, villager: 3 };
const log = [], fails = [];
const check = (name, cond, extra = '') => { log.push(`${cond ? '✅' : '❌'} ${name}${extra ? '  — ' + extra : ''}`); if (!cond) fails.push(name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(pred, ms = 90000, what = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(100); }
  throw new Error('等太久：' + what);
}

async function room(mode) {
  const { code } = await fetch(`${BASE}/api/rooms`, { method: 'POST', body: JSON.stringify({ clientId: 'host', players: N }) }).then(r => r.json());
  const clients = {};
  const connect = (id, asHost = false) => new Promise(ok => {
    const ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
    const c = { id, ws, state: null, narr: [] };
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello', clientId: id, asHost })); ok(c); };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.type === 'error') return;
      c.state = m;
      const t = m.game?.narration?.text;
      if (t && c.narr.at(-1) !== t) c.narr.push(t);
    };
    clients[id] = c;
  });
  const send = (id, msg) => clients[id].ws.send(JSON.stringify(msg));
  const host = await connect('host', true);
  for (let n = 1; n <= N; n++) await connect('p' + n);
  await sleep(300);
  for (let n = 1; n <= N; n++) send('p' + n, { type: 'claimSeat', seat: n });
  await sleep(300);
  send('host', { type: 'setSetup', setup: { counts: COUNTS, rules: { police: true, fakeWaitMin: 3, fakeWaitMax: 3 } } });
  await sleep(300);
  send('host', { type: 'deal' });
  await until(() => Object.values(clients).every(c => c.id === 'host' || c.state?.you?.role), 10000, '發牌');
  const roleOf = {}; for (let n = 1; n <= N; n++) roleOf[n] = clients['p' + n].state.you.role;
  const villagers = Object.keys(roleOf).map(Number).filter(s => roleOf[s] === 'villager');
  const SEER = Number(Object.keys(roleOf).find(s => roleOf[s] === 'seer'));
  const victim = villagers[0];
  for (let n = 1; n <= N; n++) send('p' + n, { type: 'ack' });
  await sleep(300);
  send('host', { type: 'start' });
  await until(() => host.state?.phase === 'night', 10000, '開始');
  // 夜裡：狼刀平民、女巫不用藥、預言家隨便查；上警那步主機按「大家都起立好了」
  const handled = new Set();
  while (host.state.phase === 'night') {
    const g = host.state.game;
    if (g.night?.step === 'police' && g.night.eyesOpen && !handled.has('police')) { handled.add('police'); send('host', { type: 'skip' }); }
    for (let n = 1; n <= N; n++) {
      const a = clients['p' + n].state?.you?.game?.action; if (!a) continue;
      const key = `${g.night?.step}:${g.night?.beat}:${n}:${a.proposal ?? ''}:${a.checked ? 1 : 0}`;
      if (handled.has(key)) continue; handled.add(key);
      if (a.kind === 'wolf') send('p' + n, { type: 'act', payload: a.proposal == null ? { target: victim } : { confirm: true } });
      else if (a.kind === 'seer') send('p' + n, { type: 'act', payload: a.checked ? { done: true } : { target: victim } });
      else if (a.kind === 'witchSave') send('p' + n, { type: 'act', payload: { use: 'skip' } });
      else if (a.kind === 'witchPoison') send('p' + n, { type: 'act', payload: { use: 'none' } });
    }
    await sleep(150);
  }
  await until(() => host.state.phase === 'day', 30000, '天亮');
  const tag = mode === 'sheriff' ? '登記警長' : '警徽流失';
  check(`${tag}：天亮先只唸「天亮請睜眼。」、死訊還沒公布`, host.narr.at(-1) === '天亮請睜眼。' && host.state.game.deathsPending === true, host.narr.at(-1));
  const n0 = host.narr.length;
  send('host', mode === 'sheriff' ? { type: 'sheriff', seat: SEER } : { type: 'tearBadge' });
  await until(() => host.narr.length > n0, 10000, tag);
  const want = mode === 'sheriff' ? `${SEER} 號當選警長。昨晚死亡的是 ${victim} 號。` : `昨晚死亡的是 ${victim} 號。`;
  check(`${tag}：主機一按就唸「${want}」`, host.narr.at(-1) === want, host.narr.at(-1));
  check(`${tag}：死訊已公布、${victim} 號出局`, host.state.game.deathsPending === false && host.state.game.alive[victim] === false);
  if (mode === 'sheriff') check('警長登記成功', host.state.game.sheriff === SEER);
  for (const c of Object.values(clients)) c.ws.close();
}

try {
  await room('sheriff');
  await room('tear');
} catch (e) { fails.push(e.message); log.push('❌ ' + e.message); }
console.log(log.join('\n'));
console.log(`\n${log.filter(l => l.startsWith('✅')).length}／${log.filter(l => /^[✅❌]/.test(l)).length} 通過`);
process.exit(fails.length ? 1 : 0);
