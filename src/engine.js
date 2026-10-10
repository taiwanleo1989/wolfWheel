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
export const SKILL_MS = 30000;  // 被動技能（獵人／狼王開槍、白癡翻牌）限時；時間到沒按＝棄權（Leo 2026-10-10）。夜裡的步驟不限時
export const SKIP_MS = 30000;   // 夜裡角色睜眼這麼久之後，主機才能按「跳過」（防手機沒電卡死）

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

// silent：「天黑請閉眼」白天已經唸過了（騎士撞到狼），這裡不再唸一次，只等大家閉好眼
function beginNight(room, now, { silent = false } = {}) {
  const g = room.game;
  const c = room.setup.counts;
  const steps = NIGHT_ORDER.filter(step => (step === 'wolf' ? (c.wolf ?? 0) + (c.king ?? 0) > 0 : (c[step] ?? 0) > 0));
  if (g.dayNo === 1 && room.setup.rules.police !== false) steps.push('police'); // 第一晚最後：上警（設定可關）
  g.night = { steps, idx: -1, beat: 0, stage: 'intro', next: null, openedAt: null, wolfVotes: {}, wolfProposal: null, wolfTarget: null, guardTarget: null, witchSave: false, witchPoison: null, seerTarget: null };
  g.canShoot = [];
  g.day = null;
  if (!silent) say(g, ['nightStart']);
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
  if (n.idx >= n.steps.length) return dawn({ ...room, game: g }, now, room.game.narration?.seq);
  openBeat(room, g, now, rand);
  return { ...room, game: g };
}

// 鬧鐘到了：往下一步走（白天的鬧鐘＝被動技能 30 秒到期，見 dayTimeout）
export function advance(room, now, rand) {
  if (!room.game?.timer || now < room.game.timer.at) return ok(room);
  if (room.phase === 'day') return ok(dayTimeout(room, now));
  if (room.phase !== 'night') return ok(room);
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

// 主機：上警時「大家都起立好了，天亮」；角色的步驟要等這句台詞唸出（角色睜眼）SKIP_MS 之後才能跳過＝當作沒有動作。
// Leo 2026-10-10：防手機沒電卡死。每個角色、活的死的都同一套：按鈕一律睜眼就出現（灰的）、30 秒才能按；
// 死掉的角色假等預設最多 15 秒，按鈕亮不起來，所以不會比「這一步拖多久」多洩漏任何東西；
// 假等設成超過 30 秒時，死的角色也一樣 30 秒後能跳過——活的死的仍是同一套，照樣看不出差別
export function skipStep(room, now, rand) {
  if (room.phase !== 'night' || room.game.night.stage !== 'acting') return fail('現在沒有可以跳過的步驟');
  const n = room.game.night;
  if (curStep(n) !== 'police' && now - n.openedAt < SKIP_MS) return fail('睜眼 30 秒後才能跳過');
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

function dawn(room, now, seq0) {
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
  armDay(g, now);
  return checkWin({ ...room, phase: 'day', game: g }, seq0);
}

// 主機：警長選完了，公布昨晚死訊
export function announceDeaths(room, now = 0) {
  if (room.phase !== 'day' || !room.game.day?.pendingDeaths) return fail('現在沒有要公布的死訊');
  const g = structuredClone(room.game);
  const list = g.day.pendingDeaths;
  for (const s of list) kill(g, s, { poisoned: s === g.day.poisoned });
  g.day.pendingDeaths = null;
  note(g, deathClips(list));
  armDay(g, now);
  return ok(checkWin({ ...room, game: g }, room.game.narration?.seq));
}

const pendingBlock = room => (room.game.day?.pendingDeaths ? fail('請先公布昨晚死訊')
  : room.game.day?.idiotChoice ? fail('請等被放逐的玩家選擇') : null);

/* ───────── 白天 ───────── */
// 被動技能限時：可以開槍的人、被放逐還沒選的白癡，各自從拿到技能那一刻起算 SKILL_MS，用房間鬧鐘計時
// day.due = { [座位]: 到期時間, idiot: 到期時間 }；game.timer＝最早到期的那個
function armDay(g, now) {
  if (!g.day) return;
  const due = (g.day.due ??= {});
  for (const k of Object.keys(due)) if (k === 'idiot' ? !g.day.idiotChoice : !g.canShoot.includes(Number(k))) delete due[k];
  for (const s of g.canShoot) due[s] ??= now + SKILL_MS;
  if (g.day.idiotChoice) due.idiot ??= now + SKILL_MS;
  const ats = Object.values(due);
  g.timer = ats.length ? { at: Math.min(...ats) } : null;
}

// 30 秒到了：沒開槍＝不發動；白癡沒選＝不翻牌、出局。不唸「誰放棄了」，免得洩漏身分
function dayTimeout(room, now) {
  const g = structuredClone(room.game);
  const seq0 = g.narration?.seq;
  const due = g.day?.due ?? {};
  const expired = k => (due[k] ?? Infinity) <= now;
  const shooters = g.canShoot.length;
  g.canShoot = g.canShoot.filter(s => !expired(s));
  if (g.canShoot.length < shooters) callNightIfReady(room, g, seq0);
  if (g.day?.idiotChoice && expired('idiot')) resolveIdiot(g, false);
  armDay(g, now);
  return checkWin({ ...room, game: g }, seq0);
}

// 騎士撞到狼王那天：最後一槍開完（或放棄）才唸「天黑請閉眼」
function callNightIfReady(room, g, seq0) {
  if (g.day?.nightCalled && !g.canShoot.length && !winnerOf(g, room.setup.counts, room.setup.rules)) {
    say(g, [...(g.narration.seq > seq0 ? g.narration.clips : []), 'nightStart']);
  }
}

export function shoot(room, clientId, target, now = 0) {
  if (room.phase !== 'day') return fail('現在不能開槍');
  const seat = L.seatOf(room, clientId);
  if (!seat || !room.game.canShoot.includes(seat)) return fail('你現在不能開槍');
  const g = structuredClone(room.game);
  g.canShoot = g.canShoot.filter(s => s !== seat);
  target = Number(target ?? 0);
  if (target) {
    if (!g.alive[target] || target === seat) return fail('只能帶走活著的其他玩家');
    kill(g, target); // 被槍帶走的獵人／狼王也可以再開槍
    // 主機只唸「7 號發動技能。」（帶走誰由開槍的人自己說）；紀錄寫完整
    g.log.push({ day: g.dayNo, text: `${seat} 號發動技能，帶走了 ${target} 號。` });
    say(g, [seatKey(seat), 'shootSkill']);
  }
  const seq0 = room.game.narration?.seq;
  callNightIfReady(room, g, seq0);
  armDay(g, now);
  return ok(checkWin({ ...room, game: g }, seq0));
}

export function exile(room, target, now = 0) {
  if (room.phase !== 'day') return fail('現在不是白天');
  const blocked = pendingBlock(room); if (blocked) return blocked;
  if (room.game.day.nightCalled) return fail('騎士撞到狼人，今天直接天黑，不放逐');
  if (room.game.day.exileDone) return fail('今天已經放逐過了');
  const g = structuredClone(room.game);
  target = Number(target ?? 0);
  g.day.exileDone = true;
  if (!target) note(g, ['tie']);
  else {
    if (!g.alive[target]) return fail('只能放逐活著的人');
    // 還沒翻過牌的白癡：由他自己的手機選要不要翻牌（Leo 2026-10-10）；選之前主機不唸結果；30 秒沒選＝出局
    if (g.roles[target] === 'idiot' && !g.idiotRevealed.includes(target)) {
      g.day.idiotChoice = target;
      armDay(g, now);
      return ok({ ...room, game: g });
    }
    kill(g, target);
    note(g, [seatKey(target), 'exiled']);
  }
  armDay(g, now);
  return ok(checkWin({ ...room, game: g }, room.game.narration?.seq));
}

// 被放逐的白癡：flip＝翻牌免死（之後不能投票）；不翻＝照常出局
function resolveIdiot(g, flip) {
  const seat = g.day.idiotChoice;
  g.day.idiotChoice = null;
  if (flip) {
    g.idiotRevealed.push(seat);
    note(g, [seatKey(seat), 'idiotFlip']);
  } else {
    kill(g, seat);
    note(g, [seatKey(seat), 'exiled']);
  }
}

// 只有白癡本人能選；主機不能代按（Leo 2026-10-10：手機沒電就當棄權，30 秒後自動出局）
export function idiotChoose(room, clientId, flip, now = 0) {
  if (room.phase !== 'day' || !room.game.day?.idiotChoice) return fail('現在不用選');
  if (L.seatOf(room, clientId) !== room.game.day.idiotChoice) return fail('不是你要選');
  const g = structuredClone(room.game);
  resolveIdiot(g, Boolean(flip));
  armDay(g, now);
  return ok(checkWin({ ...room, game: g }, room.game.narration?.seq));
}

export function duel(room, clientId, target, now = 0) {
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
    // 撞到狼：狼出局，今天不放逐，直接唸「天黑請閉眼」；主機按「進入黑夜」才開始夜晚（Leo 2026-10-10）
    // 撞到狼王：狼王先開槍，開完才唸「天黑請閉眼」（見 shoot）
    kill(g, target);
    const over = winnerOf(g, room.setup.counts, room.setup.rules);
    g.day.nightCalled = !over;
    note(g, ['knight', seatKey(seat), 'duelWith', seatKey(target), 'colon', seatKey(target), 'duelWolf', ...(over || g.canShoot.length ? [] : ['nightStart'])]);
  } else {
    // 撞到好人：騎士出局，白天繼續發言、投票
    kill(g, seat);
    note(g, ['knight', seatKey(seat), 'duelWith', seatKey(target), 'colon', seatKey(target), 'duelGood']);
  }
  armDay(g, now);
  return ok(checkWin({ ...room, game: g }, room.game.narration?.seq));
}

export function nextNight(room, now) {
  if (room.phase !== 'day') return fail('現在不是白天');
  const blocked = pendingBlock(room); if (blocked) return blocked;
  const g = structuredClone(room.game);
  // 「天黑請閉眼」剛唸過就不重唸；狼王還沒開槍主機就按了，那就照常唸
  const silent = Boolean(g.day?.nightCalled) && g.narration?.clips.at(-1) === 'nightStart';
  g.dayNo++;
  return ok(beginNight({ ...room, game: g }, now, { silent }));
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

// seq0：這個動作開始前的台詞序號。動作自己剛唸的那句（例如「3 號被放逐出局。」）要和「遊戲結束」接在同一句，
// 不然主機只會收到最後一句，前一句就沒唸到
function checkWin(room, seq0) {
  const g = room.game;
  const w = winnerOf(g, room.setup.counts, room.setup.rules);
  if (!w) return room;
  g.winner = w;
  g.timer = null;
  g.canShoot = [];
  const win = w === 'good' ? 'goodWin' : 'wolfWin';
  const before = g.narration && seq0 !== undefined && g.narration.seq > seq0 ? g.narration.clips : [];
  g.log.push({ day: g.dayNo, text: lineText([win]) });
  say(g, [...before, win]);
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
    nightCalled: Boolean(g.day?.nightCalled),
    idiotChoice: g.day?.idiotChoice ?? null, // 等這個號碼選要不要翻牌（Leo 拍板：只有白癡會出現這個等待）
    // 夜裡只公開「現在輪到哪個角色、第幾句台詞」（本來就唸出來了），不公開死活與進度
    // eyesOpen：這句台詞唸出後到「X 請閉眼」之前（動作中＋做完後的停頓都算，免得從按鈕消失的時間看出角色做完了）
    night: g.night ? { step: curStep(g.night) ?? null, beat: g.night.beat, openedAt: g.night.openedAt, eyesOpen: ['acting', 'pause'].includes(g.night.stage) } : null,
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
    if (g.canShoot.includes(seat)) me.canShoot = true; // 限時 SKILL_MS，畫面上寫「30 秒內沒選＝不發動」
    if (g.day?.idiotChoice === seat) me.idiotChoose = true;
    else if (role === 'knight' && g.alive[seat] && !g.knightUsed && !g.day?.idiotChoice) me.canDuel = true;
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
