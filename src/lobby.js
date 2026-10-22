// 房間大廳的規則：人數、座位、主機。純函式，不碰網路與儲存，方便測試。
// 房間資料（room）長這樣：
//   { code, phase: 'lobby', players, seats: { [座位號]: clientId }, hostClientId, touchedAt }

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 20;

export function newRoom(code, players, hostClientId, now) {
  return { code, phase: 'lobby', players: clampPlayers(players), seats: {}, hostClientId, touchedAt: now };
}

export function clampPlayers(n) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n)) return 12;
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, n));
}

// 改人數：超出新人數的座位一併清掉
export function setPlayers(room, n) {
  const players = clampPlayers(n);
  const seats = {};
  for (const [k, v] of Object.entries(room.seats)) if (Number(k) <= players) seats[k] = v;
  return { ...room, players, seats };
}

export function seatOf(room, clientId) {
  for (const [k, v] of Object.entries(room.seats)) if (v === clientId) return Number(k);
  return null;
}

// 坐下：空位可坐；有人但那人離線也可以坐（換手機接手）；有人且在線上 → 不行
export function claimSeat(room, clientId, seat, online) {
  seat = Number(seat);
  if (!Number.isInteger(seat) || seat < 1 || seat > room.players) return { ok: false, error: '沒有這個座位' };
  const holder = room.seats[seat];
  if (holder && holder !== clientId && online.has(holder)) return { ok: false, error: `${seat} 號已經有人了` };
  const seats = {};
  for (const [k, v] of Object.entries(room.seats)) if (v !== clientId) seats[k] = v;
  seats[seat] = clientId;
  return { ok: true, room: { ...room, seats } };
}

export function leaveSeat(room, clientId) {
  const seats = {};
  for (const [k, v] of Object.entries(room.seats)) if (v !== clientId) seats[k] = v;
  return { ...room, seats };
}

// 對局中原主機要斷線這麼久，別的手機才能接手（Leo 2026-10-22 A1：防有人趁主機螢幕關掉的幾秒搶主機、重開整局）
export const HOST_TAKEOVER_MS = 60000;

// 接手當主機：原主機離線才可以（主機看不到任何人的身分，所以誰接手都不會洩密）；
// 對局中（發牌後）還要等原主機斷線滿 1 分鐘。hostLeftAt＝原主機斷線的時間（房間在斷線時記下）
export function claimHost(room, clientId, online, now = 0) {
  if (room.hostClientId === clientId) return { ok: true, room };
  if (room.hostClientId && online.has(room.hostClientId)) return { ok: false, error: '主機還在線上' };
  const wait = room.phase !== 'lobby' && room.hostLeftAt != null ? HOST_TAKEOVER_MS - (now - room.hostLeftAt) : 0;
  if (wait > 0) return { ok: false, error: `主機斷線 1 分鐘後才能接手（還要 ${Math.ceil(wait / 1000)} 秒）` };
  return { ok: true, room: { ...room, hostClientId: clientId, hostLeftAt: null } };
}

// 每支手機只拿到它該看的：大廳階段沒有秘密，但先把格式定好
export function publicView(room, online, clientId) {
  const seats = [];
  for (let n = 1; n <= room.players; n++) {
    const holder = room.seats[n];
    seats.push({ n, taken: Boolean(holder), online: Boolean(holder && online.has(holder)), mine: holder === clientId, host: Boolean(holder && holder === room.hostClientId) });
  }
  return {
    type: 'state',
    code: room.code,
    phase: room.phase,
    players: room.players,
    seats,
    hostOnline: online.has(room.hostClientId),
    you: { isHost: room.hostClientId === clientId, seat: seatOf(room, clientId) },
  };
}
