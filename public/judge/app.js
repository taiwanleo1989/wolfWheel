// 法官工具：M1 開房／加入／座位／重連，M2 設定板子／發牌／看身分
import { ROLES, ROLE_ORDER, TEAM_NAME, totalOf } from '../shared/roles.js';
import { installArt, portrait } from '../shared/art.js';
import { renderGame, bindGame, seatRequestsHTML, approveFromClick } from './game-ui.js';
import { voice } from './voice.js';

installArt();
const $ = s => document.querySelector(s);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 這支手機的固定識別碼（不是遊戲身分）：重新整理、重開網頁都認得回原座位
const clientId = store.get('ww-cid') || (() => {
  const id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  store.set('ww-cid', id);
  return id;
})();

let session = null;   // { code, asHost }
try { session = JSON.parse(store.get('ww-judge') || 'null'); } catch {}
let ws = null, state = null, retry = 0, leaving = false, pingTimer = 0, pongTimer = 0, retryTimer = 0;
const ui = { warned: false, picking: false, revealed: false, lastRole: null, wasHost: false };

/* ───────── 小工具 ───────── */
// 內容沒變就不重畫：大家同時按按鈕時，畫面一直被換掉會吃掉別人的點擊
function setHTML(el, html) { if (el._html !== html) { el.innerHTML = html; el._html = html; } }
function show(id) { for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id; }
let toastTimer = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200); }
function setStatus(kind, text) {
  const s = $('#status');
  s.hidden = kind === 'none';
  s.className = 'status ' + (kind === 'online' ? 'online' : kind === 'bad' ? 'bad' : '');
  s.textContent = text || '';
}
function boardSummary(counts) {
  return ROLE_ORDER.filter(id => counts[id]).map(id => (counts[id] > 1 ? `${counts[id]} ${ROLES[id].name}` : ROLES[id].name)).join('、');
}
function rulesSummary(r) {
  const witch = { never: '女巫不能自救', first: '女巫只有第一晚能自救', always: '女巫每晚都能自救' }[r.witchSelfSave];
  return `${witch}；${r.win === 'side' ? '屠邊' : '屠城'}；${r.police === false ? '不上警' : '第一晚上警'}`;
}

/* ───────── 座位格 ───────── */
function seatHTML(seat, tag) {
  const cls = 'seat' + (seat.taken ? ' taken' : '') + (seat.taken && !seat.online ? ' offline' : '') + (seat.mine ? ' mine' : '');
  const label = `${seat.n} 號${seat.mine ? '（你）' : seat.taken ? (seat.online ? '（有人）' : '（離線）') : '（空位）'}`;
  return `<button type="button" class="${cls}" data-seat="${seat.n}" aria-label="${label}"><span class="n">${seat.n}</span>${tag ? `<span class="tag">${tag}</span>` : ''}</button>`;
}
function seatTag(seat) {
  return seat.mine ? '你' : seat.host ? '主機' : seat.taken && !seat.online ? '離線' : '';
}

/* ───────── 角色卡（先蓋著，點了才翻開） ───────── */
function renderRoleCard(box) {
  const id = state.you.role, r = ROLES[id];
  const acked = (state.acked || []).includes(state.you.seat);
  if (!ui.revealed) {
    setHTML(box, `<button type="button" class="card-cover" data-reveal>
        <span class="card-back"><span>?</span></span>
        <b>點一下看你的身分</b><small>先確定旁邊的人看不到你的螢幕</small>
      </button>${acked ? '<p class="acked-note">✓ 你已經確認過身分</p>' : ''}`);
  } else {
    setHTML(box, `<div class="role-card team-${r.team}">
        <div class="art">${portrait(id)}</div>
        <div class="role-name">${esc(r.name)}</div>
        <div class="team-tag">${esc(TEAM_NAME[r.team])}</div>
        <p class="role-desc">${esc(r.desc)}</p>
      </div>
      <button class="btn primary big" type="button" data-hide>${acked ? '蓋起來' : '我看好了'}</button>`);
  }
  box.onclick = e => {
    if (e.target.closest('[data-reveal]')) { ui.revealed = true; render(); }
    else if (e.target.closest('[data-hide]')) { if (!acked) send({ type: 'ack' }); ui.revealed = false; render(); }
  };
}

/* ───────── 主機：板子與規則 ───────── */
function seg(sel, opts, cur, onPick) {
  const box = $(sel);
  setHTML(box, opts.map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${t}</button>`).join(''));
  box.onclick = e => { const b = e.target.closest('[data-v]'); if (b && b.dataset.v !== cur) onPick(b.dataset.v); };
}
const sendSetup = setup => send({ type: 'setSetup', setup });

function renderSetup() {
  const s = state.setup;
  // 依陣營分三組（狼／神／民）：可以有很多個的角色用 ＋／−，只能有一個的角色點一下加入或拿掉
  const teamCount = team => ROLE_ORDER.filter(id => ROLES[id].team === team).reduce((a, id) => a + (s.counts[id] ?? 0), 0);
  const FACTIONS = [['wolf', '狼人陣營'], ['god', '神職'], ['villager', '平民']];
  setHTML($('#roleRows'), FACTIONS.map(([team, title]) => {
    const ids = ROLE_ORDER.filter(id => ROLES[id].team === team);
    const many = ids.filter(id => !ROLES[id].unique), single = ids.filter(id => ROLES[id].unique);
    return `<div class="faction f-${team}">
      <div class="fhead"><b>${title}</b><span>共 <b class="digits">${teamCount(team)}</b> 人</span></div>
      ${many.map(id => {
        const n = s.counts[id] ?? 0, r = ROLES[id];
        return `<div class="role-row on">
          <div class="thumb">${portrait(id)}</div>
          <div class="rname"><b>${r.name}</b><small>${id === 'wolf' ? '普通狼人，可以有很多隻' : '沒有技能'}</small></div>
          <div class="stepper sm">
            <button type="button" data-role="${id}" data-d="-1" aria-label="${r.name}少一個"${n === 0 ? ' disabled' : ''}>−</button>
            <span class="digits">${n}</span>
            <button type="button" data-role="${id}" data-d="1" aria-label="${r.name}多一個">+</button>
          </div></div>`;
      }).join('')}
      ${single.length ? `<p class="hint small">${team === 'wolf' ? '特殊狼（點一下加入／拿掉）' : '點選這局要放的神'}</p>
        <div class="toggles">${single.map(id => {
          const on = (s.counts[id] ?? 0) > 0;
          return `<button type="button" class="toggle${on ? ' on' : ''}" data-toggle="${id}" aria-pressed="${on}">
            <span class="thumb">${portrait(id)}</span><b>${ROLES[id].name}</b><span class="tick">${on ? '✓' : '＋'}</span></button>`;
        }).join('')}</div>` : ''}
    </div>`;
  }).join(''));
  const total = totalOf(s.counts);
  const tot = $('#boardTotal');
  tot.textContent = `狼 ${teamCount('wolf')}｜神 ${teamCount('god')}｜民 ${teamCount('villager')} ＝ ${total}／座位 ${state.players}`;
  tot.className = total === state.players ? 'ok' : 'bad';

  seg('#ruleWitch', [['never', '都不能'], ['first', '只有第一晚'], ['always', '每晚都能']], s.rules.witchSelfSave, v => sendSetup({ rules: { witchSelfSave: v } }));
  seg('#ruleWin', [['side', '屠邊'], ['all', '屠城']], s.rules.win, v => sendSetup({ rules: { win: v } }));
  $('#ruleWinHint').textContent = s.rules.win === 'side' ? '狼人殺光所有神職，或殺光所有平民，狼人就贏。' : '所有好人都死光，狼人才贏。';
  const police = s.rules.police !== false;
  seg('#rulePolice', [['on', '有'], ['off', '沒有']], police ? 'on' : 'off', v => sendSetup({ rules: { police: v === 'on' } }));
  $('#rulePoliceHint').textContent = police
    ? '第一晚最後唸「要上警的玩家請起立」；天亮後先選警長，主機登記完就唸「N 號當選警長」，接著公布昨晚死訊。'
    : '第一晚唸完直接天亮，死訊馬上公布。';
  $('#waitMin').textContent = s.rules.fakeWaitMin;
  $('#waitMax').textContent = s.rules.fakeWaitMax;

  setHTML($('#blockers'), state.blockers.map(b => `<li>${esc(b)}</li>`).join(''));
  $('#dealBtn').disabled = state.blockers.length > 0;
}

function renderDealHost() {
  const acked = new Set(state.acked || []);
  $('#ackNum').textContent = acked.size;
  $('#ackTotal').textContent = state.players;
  setHTML($('#ackSeats'), state.seats.map(s => {
    const cls = 'seat taken' + (acked.has(s.n) ? ' acked' : '') + (s.online ? '' : ' offline');
    const tag = acked.has(s.n) ? '✓' : s.online ? '' : '離線';
    return `<div class="${cls}"><span class="n">${s.n}</span>${tag ? `<span class="tag">${tag}</span>` : ''}</div>`;
  }).join(''));
  const box = $('#hostMyRole');
  box.hidden = !state.you.role;
  if (state.you.role) renderRoleCard(box);
  const req = $('#dealRequests');
  req.hidden = !state.seatRequests?.length;
  setHTML(req, seatRequestsHTML(state.seatRequests));
}

/* ───────── 畫面總指揮 ───────── */
function render() {
  if (!state) return;
  // session.asHost＝「這支手機是主機」，重連時會自動要回主機：只在真的當上主機時記，不是主機了就拿掉（2026-10-23 審查：
  // 接手太早被拒還留著，跳出誤導的提示、之後每次重連都自動搶主機）
  if (session.asHost && !state.you.isHost) {
    if (!ui.warned) { ui.warned = true; toast('這個房間已經有主機了，你以玩家身分加入'); }
    session.asHost = false; store.set('ww-judge', JSON.stringify(session));
  } else if (state.you.isHost && !session.asHost) { session.asHost = true; store.set('ww-judge', JSON.stringify(session)); }
  if (state.you.role !== ui.lastRole) { ui.lastRole = state.you.role; ui.revealed = false; } // 重新發牌就重新蓋牌
  if (state.dealNo !== ui.dealNo) { ui.dealNo = state.dealNo; ui.revealed = false; } // 新局抽到同一個角色也要重新蓋牌（2026-10-23 審查）
  if (state.you.isHost && !ui.wasHost) voice.resync(); // 剛接手（或拿回）主機：從下一句開始唸
  ui.wasHost = state.you.isHost;
  const lobby = state.phase === 'lobby';

  // 對局中（黑夜／白天／結束）：大家共用對局畫面；主機負責出聲
  if (state.game) {
    show('game');
    if (state.you.isHost) {
      voice.onNarration(state.game.narration);
      voice.setNight(state.phase === 'night');
    } else voice.setNight(false); // 原本是主機、被別支手機接手後變成玩家：背景音樂要停（2026-10-22 驗測）
    renderGame({ state, $, setHTML, esc, send, toast, voice, render, takeHost });
    return;
  }
  document.body.classList.remove('is-night');
  voice.setNight(false); // 夜裡直接重開回到這裡：背景音樂要停（不是主機的手機沒在播，呼叫也沒事）

  if (state.you.isHost) {
    show('host');
    $('#hostCode').textContent = state.code;
    $('#hostLobby').hidden = !lobby;
    $('#hostDeal').hidden = lobby;
    if (lobby) {
      $('#playersNum').textContent = state.players;
      $('#seatCount').textContent = `${state.seats.filter(s => s.taken).length}／${state.players} 人`;
      setHTML($('#hostSeats'), state.seats.map(s => seatHTML(s, seatTag(s))).join(''));
      renderSetup();
    } else {
      voice.onNarration(state.narration); // 「請確認角色身分。」
      renderDealHost();
    }
    drawQR();
    return;
  }

  show('player');
  $('#playerCode').textContent = state.code;
  const mine = state.you.seat;
  const picking = !mine || (lobby && ui.picking);
  $('#pickSeat').hidden = !picking;
  $('#mySeat').hidden = picking;
  $('#changeSeat').hidden = !lobby;
  if (mine) $('#myNum').textContent = mine;
  // 發牌後換手機：點原本（離線）的號碼＝申請接手，主機按同意才接回（Leo 2026-10-22 A1）
  const note = $('#seatReqNote');
  note.hidden = lobby || Boolean(mine);
  note.textContent = state.you.requestedSeat ? `已申請接手 ${state.you.requestedSeat} 號，請主機按同意。`
    : '已經發牌了：換手機的話，點你原本的號碼（顯示「離線」的），主機按同意後就接回來。';
  $('#hostGone').hidden = state.hostOnline;
  setHTML($('#playerSeats'), state.seats.map(s => seatHTML(s, seatTag(s))).join(''));
  const acked = (state.acked || []).includes(mine);
  $('#waitText').textContent = lobby ? '等待主機發牌…' : acked ? '等其他人看完身分…' : '看一下你的身分 ↓';
  const roleBox = $('#myRole');
  roleBox.hidden = lobby || !state.you.role;
  if (!roleBox.hidden) renderRoleCard(roleBox);
  $('#boardInfo').hidden = !mine;
  $('#boardLine').textContent = boardSummary(state.setup.counts);
  $('#rulesLine').textContent = rulesSummary(state.setup.rules);
}

let qrFor = '';
function drawQR() {
  const url = `${location.origin}/judge/?room=${state.code}`;
  if (qrFor === url || typeof qrcode !== 'function') return;
  qrFor = url;
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  $('#qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

/* ───────── 連線 ───────── */
function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); else toast('還在連線中，請稍等'); }

function connect() {
  clearTimeout(retryTimer);
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  leaving = false;
  setStatus('wait', retry ? `重新連線中…（第 ${retry} 次）` : '連線中…');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/api/rooms/${session.code}/ws`);
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    setStatus('online', '● 已連線');
    setTimeout(() => { if (ws === sock && sock.readyState === WebSocket.OPEN) setStatus('none'); }, 1500);
    sock.send(JSON.stringify({ type: 'hello', clientId, asHost: Boolean(session.asHost) }));
    startPing(sock);
  };
  sock.onmessage = e => {
    if (e.data === 'pong') { clearTimeout(pongTimer); return; }
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'state') { state = m; render(); }
    else if (m.type === 'error') { toast(m.error); if (state?.you?.isHost) voice.release(); } // 例如重開失敗：別再擋著台詞
  };
  sock.onclose = async e => {
    stopPing();
    if (ws !== sock || leaving) return;
    if (e.code === 4001) { setStatus('bad', '這支手機在別的分頁開了房間'); return; }
    if (retry >= 2) {   // 連不上兩次以上：確認房間還在不在
      const info = await fetch(`/api/rooms/${session.code}`).then(r => r.json()).catch(() => null);
      if (info && !info.exists) { roomGone(); return; }
    }
    retry++;
    setStatus('bad', `連線中斷，重新連線中…（第 ${retry} 次）`);
    retryTimer = setTimeout(connect, Math.min(10000, 800 * 2 ** (retry - 1)));
  };
}

// 每 20 秒確認連線還活著；8 秒沒回應就當斷線、重連
function startPing(sock) {
  stopPing();
  pingTimer = setInterval(() => {
    if (sock.readyState !== WebSocket.OPEN) return;
    sock.send('ping');
    clearTimeout(pongTimer);
    pongTimer = setTimeout(() => { try { sock.close(); } catch {} }, 8000);
  }, 20000);
}
function stopPing() { clearInterval(pingTimer); clearTimeout(pongTimer); }
function roomGone() { toast(`房間 ${session.code} 已經關閉了`); leave(); }

/* ───────── 螢幕保持亮著（螢幕一關，連線就斷） ───────── */
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !session) return;
  keepAwake();
  voice.wake();
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) { retry = 0; connect(); }
});

/* ───────── 進出房間 ───────── */
function enter(code, asHost) {
  session = { code, asHost };
  store.set('ww-judge', JSON.stringify(session));
  history.replaceState(null, '', `?room=${code}`);
  state = null; ui.warned = false; ui.picking = false; ui.revealed = false; ui.lastRole = null; qrFor = '';
  $('#hostCode').textContent = code; $('#playerCode').textContent = code;
  show(asHost ? 'host' : 'player');
  retry = 0;
  connect();
  keepAwake();
}

function leave() {
  leaving = true;
  stopPing();
  clearTimeout(retryTimer);
  try { ws && ws.close(1000); } catch {}
  ws = null; state = null; session = null;
  store.del('ww-judge');
  history.replaceState(null, '', location.pathname);
  setStatus('none');
  $('#resume').hidden = true;
  show('home');
}

async function createRoom() {
  const btn = $('#createBtn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, players: 12 }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || '開房失敗');
    enter(data.code, true);
  } catch (e) { toast(e.message || '開房失敗，請檢查網路'); }
  finally { btn.disabled = false; }
}

async function joinRoom(code) {
  code = String(code).trim();
  if (!/^\d{4}$/.test(code)) { toast('房號是 4 位數字'); return; }
  try {
    const info = await fetch(`/api/rooms/${code}`).then(r => r.json());
    if (!info.exists) { toast(`找不到房間 ${code}，請確認房號`); return; }
    const again = session && session.code === code;
    enter(code, again ? session.asHost : false);
  } catch {
    // 網路閃斷：本來就在這個房間的手機直接進去，交給自動重連；新加入的才請他檢查網路
    if (session && session.code === code) enter(code, session.asHost);
    else toast('連不上伺服器，請檢查網路');
  }
}

/* ───────── 綁定 ───────── */
$('#createBtn').onclick = createRoom;
$('#joinForm').addEventListener('submit', e => { e.preventDefault(); joinRoom($('#joinCode').value); });
$('#joinCode').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
$('#resumeBtn').onclick = () => session && enter(session.code, session.asHost);
$('#minus').onclick = () => state && send({ type: 'setPlayers', players: state.players - 1 });
$('#plus').onclick = () => state && send({ type: 'setPlayers', players: state.players + 1 });
$('#changeSeat').onclick = () => { ui.picking = true; render(); };
function takeHost() { send({ type: 'claimHost' }); } // 當上了才記 session.asHost（見 render）
$('#takeHost').onclick = takeHost;
$('#dealRequests').addEventListener('click', e => approveFromClick(e, msg => { voice.unlock(); send(msg); }));
for (const b of document.querySelectorAll('[data-leave]')) b.onclick = () => { if (confirm('確定離開這個房間？')) leave(); };

// 主機的座位：點空位坐下、點自己站起來
$('#hostSeats').addEventListener('click', e => {
  const b = e.target.closest('[data-seat]'); if (!b) return;
  const seat = state.seats[Number(b.dataset.seat) - 1];
  if (seat.mine) send({ type: 'leaveSeat' });
  else if (!seat.taken || !seat.online) send({ type: 'claimSeat', seat: seat.n });
  else toast(`${seat.n} 號已經有人了`);
});
// 玩家的座位
$('#playerSeats').addEventListener('click', e => {
  const b = e.target.closest('[data-seat]'); if (!b) return;
  const seat = state.seats[Number(b.dataset.seat) - 1];
  if (seat.mine) { ui.picking = false; render(); return; }
  if (seat.taken && seat.online) { toast(`${seat.n} 號已經有人了`); return; }
  ui.picking = false;
  send({ type: 'claimSeat', seat: seat.n });
});
// 板子：自己定義（沒有預設板子）——＋／−調狼人、平民，點選加入狼王與各神職；規則
$('#roleRows').addEventListener('click', e => {
  const counts = { ...state.setup.counts };
  const step = e.target.closest('[data-role]');   // 狼人、平民：＋／−
  const tog = e.target.closest('[data-toggle]');  // 狼王、各神職：加入／拿掉
  if (step) counts[step.dataset.role] = Math.max(0, (counts[step.dataset.role] ?? 0) + Number(step.dataset.d));
  else if (tog) counts[tog.dataset.toggle] = (counts[tog.dataset.toggle] ?? 0) > 0 ? 0 : 1;
  else return;
  sendSetup({ counts });
});
for (const b of document.querySelectorAll('[data-wait]')) {
  b.onclick = () => { const k = b.dataset.wait; sendSetup({ rules: { [k]: state.setup.rules[k] + Number(b.dataset.d) } }); };
}
// 發牌：這一下點擊同時解鎖語音，接下來那句「請確認角色身分。」一定要唸
$('#dealBtn').onclick = () => { voice.unlock(); voice.expectFresh(); send({ type: 'deal' }); };
$('#redealBtn').onclick = () => { const yes = confirm('重新發牌？每個人的身分都會換掉，要重新看一次。'); voice.unlock(); if (!yes) return; voice.stop(); voice.expectFresh(); send({ type: 'redeal' }); };
$('#backBtn').onclick = () => { if (confirm('回到設定？已經發出的身分會作廢。')) send({ type: 'backToSetup' }); };
// 開始：這一下點擊同時解鎖語音（瀏覽器規定要使用者點過才能出聲）
$('#startBtn').onclick = () => {
  const notYet = state.players - (state.acked?.length ?? 0);
  if (notYet > 0 && !confirm(`還有 ${notYet} 個人沒按「我看好了」，確定開始？`)) return;
  voice.unlock();
  voice.expectFresh();
  send({ type: 'start' });
};
// 主機點螢幕任何地方：恢復被暫停的聲音、補唸漏掉的那句（Leo 2026-10-17 拿掉「點這裡開啟主持語音」）。
// iPhone 只認 touchend／click 這種「點完」的事件當作使用者點過；capture＝在按鈕自己的動作之前先恢復
for (const ev of ['touchend', 'click']) document.addEventListener(ev, () => { if (state?.you?.isHost) voice.tapped(); }, true);
bindGame($);

/* ───────── 啟動 ───────── */
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) joinRoom(roomParam);
else if (session) { $('#resume').hidden = false; $('#resumeCode').textContent = session.code; show('home'); }
else show('home');
