// 遊戲階段：大廳（設定板子）→ 發牌（各自看身分）。純函式，伺服器的房間用它推進狀態。
// room.setup = { counts, rules }                —— 公開：板子大家都看得到
// room.game  = { roles: {座位: 角色}, acked: {座位: true} } —— 秘密：只送出「你自己的」角色
import * as L from './lobby.js';
import * as R from '../public/shared/roles.js';
import * as E from './engine.js';
import { lineText } from '../public/shared/voice-lines.js';

// 沒有預設板子（Leo 2026-10-11：都是自己定義角色）。新房間先放「狼人＋平民」湊滿人數，主機再自己加神、調數量
export function withSetup(room) {
  if (room.setup) return room;
  const wolf = Math.max(1, Math.round(room.players / 4));
  return { ...room, setup: { counts: { wolf, villager: room.players - wolf }, rules: { ...R.DEFAULT_RULES } } };
}

export function setSetup(room, input) {
  if (room.phase !== 'lobby') return { ok: false, error: '發牌後不能改板子，要先回到設定' };
  const cur = withSetup(room).setup;
  const counts = input?.counts ? R.cleanCounts(input.counts) : cur.counts;
  const rules = input?.rules ? R.cleanRules({ ...cur.rules, ...input.rules }) : cur.rules;
  return { ok: true, room: { ...room, setup: { counts, rules } } };
}

// 還不能發牌的理由（空陣列＝可以發）
export function dealBlockers(room) {
  const r = withSetup(room);
  const out = R.problems(r.setup.counts, r.players);
  const empty = [];
  for (let n = 1; n <= r.players; n++) if (!r.seats[n]) empty.push(n);
  if (empty.length) out.push(`還有 ${empty.length} 個座位沒人（${empty.join('、')} 號）`);
  return out;
}

// 發牌（含重新發牌）時主機唸「請確認角色身分。」；序號接著上一句，主機才知道是新的一句
const checkRole = prev => ({ seq: (prev?.seq ?? 0) + 1, text: lineText(['checkRole']), clips: ['checkRole'] });

// dealNo：第幾次發牌。手機看到它變了，就把上一局畫面上的東西（打開的身分、沒按完的確認框）清掉（2026-10-22 驗測）
// prev：上一局最後一句台詞——直接重開時序號接著往上算，主機在確認視窗那幾秒收到的舊台詞才不會蓋掉這句（2026-10-22 驗測）
export function startDeal(room, rand, prev = null) {
  if (room.phase !== 'lobby') return { ok: false, error: '已經發過牌了' };
  const r = withSetup(room);
  const blockers = dealBlockers(r);
  if (blockers.length) return { ok: false, error: blockers[0] };
  return { ok: true, room: { ...r, phase: 'deal', dealNo: (r.dealNo ?? 0) + 1, game: { roles: R.deal(r.setup.counts, r.players, rand), acked: {}, narration: checkRole(prev) } } };
}

export function redeal(room, rand) {
  if (room.phase !== 'deal') return { ok: false, error: '現在不能重新發牌' };
  return { ok: true, room: { ...room, dealNo: (room.dealNo ?? 0) + 1, game: { roles: R.deal(room.setup.counts, room.players, rand), acked: {}, narration: checkRole(room.game.narration) } } };
}

// 直接重開（Leo 2026-10-11）：對局中、結束後、發牌中都可以；座位與板子不變，馬上重新發牌
export function restart(room, rand) {
  if (!['deal', 'night', 'day', 'ended'].includes(room.phase)) return { ok: false, error: '現在不能重開' };
  const { game, ...rest } = room;
  return startDeal({ ...rest, phase: 'lobby' }, rand, game?.narration);
}

export function backToSetup(room) {
  if (room.phase !== 'deal') return { ok: false, error: '現在不能回到設定' };
  const { game, ...rest } = room;
  return { ok: true, room: { ...rest, phase: 'lobby' } };
}

export function ack(room, clientId) {
  if (room.phase !== 'deal') return { ok: false, error: '現在不用確認身分' };
  const seat = L.seatOf(room, clientId);
  if (!seat) return { ok: false, error: '你沒有座位' };
  return { ok: true, room: { ...room, game: { ...room.game, acked: { ...room.game.acked, [seat]: true } } } };
}

// 坐下／換位：大廳隨意；發牌後只能「接手離線的座位」（換手機回來），身分跟著座位走。
// 發牌後接手要主機按同意（Leo 2026-10-22 A1）：這裡只記下申請，主機畫面只看到「有手機要接手 N 號」，看不到角色；
// 主機自己不能接手座位（不然沒坐下的主機點一下離線座位就看到他的身分）
export function claimSeat(room, clientId, seat, online) {
  if (room.phase === 'lobby') return L.claimSeat(room, clientId, seat, online);
  if (L.seatOf(room, clientId)) return { ok: false, error: '遊戲進行中不能換座位' };
  if (room.hostClientId === clientId) return { ok: false, error: '對局中主機不能接手座位' };
  seat = Number(seat);
  const holder = room.seats[seat];
  if (!holder) return { ok: false, error: '沒有這個座位' };
  if (online.has(holder)) return { ok: false, error: `${seat} 號的手機還在線上` };
  const requests = Object.fromEntries(Object.entries(room.seatRequests ?? {}).filter(([, c]) => c !== clientId)); // 一支手機只留最後一個申請
  return { ok: true, room: { ...room, seatRequests: { ...requests, [seat]: clientId } } };
}

// 主機：同意／拒絕換手機接手座位。同意前再確認一次原本的手機還是離線、申請的手機還在
export function approveSeat(room, seat, yes, online) {
  seat = Number(seat);
  const req = room.seatRequests?.[seat];
  if (room.phase === 'lobby' || !req) return { ok: false, error: '沒有這個申請' };
  const { [seat]: _, ...rest } = room.seatRequests;
  const cleared = { ...room, seatRequests: rest };
  if (!yes) return { ok: true, room: cleared };
  if (online.has(room.seats[seat])) return { ok: false, error: `${seat} 號原本的手機已經回來了`, room: cleared };
  if (!online.has(req)) return { ok: false, error: '申請的手機已經離線了', room: cleared };
  if (L.seatOf(room, req)) return { ok: false, error: '申請的手機已經有座位了', room: cleared };
  const r = L.claimSeat(cleared, req, seat, online);
  return r.ok ? { ok: true, room: withLog(r.room, `${seat} 號換了一支手機（主機同意）。`) } : r;
}

// 換主機：對局中要等原主機斷線滿 1 分鐘（見 L.claimHost），接手後全場紀錄都看得到
export function takeHost(room, clientId, online, now) {
  const r = L.claimHost(room, clientId, online, now);
  if (!r.ok || r.room === room) return r;
  return { ok: true, room: withLog(r.room, '主機換成另一支手機了。') };
}

// 對局紀錄（每支手機都看得到）；發牌階段還沒有紀錄就不寫
function withLog(room, text) {
  if (!Array.isArray(room.game?.log)) return room;
  return { ...room, game: { ...room.game, log: [...room.game.log, { day: room.game.dayNo, text }] } };
}

export function leaveSeat(room, clientId) {
  if (room.phase !== 'lobby') return { ok: false, error: '遊戲進行中不能離開座位' };
  return { ok: true, room: L.leaveSeat(room, clientId) };
}

// 每支手機看到的畫面資料。角色只放「你自己的」——主機若沒坐下，一個角色都拿不到。
export function viewFor(room, online, clientId) {
  const r = withSetup(room);
  const v = L.publicView(r, online, clientId);
  v.setup = r.setup;
  v.blockers = r.phase === 'lobby' ? dealBlockers(r) : [];
  v.dealNo = r.dealNo ?? 0;
  if (r.phase !== 'lobby') {
    // 換手機接手座位的申請：主機看到號碼（不看到角色）；申請的手機看到自己申請了哪一號
    const reqs = Object.entries(r.seatRequests ?? {});
    if (v.you.isHost) v.seatRequests = reqs.map(([s]) => Number(s)).sort((a, b) => a - b);
    const mine = reqs.find(([, c]) => c === clientId);
    if (mine) v.you.requestedSeat = Number(mine[0]);
  }
  if (r.game) {
    v.acked = Object.keys(r.game.acked).map(Number).sort((a, b) => a - b);
    const seat = v.you.seat;
    if (seat && r.game.roles[seat]) v.you.role = r.game.roles[seat];
    if (r.phase === 'deal') v.narration = r.game.narration ?? null; // 發牌時主機要唸的那句
    v.game = E.publicGame(r);            // 對局開始後才有
    v.you.game = E.privateGame(r, seat); // 只有自己的
  }
  return v;
}
