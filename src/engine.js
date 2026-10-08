// 對局引擎：黑夜 → 天亮 → 白天 → 黑夜 … → 結束。純函式：輸入房間與時間，回傳新房間。
// 時間相關的動作（假等、停頓）用 game.timer = { at } 交給房間的鬧鐘，到時呼叫 advance()。
//
// room.phase：'night' | 'day' | 'ended'（之前是 'lobby'、'deal'，見 game.js）
// room.game（秘密，除了每支手機自己的部分之外，不會原樣送出）：
//   roles, acked, alive{座位:bool}, dayNo, potions{save,poison}, lastGuard, idiotRevealed[],
//   seerChecks[{seat,target,wolf}], canShoot[], knightUsed, log[{day,text}], narration{seq,text},
//   night{steps,idx,stage,openedAt,wolfVotes,wolfTarget,guardTarget,witchSave,witchPoison,seerTarget,seerDone},
//   day{exileDone}, winner, timer{at}
import * as L from './lobby.js';
import * as R from '../public/shared/roles.js';

export const NIGHT_ORDER = ['guard', 'wolf', 'witch', 'seer'];
export const STEP_TEXT = {
  guard: ['守衛請睜眼。守衛，今晚你要守護誰？', '守衛請閉眼。'],
  wolf: ['狼人請睜眼。狼人，今晚你們要殺誰？', '狼人請閉眼。'],
  witch: ['女巫請睜眼。女巫，今晚你要用藥嗎？', '女巫請閉眼。'],
  seer: ['預言家請睜眼。預言家，你要查驗誰？', '預言家請閉眼。'],
};
export const INTRO_MS = 5000;   // 「天黑請閉眼」之後，等大家閉好眼
export const CLOSE_MS = 4000;   // 「X 請閉眼」之後，到下一個角色睜眼
export const PAUSE_MS = [2000, 5000]; // 活著的角色點完後，再隨機停一下才唸閉眼

const ok = room => ({ ok: true, room });
const fail = error => ({ ok: false, error });
const isWolfRole = role => R.ROLES[role].team === 'wolf';
const between = (rand, [lo, hi]) => lo + rand(hi - lo + 1);
const seatsList = g => Object.keys(g.roles).map(Number).sort((a, b) => a - b);
const fmtSeats = seats => seats.map(s => `${s} 號`).join('、');

function say(g, text) { g.narration = { seq: (g.narration?.seq ?? 0) + 1, text }; }
function note(g, text) { g.log.push({ day: g.dayNo, text }); say(g, text); }

// 某一步要誰動作：狼人那步是所有狼人陣營；其他步是那個角色本人
function actorRole(step) { return step === 'wolf' ? isWolfRole : role => role === step; }
export function actors(g, step, { aliveOnly = true } = {}) {
  const match = actorRole(step);
  return seatsList(g).filter(s => match(g.roles[s]) && (!aliveOnly || g.alive[s]));
}

function witchMaySaveSelf(rules, dayNo) {
  return rules.witchSelfSave === 'always' || (rules.witchSelfSave === 'first' && dayNo === 1);
}

/* ───────── 開局與黑夜 ───────── */
export function startGame(room, now, rand) {
  if (room.phase !== 'deal') return fail('還沒發牌');
  const g = structuredClone(room.game);
  Object.assign(g, {
    alive: Object.fromEntries(seatsList(g).map(s => [s, true])),
    dayNo: 1, potions: { save: true, poison: true }, lastGuard: null, idiotRevealed: [],
    seerChecks: [], canShoot: [], knightUsed: false, log: [], winner: null,
  });
  return ok(beginNight({ ...room, game: g }, now));
}

function beginNight(room, now) {
  const g = room.game;
  const c = room.setup.counts;
  const steps = NIGHT_ORDER.filter(step => (step === 'wolf' ? (c.wolf ?? 0) + (c.king ?? 0) > 0 : (c[step] ?? 0) > 0));
  g.night = { steps, idx: -1, stage: 'intro', openedAt: null, wolfVotes: {}, wolfTarget: null, guardTarget: null, witchSave: false, witchPoison: null, seerTarget: null, seerDone: false };
  g.canShoot = [];
  g.day = null;
  say(g, `第 ${g.dayNo} 夜，天黑請閉眼。`);
  g.timer = { at: now + INTRO_MS };
  return { ...room, phase: 'night' };
}

// 鬧鐘到了：往下一步走
export function advance(room, now, rand) {
  if (room.phase !== 'night' || !room.game.timer || now < room.game.timer.at) return ok(room);
  const g = structuredClone(room.game);
  const n = g.night;
  g.timer = null;
  if (n.stage === 'intro' || n.stage === 'closed') {
    n.idx++;
    if (n.idx >= n.steps.length) return ok(dawn({ ...room, game: g }, now));
    const step = n.steps[n.idx];
    n.stage = 'acting';
    n.openedAt = now;
    if (step === 'wolf') n.wolfVotes = {};
    say(g, STEP_TEXT[step][0]);
    // 這個角色全死了：照樣唸、假裝等一段隨機時間
    if (actors(g, step).length === 0) g.timer = { at: now + 1000 * between(rand, [room.setup.rules.fakeWaitMin, room.setup.rules.fakeWaitMax]) };
  } else if (n.stage === 'acting' || n.stage === 'pause') {
    n.stage = 'closed';
    say(g, STEP_TEXT[n.steps[n.idx]][1]);
    g.timer = { at: now + CLOSE_MS };
  }
  return ok({ ...room, game: g });
}

function finishStep(g, now, rand) {
  g.night.stage = 'pause';
  g.timer = { at: now + between(rand, PAUSE_MS) };
}

// 夜裡的動作。payload 依角色不同：
//   guard { target }（0＝空守）｜wolf { target }（0＝空刀）｜witch { use:'save'|'poison'|'none', target }｜seer { target } 或 { done:true }
export function nightAction(room, clientId, payload, online, now, rand) {
  if (room.phase !== 'night') return fail('現在不是晚上');
  const n = room.game.night;
  if (n.stage !== 'acting') return fail('現在還沒輪到你');
  const seat = L.seatOf(room, clientId);
  const step = n.steps[n.idx];
  if (!seat || !actors(room.game, step).includes(seat)) return fail('現在還沒輪到你');
  const g = structuredClone(room.game);
  const night = g.night;
  const target = Number(payload?.target ?? 0);
  const aliveTarget = t => Number.isInteger(t) && g.alive[t] === true;

  if (step === 'guard') {
    if (target && !aliveTarget(target)) return fail('只能守護活著的人');
    if (target && target === g.lastGuard) return fail('不能連續兩晚守同一個人');
    night.guardTarget = target || null;
    finishStep(g, now, rand);
  } else if (step === 'wolf') {
    if (target && !aliveTarget(target)) return fail('只能選活著的人');
    night.wolfVotes[seat] = target;
    // 所有「在線上、還活著」的狼都選同一個才算數；全都離線就以現有的票為準
    const voters = actors(g, 'wolf').filter(s => online.has(room.seats[s]));
    const need = voters.length ? voters : [seat];
    const votes = need.map(s => night.wolfVotes[s]);
    if (votes.every(v => v !== undefined && v === votes[0])) {
      night.wolfTarget = votes[0] || null;
      finishStep(g, now, rand);
    }
  } else if (step === 'witch') {
    const use = payload?.use;
    if (use === 'save') {
      if (!g.potions.save) return fail('解藥已經用掉了');
      if (!night.wolfTarget) return fail('今晚沒有人被殺');
      if (night.wolfTarget === seat && !witchMaySaveSelf(room.setup.rules, g.dayNo)) return fail('依照規則，今晚不能救自己');
      night.witchSave = true;
      g.potions.save = false;
    } else if (use === 'poison') {
      if (!g.potions.poison) return fail('毒藥已經用掉了');
      if (!aliveTarget(target)) return fail('只能毒活著的人');
      if (target === seat) return fail('不能毒自己');
      night.witchPoison = target;
      g.potions.poison = false;
    } else if (use !== 'none') return fail('看不懂這個動作');
    finishStep(g, now, rand);
  } else if (step === 'seer') {
    if (payload?.done) {
      if (!night.seerTarget) return fail('還沒查驗');
      finishStep(g, now, rand);
    } else {
      if (night.seerTarget) return fail('今晚已經查驗過了');
      if (!aliveTarget(target) || target === seat) return fail('請選一個活著的其他玩家');
      night.seerTarget = target;
      g.seerChecks.push({ day: g.dayNo, target, wolf: isWolfRole(g.roles[target]) });
    }
  }
  return ok({ ...room, game: g });
}

// 主機：這一步卡住了（例如狼的手機沒電），跳過——當作沒有動作
export function skipStep(room, now, rand) {
  if (room.phase !== 'night' || room.game.night.stage !== 'acting') return fail('現在沒有可以跳過的步驟');
  const g = structuredClone(room.game);
  finishStep(g, now, rand);
  return ok({ ...room, game: g });
}

/* ───────── 天亮 ───────── */
function kill(g, seat, { poisoned = false } = {}) {
  g.alive[seat] = false;
  const role = g.roles[seat];
  if ((role === 'hunter' || role === 'king') && !poisoned) g.canShoot.push(seat);
}

function dawn(room, now) {
  const g = room.game;
  const n = g.night;
  const deaths = new Set();
  if (n.wolfTarget) {
    const saved = n.witchSave, guarded = n.guardTarget === n.wolfTarget;
    if (saved === guarded) deaths.add(n.wolfTarget); // 都沒救＝死；同守同救＝也死
  }
  if (n.witchPoison) deaths.add(n.witchPoison);
  g.lastGuard = n.guardTarget;
  g.canShoot = [];
  for (const s of deaths) kill(g, s, { poisoned: s === n.witchPoison });
  const list = [...deaths].sort((a, b) => a - b);
  note(g, list.length ? `天亮了。昨晚死亡的是 ${fmtSeats(list)}。` : '天亮了。昨晚是平安夜。');
  g.night = null;
  g.day = { exileDone: false };
  g.timer = null;
  return checkWin({ ...room, phase: 'day', game: g });
}

/* ───────── 白天 ───────── */
export function shoot(room, clientId, target) {
  if (room.phase !== 'day') return fail('現在不能開槍');
  const seat = L.seatOf(room, clientId);
  if (!seat || !room.game.canShoot.includes(seat)) return fail('你現在不能開槍');
  const g = structuredClone(room.game);
  g.canShoot = g.canShoot.filter(s => s !== seat);
  target = Number(target ?? 0);
  if (target) {
    if (!g.alive[target] || target === seat) return fail('只能帶走活著的其他玩家');
    kill(g, target); // 被槍帶走的獵人／狼王也可以再開槍
    note(g, `${seat} 號發動技能，帶走了 ${target} 號。`);
  }
  return ok(checkWin({ ...room, game: g }));
}

export function exile(room, target) {
  if (room.phase !== 'day') return fail('現在不是白天');
  if (room.game.day.exileDone) return fail('今天已經放逐過了');
  const g = structuredClone(room.game);
  target = Number(target ?? 0);
  g.day.exileDone = true;
  if (!target) note(g, '平票，今天沒有人出局。');
  else {
    if (!g.alive[target]) return fail('只能放逐活著的人');
    if (g.roles[target] === 'idiot' && !g.idiotRevealed.includes(target)) {
      g.idiotRevealed.push(target);
      note(g, `${target} 號翻牌，是白癡，免於出局，但之後不能投票。`);
    } else {
      kill(g, target);
      note(g, `${target} 號被放逐出局。`);
    }
  }
  return ok(checkWin({ ...room, game: g }));
}

export function duel(room, clientId, target) {
  if (room.phase !== 'day') return fail('只有白天能決鬥');
  const seat = L.seatOf(room, clientId);
  const g0 = room.game;
  if (!seat || g0.roles[seat] !== 'knight' || !g0.alive[seat]) return fail('你不能決鬥');
  if (g0.knightUsed) return fail('決鬥只能用一次');
  target = Number(target);
  if (!g0.alive[target] || target === seat) return fail('請選一個活著的其他玩家');
  const g = structuredClone(g0);
  g.knightUsed = true;
  if (isWolfRole(g.roles[target])) {
    kill(g, target);
    note(g, `騎士 ${seat} 號決鬥 ${target} 號：${target} 號是狼人，出局！`);
  } else {
    kill(g, seat);
    note(g, `騎士 ${seat} 號決鬥 ${target} 號：${target} 號是好人，騎士以死謝罪。`);
  }
  return ok(checkWin({ ...room, game: g }));
}

export function nextNight(room, now) {
  if (room.phase !== 'day') return fail('現在不是白天');
  const g = structuredClone(room.game);
  g.dayNo++;
  return ok(beginNight({ ...room, game: g }, now));
}

/* ───────── 勝負 ───────── */
export function winnerOf(g, counts, rules) {
  const alive = seatsList(g).filter(s => g.alive[s]);
  const team = s => R.ROLES[g.roles[s]].team;
  const wolves = alive.filter(s => team(s) === 'wolf').length;
  if (wolves === 0) return 'good';
  const gods = alive.filter(s => team(s) === 'god').length;
  const villagers = alive.filter(s => team(s) === 'villager').length;
  const hasGods = R.ROLE_ORDER.some(id => R.ROLES[id].team === 'god' && (counts[id] ?? 0) > 0);
  const hasVillagers = (counts.villager ?? 0) > 0;
  if (rules.win === 'side') {
    if ((hasGods && gods === 0) || (hasVillagers && villagers === 0)) return 'wolf';
  } else if (gods + villagers === 0) return 'wolf';
  return null;
}

function checkWin(room) {
  const g = room.game;
  const w = winnerOf(g, room.setup.counts, room.setup.rules);
  if (!w) return room;
  g.winner = w;
  g.timer = null;
  g.canShoot = [];
  note(g, w === 'good' ? '遊戲結束，好人陣營獲勝！' : '遊戲結束，狼人陣營獲勝！');
  return { ...room, phase: 'ended' };
}

// 再來一局：座位、板子都留著，回到大廳
export function newGame(room) {
  if (room.phase !== 'ended' && room.phase !== 'day' && room.phase !== 'night') return fail('現在不能重開');
  const { game, ...rest } = room;
  return ok({ ...rest, phase: 'lobby' });
}

/* ───────── 每支手機看到的內容 ───────── */
// 公開：所有人都知道的（主機唸出來的、白天宣布的）
export function publicGame(room) {
  const g = room.game;
  if (!g || !g.alive) return null;
  const pub = {
    dayNo: g.dayNo,
    alive: g.alive,
    idiotRevealed: g.idiotRevealed,
    narration: g.narration ?? null,
    log: g.log.slice(-30),
    winner: g.winner,
    exileDone: g.day?.exileDone ?? false,
    // 夜裡只公開「現在輪到哪個角色」（台詞本來就會唸出來），不公開那個角色死活與進度
    night: g.night ? { step: g.night.steps[g.night.idx] ?? null, openedAt: g.night.openedAt } : null,
  };
  if (room.phase === 'ended') pub.allRoles = g.roles; // 結束後翻開所有人的身分
  return pub;
}

// 私人：只給坐在這個座位的手機
export function privateGame(room, seat) {
  const g = room.game;
  if (!g || !g.alive || !seat) return null;
  const role = g.roles[seat];
  const me = { alive: g.alive[seat], idiotRevealed: g.idiotRevealed.includes(seat) };
  if (isWolfRole(role)) me.wolves = actors(g, 'wolf', { aliveOnly: false }).map(s => ({ seat: s, king: g.roles[s] === 'king', alive: g.alive[s] }));
  if (role === 'seer') me.seerChecks = g.seerChecks;
  if (role === 'witch') me.potions = g.potions;
  if (role === 'guard') me.lastGuard = g.lastGuard;
  if (room.phase === 'day') {
    if (g.canShoot.includes(seat)) me.canShoot = true;
    if (role === 'knight' && g.alive[seat] && !g.knightUsed) me.canDuel = true;
  }
  const n = g.night;
  if (room.phase === 'night' && n?.stage === 'acting' && g.alive[seat]) {
    const step = n.steps[n.idx];
    if (actors(g, step).includes(seat)) {
      if (step === 'guard') me.action = { kind: 'guard', lastGuard: g.lastGuard };
      if (step === 'wolf') me.action = { kind: 'wolf', votes: n.wolfVotes };
      if (step === 'witch') me.action = {
        kind: 'witch',
        victim: g.potions.save ? n.wolfTarget : null, // 解藥用掉之後就看不到誰被殺
        canSave: g.potions.save && Boolean(n.wolfTarget) && (n.wolfTarget !== seat || witchMaySaveSelf(room.setup.rules, g.dayNo)),
        canPoison: g.potions.poison,
        saveUsedUp: !g.potions.save,
      };
      if (step === 'seer') me.action = { kind: 'seer', checked: n.seerTarget ? g.seerChecks.at(-1) : null };
    }
  }
  return me;
}
