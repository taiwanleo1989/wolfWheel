// 對局引擎：黑夜 → 天亮 → 白天 → 黑夜 … → 結束。純函式：輸入房間與時間，回傳新房間。
// 時間相關的動作（假等、停頓）用 game.timer = { at } 交給房間的鬧鐘，到時呼叫 advance()。
//
// 黑夜照 Leo 的手稿（2026-10-08）：守衛 → 狼人 → 女巫（解藥、毒藥兩段）→ 預言家 → 獵人 →（第一晚）上警 → 天亮。
// 每個角色＝一段「劇本」：幾句台詞（beat），每句台詞配一個要等的動作，最後一句閉眼。
// 主機只唸台詞，絕不唸號碼——手稿裡「上帝手比號碼」的部分只出現在當事人的手機上。
//
// room.phase：'night' | 'day' | 'ended'（之前是 'lobby'、'deal'，見 game.js）
// room.game（秘密，除了每支手機自己的部分之外，不會原樣送出）：
//   roles, acked, alive{座位:bool}, dayNo, potions{save,poison}, lastGuard, idiotRevealed[],
//   seerChecks[{day,target,wolf}], canShoot[], knightUsed, log[{day,text}], narration{seq,text},
//   night{steps,idx,beat,stage,next,openedAt,wolfVotes,wolfProposal,wolfTarget,guardTarget,witchSave,witchPoison,seerTarget},
//   day{exileDone,pendingDeaths,poisoned}, winner, timer{at}
import * as L from './lobby.js';
import * as R from '../public/shared/roles.js';
import { lineText, seatKey } from '../public/shared/voice-lines.js';

export const NIGHT_ORDER = ['guard', 'wolf', 'witch', 'seer', 'hunter'];

// 劇本：每個角色的台詞（照手稿字句）。act＝這句台詞之後等誰做什麼；null＝不等人，固定等一段時間
export function scriptFor(step, counts) {
  switch (step) {
    case 'guard': return { beats: [{ say: ['guardOpen'], act: 'guard' }], close: ['guardClose'] };
    case 'wolf': return { beats: [{ say: [(counts.king ?? 0) > 0 ? 'wolfOpenKing' : 'wolfOpen'], act: 'wolf' }], close: ['wolfClose'] };
    case 'witch': return {
      beats: [{ say: ['witchSave'], act: 'witchSave' }, { say: ['witchPoison'], act: 'witchPoison' }],
      close: ['witchClose'],
    };
    case 'seer': return { beats: [{ say: ['seerOpen'], act: 'seer' }], close: ['seerClose'] };
    case 'hunter': return { beats: [{ say: ['hunterOpen'], act: 'hunter' }], close: ['hunterClose'] };
    case 'police': return { beats: [{ say: ['police'], act: null }], close: null };
  }
}

export const INTRO_MS = 5000;   // 「天黑請閉眼」之後，等大家閉好眼
export const CLOSE_MS = 4000;   // 「X 請閉眼」之後，到下一個角色睜眼
export const POLICE_MS = 12000; // 「要上警的玩家請起立」之後等大家起立（主機可以提早按繼續）
export const PAUSE_MS = [2000, 5000]; // 每句台詞的動作完成後，隨機停一下才唸下一句

const ok = room => ({ ok: true, room });
const fail = error => ({ ok: false, error });
const isWolfRole = role => R.ROLES[role].team === 'wolf';
const between = (rand, [lo, hi]) => lo + rand(hi - lo + 1);
const seatsList = g => Object.keys(g.roles).map(Number).sort((a, b) => a - b);

// 台詞用片段組成（public/shared/voice-lines.js）：clips 給主機播錄好的聲音，text 給畫面與紀錄
function say(g, clips) { g.narration = { seq: (g.narration?.seq ?? 0) + 1, text: lineText(clips), clips }; }
function note(g, clips) { g.log.push({ day: g.dayNo, text: lineText(clips) }); say(g, clips); }

// 某一步要誰動作：狼人那步是所有狼人陣營；上警不等任何人；其他是那個角色本人
export function actors(g, step, { aliveOnly = true } = {}) {
  if (step === 'police') return [];
  const match = step === 'wolf' ? isWolfRole : role => role === step;
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
  if (g.dayNo === 1 && room.setup.rules.police !== false) steps.push('police'); // 第一晚最後：上警（設定可關）
  g.night = { steps, idx: -1, beat: 0, stage: 'intro', next: null, openedAt: null, wolfVotes: {}, wolfProposal: null, wolfTarget: null, guardTarget: null, witchSave: false, witchPoison: null, seerTarget: null };
  g.canShoot = [];
  g.day = null;
  say(g, ['nightStart']);
  g.timer = { at: now + INTRO_MS };
  return { ...room, phase: 'night' };
}

const curStep = n => n.steps[n.idx];
const curBeat = (room, n) => scriptFor(curStep(n), room.setup.counts).beats[n.beat];

// 唸一句台詞並開始等：活著的人會在手機上動作；沒人（死了、或上警）就計時
function openBeat(room, g, now, rand) {
  const n = g.night;
  const beat = curBeat(room, n);
  n.stage = 'acting';
  n.openedAt = now;
  say(g, beat.say);
  if (beat.act === null) g.timer = { at: now + POLICE_MS };
  else if (actors(g, curStep(n)).length === 0) g.timer = { at: now + 1000 * between(rand, [room.setup.rules.fakeWaitMin, room.setup.rules.fakeWaitMax]) };
  else g.timer = null;
}

// 這句台詞的動作完成（或假等結束）：隨機停一下，再唸下一句或閉眼
function endBeat(room, g, now, rand) {
  const n = g.night;
  n.next = n.beat + 1 < scriptFor(curStep(n), room.setup.counts).beats.length ? 'beat' : 'close';
  n.stage = 'pause';
  g.timer = { at: now + between(rand, PAUSE_MS) };
}

function nextStep(room, g, now, rand) {
  const n = g.night;
  n.idx++;
  n.beat = 0;
  if (n.idx >= n.steps.length) return dawn({ ...room, game: g }, now);
  openBeat(room, g, now, rand);
  return { ...room, game: g };
}

// 鬧鐘到了：往下一步走
export function advance(room, now, rand) {
  if (room.phase !== 'night' || !room.game.timer || now < room.game.timer.at) return ok(room);
  const g = structuredClone(room.game);
  const n = g.night;
  g.timer = null;
  if (n.stage === 'intro' || n.stage === 'closed') return ok(nextStep(room, g, now, rand));
  if (n.stage === 'acting') { endBeat(room, g, now, rand); return ok({ ...room, game: g }); } // 假等或上警時間到
  if (n.stage === 'pause') {
    if (n.next === 'beat') { n.beat++; openBeat(room, g, now, rand); return ok({ ...room, game: g }); }
    const close = scriptFor(curStep(n), room.setup.counts).close;
    if (!close) return ok(nextStep(room, g, now, rand)); // 上警沒有閉眼這句，直接天亮
    n.stage = 'closed';
    say(g, close);
    g.timer = { at: now + CLOSE_MS };
  }
  return ok({ ...room, game: g });
}

// 夜裡的動作。依「現在這句台詞要等什麼」：
//   guard { target }（0＝空守）
//   wolf  { target }（0＝空刀；全體一致後出現確認）｜{ confirm:true }｜{ reset:true }
//   witchSave { use:'save' | 'skip' }        witchPoison { use:'poison', target } | { use:'none' }
//   seer  { target } 或 { done:true }          hunter { seen:true }
export function nightAction(room, clientId, payload, online, now, rand) {
  if (room.phase !== 'night') return fail('現在不是晚上');
  const n0 = room.game.night;
  if (n0.stage !== 'acting') return fail('現在還沒輪到你');
  const seat = L.seatOf(room, clientId);
  const step = curStep(n0);
  if (!seat || !actors(room.game, step).includes(seat)) return fail('現在還沒輪到你');
  const act = curBeat(room, n0).act;
  const g = structuredClone(room.game);
  const night = g.night;
  const target = Number(payload?.target ?? 0);
  const aliveTarget = t => Number.isInteger(t) && g.alive[t] === true;

  if (act === 'guard') {
    if (target && !aliveTarget(target)) return fail('只能守護活著的人');
    if (target && target === g.lastGuard) return fail('不能連續兩晚守同一個人');
    night.guardTarget = target || null;
    endBeat(room, g, now, rand);
  } else if (act === 'wolf') {
    if (payload?.reset) { night.wolfVotes = {}; night.wolfProposal = null; }
    else if (payload?.confirm) {
      if (night.wolfProposal === null) return fail('狼人還沒有統一意見');
      night.wolfTarget = night.wolfProposal || null;
      endBeat(room, g, now, rand);
    } else {
      if (target && !aliveTarget(target)) return fail('只能選活著的人');
      night.wolfVotes[seat] = target;
      // 所有「在線上、還活著」的狼都選同一個，才出現「是否正確」的確認
      const voters = actors(g, 'wolf').filter(s => online.has(room.seats[s]));
      const need = voters.length ? voters : [seat];
      const votes = need.map(s => night.wolfVotes[s]);
      night.wolfProposal = votes.every(v => v !== undefined && v === votes[0]) ? votes[0] : null;
    }
  } else if (act === 'witchSave') {
    if (payload?.use === 'save') {
      if (!g.potions.save) return fail('解藥已經用掉了');
      if (!night.wolfTarget) return fail('今晚沒有人死亡');
      if (night.wolfTarget === seat && !witchMaySaveSelf(room.setup.rules, g.dayNo)) return fail('依照規則，女巫不能救自己');
      night.witchSave = true;
      g.potions.save = false;
    } else if (payload?.use !== 'skip') return fail('看不懂這個動作');
    endBeat(room, g, now, rand);
  } else if (act === 'witchPoison') {
    if (payload?.use === 'poison') {
      if (night.witchSave) return fail('一晚只能用一瓶藥，今晚已經用過解藥了');
      if (!g.potions.poison) return fail('毒藥已經用掉了');
      if (!aliveTarget(target)) return fail('只能毒活著的人');
      if (target === seat) return fail('不能毒自己');
      night.witchPoison = target;
      g.potions.poison = false;
    } else if (payload?.use !== 'none') return fail('看不懂這個動作');
    endBeat(room, g, now, rand);
  } else if (act === 'seer') {
    if (payload?.done) {
      if (!night.seerTarget) return fail('還沒查驗');
      endBeat(room, g, now, rand);
    } else {
      if (night.seerTarget) return fail('今晚已經查驗過了');
      if (!aliveTarget(target) || target === seat) return fail('請選一個活著的其他玩家');
      night.seerTarget = target;
      g.seerChecks.push({ day: g.dayNo, target, wolf: isWolfRole(g.roles[target]) });
    }
  } else if (act === 'hunter') {
    endBeat(room, g, now, rand);
  } else return fail('現在不用動作');
  return ok({ ...room, game: g });
}

// 主機：這一步卡住了（例如狼的手機沒電）就跳過——當作沒有動作；上警時用來「大家都好了，繼續」
export function skipStep(room, now, rand) {
  if (room.phase !== 'night' || room.game.night.stage !== 'acting') return fail('現在沒有可以跳過的步驟');
  const g = structuredClone(room.game);
  endBeat(room, g, now, rand);
  return ok({ ...room, game: g });
}

/* ───────── 天亮 ───────── */
function kill(g, seat, { poisoned = false } = {}) {
  g.alive[seat] = false;
  const role = g.roles[seat];
  if ((role === 'hunter' || role === 'king') && !poisoned) g.canShoot.push(seat);
}

// 「昨晚死亡的是 9 號、10 號。」／「昨晚是平安夜。」
const deathClips = list => (list.length ? ['deathsAre', ...list.flatMap((s, i) => (i ? ['sep', seatKey(s)] : [seatKey(s)])), 'end'] : ['peace']);

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
  const list = [...deaths].sort((a, b) => a - b);
  const police = n.steps.includes('police');
  g.night = null;
  g.timer = null;
  g.day = { exileDone: false, pendingDeaths: null, poisoned: n.witchPoison };
  if (police) {
    // 第一天：先競選警長（口頭），主機按「公布昨晚死訊」才宣布——在那之前座位表也不會顯示誰死
    g.day.pendingDeaths = list;
    g.log.push({ day: g.dayNo, text: '天亮請睜眼。請上警的玩家發言、選出警長，之後由主機公布昨晚死訊。' });
    say(g, ['dawn']);
    return { ...room, phase: 'day', game: g };
  }
  for (const s of list) kill(g, s, { poisoned: s === n.witchPoison });
  note(g, ['dawn', ...deathClips(list)]);
  return checkWin({ ...room, phase: 'day', game: g });
}

// 主機：警長選完了，公布昨晚死訊
export function announceDeaths(room) {
  if (room.phase !== 'day' || !room.game.day?.pendingDeaths) return fail('現在沒有要公布的死訊');
  const g = structuredClone(room.game);
  const list = g.day.pendingDeaths;
  for (const s of list) kill(g, s, { poisoned: s === g.day.poisoned });
  g.day.pendingDeaths = null;
  note(g, deathClips(list));
  return ok(checkWin({ ...room, game: g }));
}

const pendingBlock = room => (room.game.day?.pendingDeaths ? fail('請先公布昨晚死訊') : null);

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
    note(g, [seatKey(seat), 'shootTook', seatKey(target), 'end']);
  }
  return ok(checkWin({ ...room, game: g }));
}

export function exile(room, target) {
  if (room.phase !== 'day') return fail('現在不是白天');
  const blocked = pendingBlock(room); if (blocked) return blocked;
  if (room.game.day.exileDone) return fail('今天已經放逐過了');
  const g = structuredClone(room.game);
  target = Number(target ?? 0);
  g.day.exileDone = true;
  if (!target) note(g, ['tie']);
  else {
    if (!g.alive[target]) return fail('只能放逐活著的人');
    if (g.roles[target] === 'idiot' && !g.idiotRevealed.includes(target)) {
      g.idiotRevealed.push(target);
      note(g, [seatKey(target), 'idiotFlip']);
    } else {
      kill(g, target);
      note(g, [seatKey(target), 'exiled']);
    }
  }
  return ok(checkWin({ ...room, game: g }));
}

export function duel(room, clientId, target) {
  if (room.phase !== 'day') return fail('只有白天能決鬥');
  const blocked = pendingBlock(room); if (blocked) return blocked;
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
    note(g, ['knight', seatKey(seat), 'duelWith', seatKey(target), 'colon', seatKey(target), 'duelWolf']);
  } else {
    kill(g, seat);
    note(g, ['knight', seatKey(seat), 'duelWith', seatKey(target), 'colon', seatKey(target), 'duelGood']);
  }
  return ok(checkWin({ ...room, game: g }));
}

export function nextNight(room, now) {
  if (room.phase !== 'day') return fail('現在不是白天');
  const blocked = pendingBlock(room); if (blocked) return blocked;
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
  note(g, [w === 'good' ? 'goodWin' : 'wolfWin']);
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
    // 第一天死訊還沒公布時，座位表照「昨晚之前」顯示（kill 還沒套用，所以 alive 本來就是舊的）
    alive: g.alive,
    idiotRevealed: g.idiotRevealed,
    narration: g.narration ?? null,
    log: g.log.slice(-30),
    winner: g.winner,
    exileDone: g.day?.exileDone ?? false,
    deathsPending: Boolean(g.day?.pendingDeaths),
    // 夜裡只公開「現在輪到哪個角色、第幾句台詞」（本來就唸出來了），不公開死活與進度
    night: g.night ? { step: curStep(g.night) ?? null, beat: g.night.beat, openedAt: g.night.openedAt } : null,
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
  if (room.phase === 'day' && !g.day?.pendingDeaths) {
    if (g.canShoot.includes(seat)) me.canShoot = true;
    if (role === 'knight' && g.alive[seat] && !g.knightUsed) me.canDuel = true;
  }
  const n = g.night;
  if (room.phase === 'night' && n?.stage === 'acting' && g.alive[seat] && actors(g, curStep(n)).includes(seat)) {
    const act = curBeat(room, n).act;
    if (act === 'guard') me.action = { kind: 'guard', lastGuard: g.lastGuard };
    if (act === 'wolf') me.action = { kind: 'wolf', votes: n.wolfVotes, proposal: n.wolfProposal };
    if (act === 'witchSave') me.action = {
      kind: 'witchSave',
      victim: g.potions.save ? n.wolfTarget : null, // 解藥用掉之後就不告知死亡號碼
      canSave: g.potions.save && Boolean(n.wolfTarget) && (n.wolfTarget !== seat || witchMaySaveSelf(room.setup.rules, g.dayNo)),
      selfBlocked: g.potions.save && n.wolfTarget === seat && !witchMaySaveSelf(room.setup.rules, g.dayNo),
      saveUsedUp: !g.potions.save,
    };
    if (act === 'witchPoison') me.action = { kind: 'witchPoison', canPoison: g.potions.poison && !n.witchSave, savedTonight: n.witchSave, poisonUsedUp: !g.potions.poison };
    if (act === 'seer') me.action = { kind: 'seer', checked: n.seerTarget ? g.seerChecks.at(-1) : null };
    if (act === 'hunter') me.action = { kind: 'hunter', canShoot: n.witchPoison !== seat };
  }
  return me;
}
