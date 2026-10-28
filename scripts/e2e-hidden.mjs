// 真連線：開一局 7 人（狼、隱狼、預言家、女巫、平民×3），照 Leo 2026-10-28 隱狼規則走兩晚，約 1.5 分鐘。
//   本機：先開 wrangler dev（LeoPersonal 的 launch.json「wolfwheel」，port 8787），再 node scripts/e2e-hidden.mjs
//   線上：WOLF_BASE=https://wolfwheel.jinliu-intake-worker.workers.dev node scripts/e2e-hidden.mjs（會開一間測試房，放著會自己清掉）
const BASE = process.env.WOLF_BASE ?? 'http://localhost:8787', WS = BASE.replace(/^http/, 'ws');
const N = 7;
const COUNTS = { wolf: 1, hidden: 1, seer: 1, witch: 1, villager: 3 };
const log = [], fails = [];
const check = (name, cond, extra = '') => { log.push(`${cond ? '✅' : '❌'} ${name}${extra ? '  — ' + extra : ''}`); if (!cond) fails.push(name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const { code } = await fetch(`${BASE}/api/rooms`, { method: 'POST', body: JSON.stringify({ clientId: 'host', players: N }) }).then(r => r.json());
const clients = {};
function connect(id, asHost = false) {
  return new Promise(ok => {
    const ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
    const c = { id, ws, state: null, errors: [], narr: [] };
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello', clientId: id, asHost })); ok(c); };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.type === 'error') { c.errors.push(m.error); return; }
      c.state = m;
      const t = m.game?.narration?.text;
      if (t && c.narr.at(-1) !== `${m.game.narration.seq}:${t}`) c.narr.push(`${m.game.narration.seq}:${t}`);
    };
    clients[id] = c;
  });
}
const send = (id, msg) => clients[id].ws.send(JSON.stringify(msg));
async function until(pred, ms = 90000, what = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(100); }
  throw new Error('等太久：' + what);
}
const host = await connect('host', true);
for (let n = 1; n <= N; n++) { await connect('p' + n); }
await sleep(300);
for (let n = 1; n <= N; n++) send('p' + n, { type: 'claimSeat', seat: n });
await sleep(300);
send('host', { type: 'setSetup', setup: { counts: COUNTS, rules: { police: false, fakeWaitMin: 3, fakeWaitMax: 3 } } });
await sleep(300);
send('host', { type: 'deal' });
await until(() => Object.values(clients).every(c => c.id === 'host' || c.state?.you?.role), 10000, '發牌');
const roleOf = {}; for (let n = 1; n <= N; n++) roleOf[n] = clients['p' + n].state.you.role;
const seatOf = role => Number(Object.keys(roleOf).find(s => roleOf[s] === role));
const W = seatOf('wolf'), H = seatOf('hidden'), SEER = seatOf('seer'), WITCH = seatOf('witch');
const villagers = Object.keys(roleOf).map(Number).filter(s => roleOf[s] === 'villager');
log.push(`座位：狼 ${W}、隱狼 ${H}、預言家 ${SEER}、女巫 ${WITCH}、平民 ${villagers.join(',')}`);
for (let n = 1; n <= N; n++) send('p' + n, { type: 'ack' });
await sleep(300);
send('host', { type: 'start' });

const pub = () => host.state?.game;
const me = n => clients['p' + n].state?.you?.game;
let sawHiddenFake = false, seerTarget = null, hiddenAction = null, hiddenRepeat = 0;
// 夜裡自動操作（狼、隱狼刀的人由 plan 決定）
async function runNight(plan) {
  const handled = new Set();
  while (pub()?.night || host.state?.phase === 'night') {
    if (host.state.phase !== 'night') break;
    const g = pub();
    for (let n = 1; n <= N; n++) {
      const a = me(n)?.action; if (!a) continue;
      const key = `${g.night.step}:${g.night.beat}:${n}:${JSON.stringify(a.votes ?? '')}:${a.proposal ?? ''}:${a.checked ? 1 : 0}`;
      if (handled.has(key)) continue; handled.add(key);
      if (a.kind === 'wolf') {
        if (g.night.step === 'hidden') hiddenAction = a;
        if (a.proposal === null || a.proposal === undefined) send('p' + n, { type: 'act', payload: { target: plan.kill } });
        else send('p' + n, { type: 'act', payload: { confirm: true } });
      } else if (a.kind === 'seer') {
        if (!a.checked) send('p' + n, { type: 'act', payload: { target: plan.seer } }); else send('p' + n, { type: 'act', payload: { done: true } });
      } else if (a.kind === 'witchSave') { plan.victimSeen = a.victim; send('p' + n, { type: 'act', payload: { use: 'skip' } }); }
      else if (a.kind === 'witchPoison') send('p' + n, { type: 'act', payload: { use: 'none' } });
    }
    if (g.night.step === 'hidden' && g.night.eyesOpen && me(H)?.action?.kind === 'hiddenMates' && me(H).wolves.some(w => w.seat === W)) sawHiddenFake = true;
    await sleep(150);
  }
}

// 第一晚：狼刀平民 1；隱狼那步應該假等、隱狼手機沒動作
const plan1 = { kill: villagers[0], seer: H };
await until(() => host.state?.phase === 'night', 10000, '開始');
await runNight(plan1);
await until(() => host.state.phase === 'day', 90000, '天亮');
const n1 = host.narr.map(x => x.split(':').slice(1).join(':'));
check('第一晚有唸「隱狼請睜眼」「隱狼請閉眼」', n1.includes('隱狼請睜眼。') && n1.includes('隱狼請閉眼。'));
check(`第一晚隱狼那步：其他狼還活著 → 隱狼手機只顯示狼同伴（看得到狼人 ${W} 號），不能刀`, sawHiddenFake);
check('第一晚「隱狼請睜眼」只唸一次（假等不重唸）', n1.filter(t => t === '隱狼請睜眼。').length === 1, n1.join(' / '));
check('狼人刀成功', pub().alive[villagers[0]] === false);
check('預言家查隱狼＝好人（其他狼還活著）', me(SEER).seerChecks.at(-1)?.wolf === false);
const before = clients['p' + H].errors.length;
send('p' + H, { type: 'boom', target: 0 });
await sleep(500);
check('白天隱狼自爆被擋', clients['p' + H].errors.length > before, clients['p' + H].errors.at(-1));
check('隱狼手機沒有自爆鈕', !me(H).canBoom);

// 白天放逐狼人 → 只剩隱狼
send('host', { type: 'exile', target: W });
await until(() => pub().alive[W] === false, 5000, '放逐狼人');
host.narr.length = 0;
send('host', { type: 'nextNight' });
await until(() => host.state.phase === 'night', 5000, '進入黑夜');
// 第二晚：讓隱狼那步先等一次重唸（25 秒），再刀
const plan2 = { kill: villagers[1], seer: H };
const t0 = Date.now();
await until(() => pub().night?.step === 'hidden' && me(H)?.action, 90000, '隱狼那步');
const a2 = me(H).action;
check('只剩隱狼：隱狼手機出現刀人（文字提示）', a2.kind === 'wolf' && a2.hiddenAlone === true);
await sleep(26000); // 等重唸
const n2a = host.narr.map(x => x.split(':').slice(1).join(':'));
check('太久沒刀：重唸「隱狼請睜眼」', n2a.filter(t => t === '隱狼請睜眼。').length >= 2, n2a.join(' / '));
check('主機沒唸「要擊殺的目標」', !n2a.some(t => t.includes('隱狼') && t.includes('擊殺')));
await runNight(plan2);
await until(() => host.state.phase === 'day' || host.state.phase === 'ended', 90000, '第二天天亮');
const n2 = host.narr.map(x => x.split(':').slice(1).join(':'));
check('刀完唸「隱狼請閉眼」', n2.includes('隱狼請閉眼。'));
check('女巫看得到隱狼刀的人', plan2.victimSeen === villagers[1], `victim=${plan2.victimSeen}`);
check('接手後預言家查隱狼＝狼人', me(SEER).seerChecks.at(-1)?.wolf === true, JSON.stringify(me(SEER).seerChecks));
check('隱狼刀成功', pub().alive[villagers[1]] === false);
console.log(log.join('\n'));
console.log(`\n第二晚主機台詞：${n2.join(' / ')}`);
console.log(`\n${log.filter(x => x.startsWith('✅')).length}／${log.filter(x => /^[✅❌]/.test(x)).length} 通過`);
for (const c of Object.values(clients)) c.ws.close();
process.exit(fails.length ? 1 : 0);
