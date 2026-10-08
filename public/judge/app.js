// 法官工具（M1：開房、加入、選座位、斷線重連）
'use strict';
const $ = s => document.querySelector(s);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// 這支手機的固定身分證（不是遊戲身分）：重新整理、重開網頁都認得回原座位
const clientId = store.get('ww-cid') || (() => {
  const id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  store.set('ww-cid', id);
  return id;
})();

let session = null;   // { code, asHost }
try { session = JSON.parse(store.get('ww-judge') || 'null'); } catch {}
let ws = null, state = null, retry = 0, leaving = false, pingTimer = 0, pongTimer = 0, retryTimer = 0;

/* ───────── 畫面 ───────── */
function show(id) { for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id; window.scrollTo(0, 0); }
let toastTimer = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200); }
function setStatus(kind, text) {
  const s = $('#status');
  s.hidden = kind === 'none';
  s.className = 'status ' + (kind === 'online' ? 'online' : kind === 'bad' ? 'bad' : '');
  s.textContent = text || '';
}

function renderSeats(box, onPick) {
  box.innerHTML = '';
  for (const seat of state.seats) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seat' + (seat.taken ? ' taken' : '') + (seat.taken && !seat.online ? ' offline' : '') + (seat.mine ? ' mine' : '');
    b.innerHTML = `<span class="n">${seat.n}</span>` +
      (seat.mine ? '<span class="tag">你</span>' : seat.host ? '<span class="tag">主機</span>' : seat.taken && !seat.online ? '<span class="tag">離線</span>' : '');
    b.setAttribute('aria-label', `${seat.n} 號${seat.mine ? '（你）' : seat.taken ? (seat.online ? '（有人）' : '（離線）') : '（空位）'}`);
    b.onclick = () => onPick(seat);
    box.appendChild(b);
  }
}

function render() {
  if (!state) return;
  if (session.asHost && !state.you.isHost && !render.warned) { render.warned = true; toast('這個房間已經有主機了，你以玩家身分加入'); }
  const asHostNow = state.you.isHost;
  show(asHostNow ? 'host' : 'player');

  if (asHostNow) {
    $('#hostCode').textContent = state.code;
    $('#playersNum').textContent = state.players;
    const filled = state.seats.filter(s => s.taken).length;
    $('#seatCount').textContent = `${filled}／${state.players} 人`;
    renderSeats($('#hostSeats'), seat => {
      if (seat.mine) send({ type: 'leaveSeat' });
      else if (!seat.taken || !seat.online) send({ type: 'claimSeat', seat: seat.n });
      else toast(`${seat.n} 號已經有人了`);
    });
    drawQR();
  } else {
    $('#playerCode').textContent = state.code;
    const mine = state.you.seat;
    $('#pickSeat').hidden = Boolean(mine) && !render.picking;
    $('#mySeat').hidden = !mine || render.picking;
    if (mine) $('#myNum').textContent = mine;
    $('#hostGone').hidden = state.hostOnline;
    renderSeats($('#playerSeats'), seat => {
      if (seat.mine) { render.picking = false; render(); return; }
      if (seat.taken && seat.online) { toast(`${seat.n} 號已經有人了`); return; }
      render.picking = false;
      send({ type: 'claimSeat', seat: seat.n });
    });
  }
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
    else if (m.type === 'error') toast(m.error);
  };
  sock.onclose = async e => {
    stopPing();
    if (ws !== sock || leaving) return;
    if (e.code === 4001) { setStatus('bad', '這支手機在別的分頁開了房間'); return; }
    // 連不上兩次以上：確認房間還在不在
    if (retry >= 2) {
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

function roomGone() {
  toast(`房間 ${session.code} 已經關閉了`);
  leave();
}

/* ───────── 螢幕保持亮著（螢幕一關，連線就斷） ───────── */
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !session) return;
  keepAwake();
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) { retry = 0; connect(); }
});

/* ───────── 進出房間 ───────── */
function enter(code, asHost) {
  session = { code, asHost };
  store.set('ww-judge', JSON.stringify(session));
  history.replaceState(null, '', `?room=${code}`);
  state = null; render.warned = false; render.picking = false; qrFor = '';
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
  } catch { toast('連不上伺服器，請檢查網路'); }
}

/* ───────── 綁定 ───────── */
$('#createBtn').onclick = createRoom;
$('#joinForm').addEventListener('submit', e => { e.preventDefault(); joinRoom($('#joinCode').value); });
$('#joinCode').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
$('#resumeBtn').onclick = () => session && enter(session.code, session.asHost);
$('#minus').onclick = () => state && send({ type: 'setPlayers', players: state.players - 1 });
$('#plus').onclick = () => state && send({ type: 'setPlayers', players: state.players + 1 });
$('#changeSeat').onclick = () => { render.picking = true; render(); };
$('#takeHost').onclick = () => { session.asHost = true; store.set('ww-judge', JSON.stringify(session)); send({ type: 'claimHost' }); };
for (const b of document.querySelectorAll('[data-leave]')) b.onclick = () => { if (confirm('確定離開這個房間？')) leave(); };

/* ───────── 啟動 ───────── */
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) joinRoom(roomParam);
else if (session) { $('#resume').hidden = false; $('#resumeCode').textContent = session.code; show('home'); }
else show('home');
