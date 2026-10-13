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

export function startDeal(room, rand) {
  if (room.phase !== 'lobby') return { ok: false, error: '已經發過牌了' };
  const r = withSetup(room);
  const blockers = dealBlockers(r);
  if (blockers.length) return { ok: false, error: blockers[0] };
  return { ok: true, room: { ...r, phase: 'deal', game: { roles: R.deal(r.setup.counts, r.players, rand), acked: {}, narration: checkRole(null) } } };
}

export function redeal(room, rand) {
  if (room.phase !== 'deal') return { ok: false, error: '現在不能重新發牌' };
  return { ok: true, room: { ...room, game: { roles: R.deal(room.setup.counts, room.players, rand), acked: {}, narration: checkRole(room.game.narration) } } };
}

// 直接重開（Leo 2026-10-11）：對局中、結束後、發牌中都可以；座位與板子不變，馬上重新發牌
export function restart(room, rand) {
  if (!['deal', 'night', 'day', 'ended'].includes(room.phase)) return { ok: false, error: '現在不能重開' };
  const { game, ...rest } = room;
  return startDeal({ ...rest, phase: 'lobby' }, rand);
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

// 坐下／換位：大廳隨意；發牌後只能「接手離線的座位」（換手機回來），身分跟著座位走
export function claimSeat(room, clientId, seat, online) {
  if (room.phase === 'lobby') return L.claimSeat(room, clientId, seat, online);
  if (L.seatOf(room, clientId)) return { ok: false, error: '遊戲進行中不能換座位' };
  const holder = room.seats[Number(seat)];
  if (!holder) return { ok: false, error: '沒有這個座位' };
  if (online.has(holder)) return { ok: false, error: `${seat} 號的手機還在線上` };
  return L.claimSeat(room, clientId, seat, online);
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
