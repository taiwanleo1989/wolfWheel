// 對局引擎：黑夜 → 天亮 → 白天 → 黑夜 … → 結束。純函式：輸入房間與時間，回傳新房間。
// 時間相關的動作（假等、停頓）用 game.timer = { at } 交給房間的鬧鐘，到時呼叫 advance()。
//
// 黑夜照 Leo 的手稿（2026-10-08）：守衛 → 狼人 → 女巫（解藥、毒藥兩段）→ 預言家 → 獵人 →（第一晚）上警 → 天亮。
// 2026-10-13 加五個角色，插進手稿的順序：狼人之後狼美人、預言家之後石像鬼、守墓人（第二晚起）；白狼王、隱狼沒有自己的一步。
// 2026-10-17 獵人之後加狼王的帶槍手勢；2026-10-27 Leo 拿掉（狼王夜裡不再有帶槍手勢這一步，scriptFor 的 'king' 留給舊房間）。
// 2026-10-28 隱狼有自己的一步（狼美人之後、女巫之前）：其他狼都出局、只剩隱狼時，他在這一步單獨刀人；不然假等（見 actors）。
// 每個角色＝一段「劇本」：幾句台詞（beat），每句台詞配一個要等的動作，最後一句閉眼。
// 主機只唸台詞，絕不唸號碼——手稿裡「上帝手比號碼」的部分只出現在當事人的手機上。
//
// room.phase：'night' | 'day' | 'ended'（之前是 'lobby'、'deal'，見 game.js）
// room.game（秘密，除了每支手機自己的部分之外，不會原樣送出）：
//   roles, acked, alive{座位:bool}, dayNo, potions{save,poison}, lastGuard, idiotRevealed[],
//   seerChecks[{day,target,wolf}], gargoyleChecks[{day,target,role}], graveChecks[{day,seat,wolf}],
//   charm（狼美人最近一晚魅惑的座位）, graveInfo{day,seat,wolf}（最近一次投票放逐出局的人）,
//   canShoot[], knightUsed, log[{day,text}], narration{seq,text},
//   night{steps,idx,beat,stage,next,openedAt,wolfVotes,wolfProposal,wolfTarget,guardTarget,witchSave,witchPoison,seerTarget,charmTarget,gargoyleTarget},
//   day{exileDone,pendingDeaths,noSkill[],nightCalled,nightReason,vote}, winner, timer{at},
//   sheriff（警長座位，主機登記）, badgeTorn（警徽撕掉了）, badgePending（警長出局、等主機移交或撕掉警徽）
//   day.vote{round,open,candidates[],voters[],ballots{座位:目標,0＝棄票},result}（玩家在手機上按號碼投票，2026-10-27）
import * as L from './lobby.js';
import * as R from '../public/shared/roles.js';
import { lineText, seatKey } from '../public/shared/voice-lines.js';

export const NIGHT_ORDER = ['guard', 'wolf', 'beauty', 'hidden', 'witch', 'seer', 'gargoyle', 'gravekeeper', 'hunter'];

// 劇本：每個角色的台詞（照手稿字句）。act＝這句台詞之後等誰做什麼；null＝不等人，固定等一段時間；
// again＝太久沒操作時重唸的句子（沒寫＝整句重唸）
export function scriptFor(step, counts) {
  switch (step) {
    case 'guard': return { beats: [{ say: ['guardOpen'], act: 'guard' }], close: ['guardClose'] };
    // 狼人溝通比較久，重唸只問「狼人今晚要擊殺的目標是？」（Leo 2026-10-17）
    case 'wolf': return { beats: [{ say: [(counts.king ?? 0) > 0 ? 'wolfOpenKing' : 'wolfOpen'], act: 'wolf', again: ['wolfAsk'] }], close: ['wolfClose'] };
    case 'witch': return {
      beats: [{ say: ['witchSave'], act: 'witchSave' }, { say: ['witchPoison'], act: 'witchPoison' }],
      close: ['witchClose'],
    };
    case 'seer': return { beats: [{ say: ['seerOpen'], act: 'seer' }], close: ['seerClose'] };
    case 'beauty': return { beats: [{ say: ['beautyOpen'], act: 'beauty' }], close: ['beautyClose'] };
    // 隱狼刀人跟狼人同一套動作（act 'wolf'），但主機只唸睜眼、閉眼，不唸「要擊殺的目標是？」——提示只寫在隱狼手機上（Leo 2026-10-28）；
    // 太久沒刀就重唸「隱狼請睜眼。」
    case 'hidden': return { beats: [{ say: ['hiddenOpen'], act: 'wolf' }], close: ['hiddenClose'] };
    case 'gargoyle': return { beats: [{ say: ['gargoyleOpen'], act: 'gargoyle' }], close: ['gargoyleClose'] };
    case 'gravekeeper': return { beats: [{ say: ['graveOpen'], act: 'grave' }], close: ['graveClose'] };
    case 'hunter': return { beats: [{ say: ['hunterOpen'], act: 'hunter' }], close: ['hunterClose'] };
    case 'king': return { beats: [{ say: ['kingOpen'], act: 'king' }], close: ['kingClose'] };
    case 'police': return { beats: [{ say: ['police'], act: null }], close: null };
  }
}

export const INTRO_MS = 5000;   // 「天黑請閉眼」之後，等大家閉好眼
export const CLOSE_MS = 4000;   // 「X 請閉眼」之後，到下一個角色睜眼
export const POLICE_MS = 5000;  // 「要上警的玩家請起立」之後等大家起立（主機可以提早按繼續）；Leo 2026-10-17 嫌長，12 → 6 秒；2026-10-28 再改 5 秒
export const PAUSE_MS = [2000, 5000]; // 每句台詞的動作完成後，隨機停一下才唸下一句
export const SKIP_MS = 25000;   // 夜裡角色睜眼這麼久之後，主機才能按「跳過」（防手機沒電卡死）；Leo 2026-10-27 夜裡等太久，30 → 25 秒
// 白天的被動技能（獵人／狼王開槍、白癡翻牌、騎士決鬥）一律不限時、沒有任何倒數（Leo 2026-10-10、10-11）

// 夜裡角色這麼久沒操作，主機就把這句台詞再唸一次（Leo 2026-10-11：先 20 秒，同日改 15 秒；2026-10-17 改 30 秒；
// 2026-10-27 夜裡等太久、減 5 秒 → 25 秒）。
// 死掉的角色不會重唸：假等最長 24 秒（R.FAKE_WAIT_CAP），一定比 25 秒短（Leo 2026-10-27 選 A：實玩死掉的神職重唸，
// 大家以為在等死人按、像卡住）。代價：聽到重唸＝那個角色還活著。下面「假等中重唸」的程式留著給上線前開的舊房間
export const REPEAT_MS = 25000;

// 現在的鬧鐘只是「重唸」（在等活著的角色）？房間用它判斷：主機不在線上就不用重唸（沒人出聲），改回閒置清房
export const waitingForPeople = room => room.phase === 'night' && room.game?.night?.stage === 'acting' && room.game.night.wait === 'people';
// 這一下鬧鐘是不是「重唸」：等活著的角色；或死掉的角色假等還沒結束（到 fakeEnd 那一下是假等結束，不是重唸）
export const repeatDue = (room, now) => waitingForPeople(room)
  || (room.phase === 'night' && room.game?.night?.stage === 'acting' && room.game.night.wait === 'fake' && now < room.game.night.fakeEnd);
// 主機不在線上就不重唸——活的、死的同一套（2026-10-22 驗測：本來死掉的角色照樣重唸，主機重連時馬上補唸＝洩漏他死了）。
// 死掉的角色只拿掉重唸，假等照樣在 fakeEnd 結束（跟活人在主機離線時按完一樣）
export function pauseRepeat(room) {
  const n = room.game.night;
  return { ...room, game: { ...room.game, timer: n?.wait === 'fake' ? { at: n.fakeEnd } : null, night: n && { ...n, repeatPaused: true } } };
}
export function resumeRepeat(room, now) {
  const n = room.game?.night;
  if (waitingForPeople(room) && !room.game.timer) return { ...room, game: { ...room.game, timer: { at: now + REPEAT_MS } } };
  if (room.phase === 'night' && n?.stage === 'acting' && n.wait === 'fake' && n.repeatPaused && now < n.fakeEnd) {
    return { ...room, game: { ...room.game, timer: { at: Math.min(n.fakeEnd, now + REPEAT_MS) }, night: { ...n, repeatPaused: false } } };
  }
  return room;
}

const ok = room => ({ ok: true, room });
const fail = error => ({ ok: false, error });
const isWolfRole = role => R.ROLES[role].team === 'wolf';
const isPackRole = role => isWolfRole(role) && !R.LONE_WOLVES.includes(role); // 晚上睜眼一起殺人的狼
// 其他狼（隱狼以外）都出局了：隱狼接手刀人（Leo 2026-10-28「現形」）
const onlyHiddenLeft = g => !seatsList(g).some(s => g.alive[s] && isWolfRole(g.roles[s]) && g.roles[s] !== 'hidden');
// 預言家、守墓人看到的「是不是狼」：隱狼顯示好人，接手刀人之後顯示狼人（Leo 2026-10-28）；騎士決鬥照真實陣營
const looksWolf = (g, seat) => isWolfRole(g.roles[seat]) && (g.roles[seat] !== 'hidden' || onlyHiddenLeft(g));
const between = (rand, [lo, hi]) => lo + rand(hi - lo + 1);
const seatsList = g => Object.keys(g.roles).map(Number).sort((a, b) => a - b);

// 台詞用片段組成（public/shared/voice-lines.js）：clips 給主機播錄好的聲音，text 給畫面與紀錄
function say(g, clips) { g.narration = { seq: (g.narration?.seq ?? 0) + 1, text: lineText(clips), clips }; }
function note(g, clips) { g.log.push({ day: g.dayNo, text: lineText(clips) }); say(g, clips); }

// 「狼人請睜眼」那步一起殺人的狼：活著的狼隊；狼隊全部出局後換石像鬼。
// 隱狼不參與（Leo 2026-10-28 取代 10-27 的「隱狼一起投刀」）：其他狼都出局、只剩隱狼時，他在自己那步（'hidden'）單獨刀人
export function killers(g) {
  const alive = seatsList(g).filter(s => g.alive[s] && isWolfRole(g.roles[s]) && g.roles[s] !== 'hidden');
  const pack = alive.filter(s => isPackRole(g.roles[s]));
  return pack.length ? pack : alive;
}

// 某一步要誰動作（只算活著的）：狼人那步是 killers；隱狼那步只有「只剩隱狼」時才是他（其他時候假等，聽不出差別）；
// 上警不等任何人；其他是那個角色本人
export function actors(g, step) {
  if (step === 'police') return [];
  if (step === 'wolf') return killers(g);
  if (step === 'hidden' && !onlyHiddenLeft(g)) return [];
  return seatsList(g).filter(s => g.roles[s] === step && g.alive[s]);
}

// 這支手機看得到的狼隊友：狼隊互相認得；隱狼單向認得狼隊；石像鬼誰都不認得；
// 狼隊死光、隱狼石像鬼開始一起殺人時，彼此晚上會見面
function wolfMates(g, seat) {
  const role = g.roles[seat];
  const pack = seatsList(g).filter(s => isPackRole(g.roles[s]));
  const set = new Set(role === 'gargoyle' ? [seat] : role === 'hidden' ? [...pack, seat] : pack);
  // 隱狼、石像鬼不見面（Leo 2026-10-28：石像鬼先刀，只剩隱狼時隱狼才刀）
  return [...set].sort((a, b) => a - b).map(s => ({ seat: s, king: g.roles[s] === 'king', alive: g.alive[s] }));
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
    seerChecks: [], gargoyleChecks: [], graveChecks: [], charm: null, graveInfo: null,
    canShoot: [], knightUsed: false, log: [], winner: null, sheriff: null, badgeTorn: false, badgePending: false, badgeChosen: false,
  });
  return ok(beginNight({ ...room, game: g }, now));
}

// silent：「天黑請閉眼」白天已經唸過了（騎士撞到狼），這裡不再唸一次，只等大家閉好眼
function beginNight(room, now, { silent = false } = {}) {
  const g = room.game;
  const c = room.setup.counts;
  const wolfCount = R.ROLE_ORDER.filter(id => R.ROLES[id].team === 'wolf').reduce((a, id) => a + (c[id] ?? 0), 0);
  // 守墓人從第二晚開始（第一晚還沒有人被放逐，大家都知道，不用唸）；板子上的狼只有隱狼時不唸「狼人請睜眼」（隱狼自己那步刀）
  const steps = NIGHT_ORDER.filter(step => (step === 'wolf' ? wolfCount > (c.hidden ?? 0)
    : step === 'gravekeeper' ? g.dayNo > 1 && (c.gravekeeper ?? 0) > 0 : (c[step] ?? 0) > 0));
  if (g.dayNo === 1 && room.setup.rules.police !== false) steps.push('police'); // 第一晚最後：上警（設定可關）
  g.night = { steps, idx: -1, beat: 0, stage: 'intro', next: null, openedAt: null, wolfVotes: {}, wolfProposal: null, wolfTarget: null, guardTarget: null, witchSave: false, witchPoison: null, seerTarget: null, charmTarget: null, gargoyleTarget: null };
  g.canShoot = [];
  g.day = null;
  if (!silent) say(g, ['nightStart']);
  g.timer = { at: now + INTRO_MS };
  return { ...room, phase: 'night' };
}

const curStep = n => n.steps[n.idx];
const curBeat = (room, n) => scriptFor(curStep(n), room.setup.counts).beats[n.beat];

// 唸一句台詞並開始等：活著的人會在手機上動作（太久沒操作就重唸）；沒人（死了、或上警）就計時
// night.wait：'people'＝等活著的人｜'fake'＝死掉的角色假等｜'police'＝上警
function openBeat(room, g, now, rand) {
  const n = g.night;
  const beat = curBeat(room, n);
  n.stage = 'acting';
  n.openedAt = now;
  n.repeatPaused = false;
  say(g, beat.say);
  if (beat.act === null) { n.wait = 'police'; g.timer = { at: now + POLICE_MS }; }
  else if (actors(g, curStep(n)).length === 0) {
    n.wait = 'fake';
    // 假等一個角色只抽一次（預設 8～25 秒），有好幾句台詞的（女巫：解藥、毒藥）分給每一句——不然死掉的女巫等兩次、
    // 最長快 100 秒，比別的角色長一倍（Leo 2026-10-22 實玩：一直重唸「女巫請睜眼」像卡住，選方案 1）
    const left = scriptFor(curStep(n), room.setup.counts).beats.length - n.beat; // 含這一句還剩幾句
    const cap = v => Math.min(R.FAKE_WAIT_CAP, v); // 上線前開的房間可能還存著 45、60 秒
    if (n.beat === 0 || n.fakeLeft == null) n.fakeLeft = between(rand, [cap(room.setup.rules.fakeWaitMin), cap(room.setup.rules.fakeWaitMax)]);
    const sec = left > 1 ? between(rand, [1, n.fakeLeft - (left - 1)]) : n.fakeLeft;
    n.fakeLeft -= sec;
    n.fakeEnd = now + 1000 * sec;
    g.timer = { at: Math.min(n.fakeEnd, now + REPEAT_MS) };
  } else { n.wait = 'people'; g.timer = { at: now + REPEAT_MS }; }
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

// 鬧鐘到了：往下一步走（只有夜裡有鬧鐘；白天沒有任何倒數）
export function advance(room, now, rand) {
  if (!room.game?.timer || now < room.game.timer.at) return ok(room);
  if (room.phase !== 'night') return ok({ ...room, game: { ...room.game, timer: null } });
  const g = structuredClone(room.game);
  const n = g.night;
  g.timer = null;
  if (n.stage === 'intro' || n.stage === 'closed') return ok(nextStep(room, g, now, rand));
  // 太久沒操作（活著的角色；或死掉的角色假等還沒結束）：再唸一次這句台詞，繼續等
  if (n.stage === 'acting' && (n.wait === 'people' || (n.wait === 'fake' && now < n.fakeEnd))) {
    const beat = curBeat(room, n);
    say(g, beat.again ?? beat.say);
    g.timer = { at: n.wait === 'fake' ? Math.min(n.fakeEnd, now + REPEAT_MS) : now + REPEAT_MS };
    return ok({ ...room, game: g });
  }
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
//   seer  { target } 或 { done:true }          hunter { seen:true }      king { seen:true }
//   beauty { target }（0＝今晚不魅惑）          gargoyle { target } 或 { done:true }      grave { seen:true }
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
      if (target && g.roles[target] === 'beauty') return fail('狼美人不能被自刀'); // Leo 2026-10-27
      night.wolfVotes[seat] = target;
      // 所有「在線上、還活著」的狼都選同一個，才出現「是否正確」的確認（隱狼那步只有他自己）
      const voters = actors(g, step).filter(s => online.has(room.seats[s]));
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
      g.seerChecks.push({ day: g.dayNo, target, wolf: looksWolf(g, target) });
    }
  } else if (act === 'beauty') {
    if (target && (!aliveTarget(target) || target === seat)) return fail('請選一個活著的其他玩家');
    // g.charm 這時還是前一晚魅惑的人（天亮才換成今晚的）；Leo 2026-10-27：不能連續兩晚魅惑同一位
    if (target && target === g.charm) return fail('不能連續兩晚魅惑同一位玩家');
    night.charmTarget = target || null;
    endBeat(room, g, now, rand);
  } else if (act === 'gargoyle') {
    if (payload?.done) {
      if (!night.gargoyleTarget) return fail('還沒查驗');
      endBeat(room, g, now, rand);
    } else {
      if (night.gargoyleTarget) return fail('今晚已經查驗過了');
      if (!aliveTarget(target) || target === seat) return fail('請選一個活著的其他玩家');
      night.gargoyleTarget = target;
      g.gargoyleChecks.push({ day: g.dayNo, target, role: g.roles[target] });
    }
  } else if (act === 'grave') {
    const info = graveFor(g);
    if (info) g.graveChecks.push(info);
    endBeat(room, g, now, rand);
  } else if (act === 'hunter' || act === 'king') {
    endBeat(room, g, now, rand);
  } else return fail('現在不用動作');
  // 有操作但這句還沒做完（狼人投票中、預言家看結果）：重唸的倒數從這次操作重新算
  if (night.stage === 'acting') g.timer = { at: now + REPEAT_MS };
  return ok({ ...room, game: g });
}

// 主機：上警時「大家都起立好了，天亮」；角色的步驟要等這句台詞唸出（角色睜眼）SKIP_MS 之後才能跳過＝當作沒有動作。
// Leo 2026-10-10：防手機沒電卡死。每個角色、活的死的都同一套：按鈕一律睜眼就出現（灰的）、SKIP_MS（25 秒）後才能按；
// 死掉的角色假等最長 24 秒，按鈕還沒能按就往下走了——活的死的同一套，看不出差別
export function skipStep(room, now, rand) {
  if (room.phase !== 'night' || room.game.night.stage !== 'acting') return fail('現在沒有可以跳過的步驟');
  const n = room.game.night;
  if (curStep(n) !== 'police' && now - n.openedAt < SKIP_MS) return fail(`睜眼 ${SKIP_MS / 1000} 秒後才能跳過`);
  const g = structuredClone(room.game);
  endBeat(room, g, now, rand);
  return ok({ ...room, game: g });
}

// 守墓人今晚看到的：前一個白天被投票放逐出局的人（沒有＝null）
const graveFor = g => (g.graveInfo && g.graveInfo.day === g.dayNo - 1 ? { ...g.graveInfo } : null);

/* ───────── 天亮 ───────── */
// noSkill：被毒死、殉情出局的獵人／狼王不能開槍
function kill(g, seat, { noSkill = false } = {}) {
  if (!g.alive[seat]) return;
  g.alive[seat] = false;
  const role = g.roles[seat];
  if ((role === 'hunter' || role === 'king') && !noSkill) g.canShoot.push(seat);
  if (seat === g.sheriff) g.badgePending = true; // 警長出局：由他自己選移交或撕掉警徽（Leo 2026-10-27，見 passBadge）
}

// 白天出局（放逐、被槍帶走、被白狼王帶走）：狼美人出局時，她最近一晚魅惑的人跟著殉情（不能發動技能）。
// 回傳要接在台詞後面的「8 號殉情出局。」。被騎士撞死、被女巫毒死的狼美人技能被悶、不殉情（Leo 2026-10-27），
// 那兩種不走這裡（duel 用 kill；毒藥在 nightDeaths）
function dayKill(g, seat) {
  kill(g, seat);
  const c = g.charm;
  if (g.roles[seat] !== 'beauty' || !c || !g.alive[c]) return [];
  kill(g, c, { noSkill: true });
  return [seatKey(c), 'charmDied'];
}

// 昨晚死了誰：狼刀（同守同救也死）、毒藥；狼美人今晚被刀死，今晚魅惑的人殉情。noSkill＝不能開槍的。
// 2026-10-27 起狼隊不能刀狼美人、被毒死的狼美人不殉情，所以晚上其實不會殉情（被刀那條留給上線前開的房間）
function nightDeaths(g, n) {
  const deaths = new Set(), noSkill = new Set();
  if (n.wolfTarget) {
    const saved = n.witchSave, guarded = n.guardTarget === n.wolfTarget;
    if (saved === guarded) deaths.add(n.wolfTarget); // 都沒救＝死；同守同救＝也死
  }
  if (n.witchPoison) { deaths.add(n.witchPoison); noSkill.add(n.witchPoison); }
  const beautyDies = [...deaths].some(s => g.roles[s] === 'beauty' && s !== n.witchPoison);
  const c = n.charmTarget;
  if (beautyDies && c && g.alive[c] && !deaths.has(c)) { deaths.add(c); noSkill.add(c); }
  return { list: [...deaths].sort((a, b) => a - b), noSkill };
}

// 「昨晚死亡的是 9 號、10 號。」／「昨晚是平安夜。」
const deathClips = list => (list.length ? ['deathsAre', ...list.flatMap((s, i) => (i ? ['sep', seatKey(s)] : [seatKey(s)])), 'end'] : ['peace']);

function dawn(room, now, seq0) {
  const g = room.game;
  const n = g.night;
  const { list, noSkill } = nightDeaths(g, n);
  g.lastGuard = n.guardTarget;
  // 狼美人的魅惑一晚有效，每晚換新（死掉的狼美人假等，charmTarget 是 null）
  if (n.steps.includes('beauty')) g.charm = n.charmTarget;
  g.canShoot = [];
  const police = n.steps.includes('police');
  g.night = null;
  g.timer = null;
  g.day = { exileDone: false, pendingDeaths: null, noSkill: [...noSkill] };
  if (police) {
    // 第一天：先競選警長（口頭），主機按「公布昨晚死訊」才宣布——在那之前座位表也不會顯示誰死
    g.day.pendingDeaths = list;
    g.log.push({ day: g.dayNo, text: '天亮請睜眼。請上警的玩家發言、選出警長，之後由主機公布昨晚死訊。' });
    say(g, ['dawn']);
    return { ...room, phase: 'day', game: g };
  }
  for (const s of list) kill(g, s, { noSkill: noSkill.has(s) });
  note(g, ['dawn', ...deathClips(list)]);
  g.day.bindCheck = true; // 天亮睜眼：狼跟好人一樣多就綁票（見 checkWin）
  return checkWin({ ...room, phase: 'day', game: g }, seq0);
}

// 套用第一天還沒公布的死訊（主機按「公布昨晚死訊」；或警長競選中騎士撞到狼、狼人自爆，今天直接天黑時順便公布）。
// 回傳「昨晚死亡的是 9 號。」的片段
function flushPending(g) {
  const list = g.day.pendingDeaths;
  // 舊房間（2026-10-13 前開的局）只記了 poisoned
  const noSkill = g.day.noSkill ?? (g.day.poisoned ? [g.day.poisoned] : []);
  for (const s of list) kill(g, s, { noSkill: noSkill.includes(s) });
  g.day.pendingDeaths = null;
  g.day.bindCheck = true; // 第一天的「天亮睜眼」到公布死訊才算完
  return deathClips(list);
}

// 主機：警長選完了，公布昨晚死訊
export function announceDeaths(room, now = 0) {
  if (room.phase !== 'day' || !room.game.day?.pendingDeaths) return fail('現在沒有要公布的死訊');
  const g = structuredClone(room.game);
  note(g, flushPending(g));
  return ok(checkWin({ ...room, game: g }, room.game.narration?.seq));
}

// 等某個人選擇的那一下（白癡翻不翻、警長出局後主機移交或撕掉警徽）：放逐、投票、技能都先等
const waitBlock = room => (room.game.day?.idiotChoice ? fail('請等被放逐的玩家選擇')
  : room.game.badgePending ? fail('請先移交或撕掉警徽') : null);
const pendingBlock = room => (room.game.day?.pendingDeaths ? fail('請先公布昨晚死訊') : waitBlock(room));

// 警長競選中（第一天死訊還沒公布）有人按騎士決鬥、自爆：先公布昨晚死訊（跟主機按「公布」一樣），再照公布後的死活判這個動作。
// 不能用「昨晚死的人沒有按鈕／按了被擋」——那等於死訊公布前就讓當事人知道誰死了（2026-10-27 審查）。
// 動作被擋（自己昨晚死了、目標昨晚死了、有人要開槍）＝死訊照樣公布、動作不算；公布死訊和動作接在同一句唸
function afterDeaths(room, run) {
  if (room.phase !== 'day' || !room.game.day?.pendingDeaths) return run(room);
  const a = announceDeaths(room).room;
  if (a.phase !== 'day') return { ok: false, error: '遊戲已經結束', room: a };
  const r = run(a);
  if (!r.ok) return { ...r, room: a };
  const n = r.room.game.narration, an = a.game.narration;
  if (n.seq > an.seq) r.room.game.narration = { seq: n.seq, clips: [...an.clips, ...n.clips], text: an.text + n.text };
  return r;
}

/* ───────── 白天 ───────── */
// 白天沒有任何倒數：開槍、白癡翻牌、騎士決鬥都一直等本人按（Leo 2026-10-10 拿掉 30 秒，10-11 連計時機制一起拆掉）

// 騎士撞到狼王（或白狼王帶走獵人／狼王）那天：最後一槍開完（或放棄）才唸「天黑請閉眼」。
// 自爆、被撞死、被帶走的是警長：也要等他選完移交或撕警徽（2026-10-28 審查：不然大家閉眼了警長還要看手機選）
function callNightIfReady(room, g, seq0) {
  if (g.day?.nightCalled && !g.canShoot.length && !g.badgePending
    && !winnerOf(g, room.setup.counts, room.setup.rules) && !houseRuleWin(g, room.setup.rules)) {
    say(g, [...(g.narration.seq > seq0 ? g.narration.clips : []), 'nightStart']);
  }
}

export function shoot(room, clientId, target, now = 0) {
  if (room.phase !== 'day') return fail('現在不能開槍');
  const seat = L.seatOf(room, clientId);
  if (!seat || !room.game.canShoot.includes(seat)) return fail('你現在不能開槍');
  if (room.game.day?.idiotChoice) return fail('請等被放逐的玩家選擇'); // 有槍時不能放逐（見 exile），照理到不了這裡
  if (room.game.badgePending && room.game.sheriff === seat) return fail('請先選要移交還是撕掉警徽'); // 出局的警長：先選警徽再開槍
  const g = structuredClone(room.game);
  g.canShoot = g.canShoot.filter(s => s !== seat);
  target = Number(target ?? 0);
  if (target) {
    if (!g.alive[target] || target === seat) return fail('只能帶走活著的其他玩家');
    const chain = dayKill(g, target); // 被槍帶走的獵人／狼王也可以再開槍
    // 主機唸「7 號發動技能，帶走了 4 號。」（Leo 2026-10-10 實玩：只唸發動技能聽不到誰死）
    note(g, [seatKey(seat), 'shootTook', seatKey(target), 'end', ...chain]);
  }
  const seq0 = room.game.narration?.seq;
  callNightIfReady(room, g, seq0);
  return ok(checkWin({ ...room, game: g }, seq0));
}

export function exile(room, target, now = 0) {
  if (room.phase !== 'day') return fail('現在不是白天');
  const blocked = pendingBlock(room); if (blocked) return blocked;
  if (room.game.day.nightCalled) return fail('今天直接天黑，不放逐');
  if (room.game.day.exileDone) return fail('今天已經放逐過了');
  // 槍開完才能放逐（Leo 2026-10-22 ⑥A）：不然白癡選翻不翻時被槍帶走，死人還能翻牌免死。
  // 能開槍的人出局時已經喊過「N 號，請啟動角色技能」，擋住不會多洩漏；主機按天黑照樣作廢沒開的槍
  if (room.game.canShoot.length) return fail('請等開槍的玩家先選');
  const g = structuredClone(room.game);
  target = Number(target ?? 0);
  g.day.exileDone = true;
  g.day.bindCheck = false; // 已經進到投票，「天亮睜眼」的綁票檢查結束（投完票改看「一狼一神一民」，見 checkWin）
  if (g.day.vote?.open) g.day.vote = null; // 還在投票主機就直接登記（例如有人手機沒電）：這輪作廢
  // 沒人出局：上一輪全部棄票＝「今天沒有人出局。」；其他（平票、主機手動）照舊唸「平票，今天沒有人出局。」。
  // 唸完接著「天黑請閉眼。」，今天到此結束（Leo 2026-10-28）；這一下就分出勝負（例如一狼一神一民）就不唸天黑
  if (!target) {
    const seq0 = room.game.narration?.seq;
    note(g, [g.day.vote?.result?.top.length === 0 ? 'noExile' : 'tie']);
    const done = checkWin({ ...room, game: g }, seq0);
    if (done.phase !== 'ended') {
      Object.assign(done.game.day, { nightCalled: true, nightReason: 'noExile' });
      say(done.game, [...done.game.narration.clips, 'nightStart']);
      done.game.log.at(-1).text += lineText(['nightStart']); // 紀錄也寫「天黑請閉眼。」（跟騎士撞狼、自爆一樣接在同一行）
    }
    return ok(done);
  } else {
    if (!g.alive[target]) return fail('只能放逐活著的人');
    // 還沒翻過牌的白癡：由他自己的手機選要不要翻牌（Leo 2026-10-10）；選之前主機不唸結果；不限時
    if (g.roles[target] === 'idiot' && !g.idiotRevealed.includes(target)) {
      g.day.idiotChoice = target;
      return ok({ ...room, game: g });
    }
    exiledOut(g, target);
  }
  return ok(checkWin({ ...room, game: g }, room.game.narration?.seq));
}

// 投票放逐出局（含白癡不翻牌）：守墓人下一晚會看到這個人的陣營
function exiledOut(g, seat) {
  g.graveInfo = { day: g.dayNo, seat, wolf: looksWolf(g, seat) };
  note(g, [seatKey(seat), 'exiled', ...dayKill(g, seat)]);
}

// 被放逐的白癡：flip＝翻牌免死（之後不能投票）；不翻＝照常出局
function resolveIdiot(g, flip) {
  const seat = g.day.idiotChoice;
  g.day.idiotChoice = null;
  if (flip) {
    g.idiotRevealed.push(seat);
    note(g, [seatKey(seat), 'idiotFlip']);
    // 白癡是警長：雖然沒死，但被公投出局、失去投票權——發表遺言後自己選移交或撕警徽（Leo 2026-10-28）
    if (seat === g.sheriff) g.badgePending = true;
  } else exiledOut(g, seat);
}

// 只有白癡本人能選；主機不能代按（Leo 2026-10-10）；不限時
export function idiotChoose(room, clientId, flip, now = 0) {
  if (room.phase !== 'day' || !room.game.day?.idiotChoice) return fail('現在不用選');
  if (L.seatOf(room, clientId) !== room.game.day.idiotChoice) return fail('不是你要選');
  const g = structuredClone(room.game);
  resolveIdiot(g, Boolean(flip));
  return ok(checkWin({ ...room, game: g }, room.game.narration?.seq));
}

// 騎士白天隨時可以決鬥（Leo 2026-10-27，取代 10-14 選 1A「死訊公布後、投票放逐前」）：警長競選中、投票中、放逐之後都可以；
// 只有等別人選擇（開槍、白癡翻牌、移交警徽）那一下、或今天已經要天黑時不行
export function duel(room, clientId, target, now = 0) {
  if (room.phase !== 'day') return fail('只有白天能決鬥');
  const seat = L.seatOf(room, clientId);
  if (!seat || room.game.roles[seat] !== 'knight' || !room.game.alive[seat]) return fail('你不能決鬥');
  return afterDeaths(room, r => duelNow(r, seat, target));
}
function duelNow(room, seat, target) {
  const g0 = room.game;
  if (!g0.alive[seat]) return fail('你昨晚已經出局，不能決鬥');
  if (g0.knightUsed) return fail('決鬥只能用一次');
  const blocked = waitBlock(room); if (blocked) return blocked;
  if (g0.day.nightCalled) return fail('今天已經要天黑了');
  if (g0.canShoot.length) return fail('請等開槍的玩家先選');
  target = Number(target);
  if (g0.alive[target] !== true || target === seat) return fail('請選一個活著的其他玩家');
  const g = structuredClone(g0);
  g.knightUsed = true;
  g.day.bindCheck = false; // 白天已經往下走，「天亮睜眼」的綁票檢查結束
  if (!g.day.exileDone) g.day.vote = null; // 投票中（或投完還沒放逐）被決鬥打斷：這輪作廢，主機再開一次投票；已經放逐的統計留著（2026-10-28 審查）
  if (isWolfRole(g.roles[target])) {
    // 撞到狼：狼出局，今天不放逐，直接唸「天黑請閉眼」；主機按「進入黑夜」才開始夜晚（Leo 2026-10-10）
    // 撞到狼王：狼王先開槍，開完才唸「天黑請閉眼」（見 shoot）。撞死狼美人＝技能被悶、不殉情（Leo 2026-10-27）
    kill(g, target);
    const over = winnerOf(g, room.setup.counts, room.setup.rules) || houseRuleWin(g, room.setup.rules);
    g.day.nightCalled = !over;
    g.day.nightReason = 'knight';
    note(g, ['knight', seatKey(seat), 'duelWith', seatKey(target), 'colon', seatKey(target), 'duelWolf', ...(over || g.canShoot.length || g.badgePending ? [] : ['nightStart'])]);
  } else {
    // 撞到好人：騎士出局，白天繼續發言、投票
    kill(g, seat);
    note(g, ['knight', seatKey(seat), 'duelWith', seatKey(target), 'colon', seatKey(target), 'duelGood']);
  }
  return ok(checkWin({ ...room, game: g }, room.game.narration?.seq));
}

// 自爆：Leo 2026-10-27 起狼人陣營都能自爆（狼美人不行；隱狼 2026-10-28 起也不行），主機唸「3 號狼人自爆，天黑請閉眼。」；自爆的狼王不能開槍。
// 白狼王（2026-10-13）自爆可以帶走一人（0＝不帶），唸「白狼王自爆」；被帶走的獵人／狼王可以開槍，開完才唸天黑。
// 時機：白天、投票放逐之前（警長競選中、投票中也可以），今天不放逐，主機按「進入黑夜」；
// 警長競選中自爆＝先公布昨晚死訊再自爆（見 afterDeaths）
export function boom(room, clientId, target, now = 0) {
  if (room.phase !== 'day') return fail('只有白天能自爆');
  const seat = L.seatOf(room, clientId);
  const role = seat ? room.game.roles[seat] : null;
  if (!seat || !isWolfRole(role) || role === 'beauty' || role === 'hidden' || !room.game.alive[seat]) return fail('你不能自爆');
  return afterDeaths(room, r => boomNow(r, seat, role, target));
}
function boomNow(room, seat, role, target) {
  const g0 = room.game;
  if (!g0.alive[seat]) return fail('你昨晚已經出局，不能自爆');
  const blocked = waitBlock(room); if (blocked) return blocked;
  if (g0.day.nightCalled) return fail('今天已經要天黑了');
  if (g0.day.exileDone) return fail('投票放逐之後不能自爆');
  if (g0.canShoot.length) return fail('請等開槍的玩家先選');
  target = Number(target ?? 0);
  if (target && role !== 'whiteKing') return fail('只有白狼王自爆能帶走人');
  if (target && (g0.alive[target] !== true || target === seat)) return fail('只能帶走活著的其他玩家');
  const g = structuredClone(g0);
  g.day.bindCheck = false; // 白天已經往下走，「天亮睜眼」的綁票檢查結束
  g.day.vote = null; // 投票中自爆：這輪作廢
  kill(g, seat, { noSkill: true });
  const chain = target ? dayKill(g, target) : [];
  const over = winnerOf(g, room.setup.counts, room.setup.rules) || houseRuleWin(g, room.setup.rules);
  const night = !over && !g.canShoot.length && !g.badgePending; // 要開槍、要選警徽：選完才唸天黑（見 callNightIfReady）
  g.day.nightCalled = !over;
  g.day.nightReason = role === 'whiteKing' ? 'boom' : 'wolfBoom';
  const head = role === 'whiteKing'
    ? [seatKey(seat), ...(target ? ['whiteBoomTook', seatKey(target), 'end'] : ['whiteBoom']), ...chain]
    : [seatKey(seat), 'wolfBoom', night ? 'comma' : 'end'];
  note(g, [...head, ...(night ? ['nightStart'] : [])]);
  return ok(checkWin({ ...room, game: g }, room.game.narration?.seq));
}

export function nextNight(room, now) {
  if (room.phase !== 'day') return fail('現在不是白天');
  const blocked = pendingBlock(room); if (blocked) return blocked;
  const g = structuredClone(room.game);
  // 獵人／狼王還沒開槍主機就按了：這槍當作不開（Leo 2026-10-10 接受），
  // 但「有槍先等」的提早獲勝（綁票、一狼一神一民）照樣要判，不然遊戲該結束卻進了黑夜（2026-10-14 盤查）
  if (g.canShoot.length) {
    g.canShoot = [];
    const done = checkWin({ ...room, game: g }, room.game.narration?.seq);
    if (done.phase === 'ended') return ok(done);
  }
  // 「天黑請閉眼」剛唸過就不重唸；狼王還沒開槍主機就按了，那就照常唸
  const silent = Boolean(g.day?.nightCalled) && g.narration?.clips.at(-1) === 'nightStart';
  g.dayNo++;
  return ok(beginNight({ ...room, game: g }, now, { silent }));
}

/* ───────── 警長（主機登記，Leo 2026-10-27） ───────── */
// 主機：登記誰當警長（競選完），或警長出局後移交警徽。警長投票算 1.5 票，綁票也看警徽在哪一邊（見 houseRuleWin）。
// 第一天死訊還沒公布時，昨晚死的人也能當選（死訊本來就是警長選完才公布），所以只看座位表上的活人
export function setSheriff(room, seat, now = 0) {
  if (room.phase !== 'day') return fail('白天才能登記警長');
  const g0 = room.game;
  if (g0.badgePending) return fail(`請等警長 ${g0.sheriff} 號自己選要移交還是撕警徽`); // Leo 2026-10-27
  if (g0.day?.idiotChoice) return fail('請等被放逐的玩家選擇');
  if (g0.badgeChosen) return fail('警徽已經由警長自己處理過，主機不能再改'); // Leo 2026-10-28
  seat = Number(seat);
  if (g0.alive[seat] !== true) return fail('只能選活著的人');
  if (g0.idiotRevealed.includes(seat)) return fail('翻過牌的白癡不能當警長'); // 被公投出局、失去投票權（Leo 2026-10-28）
  if (seat === g0.sheriff) return fail(`${seat} 號已經是警長了`);
  if (g0.day?.vote?.open) return fail('投票中不能換警長（警長那票的票數會跟著變）'); // 2026-10-27 審查
  const g = structuredClone(g0);
  const passed = g.badgePending;
  Object.assign(g, { sheriff: seat, badgeTorn: false, badgePending: false });
  // 第一天警長競選完：直接唸「3 號玩家當選警長。」接著昨晚死訊，主機不用再按「公布」（Leo 2026-10-28）
  if (g.day?.pendingDeaths) note(g, [seatKey(seat), 'sheriffElected', ...flushPending(g)]);
  else g.log.push({ day: g.dayNo, text: passed ? `警徽移交給 ${seat} 號。` : `${seat} 號當上警長。` });
  return ok(checkWin({ ...room, game: g }, g0.narration?.seq));
}

// 主機：警徽流失（沒人當選），現在沒有警長（之後主機還能重新登記）；第一天死訊還沒公布＝接著公布
export function tearBadge(room, now = 0) {
  if (room.phase !== 'day') return fail('白天才能撕警徽');
  const g0 = room.game;
  if (g0.badgePending) return fail(`請等警長 ${g0.sheriff} 號自己選要移交還是撕警徽`);
  if (g0.badgeChosen) return fail('警徽已經由警長自己處理過，主機不能再改'); // Leo 2026-10-28
  if (g0.badgeTorn && !g0.sheriff) return fail('警徽已經撕掉了');
  if (g0.sheriff) return fail('已經有警長了：登記錯了請改成另一個人');
  if (g0.day?.vote?.open) return fail('投票中不能撕警徽');
  const g = structuredClone(g0);
  Object.assign(g, { sheriff: null, badgeTorn: true, badgePending: false });
  g.log.push({ day: g.dayNo, text: '警徽流失，現在沒有警長。' });
  if (g.day?.pendingDeaths) note(g, flushPending(g)); // 第一天沒人當選：接著直接公布昨晚死訊（Leo 2026-10-28）
  return ok(checkWin({ ...room, game: g }, g0.narration?.seq));
}

// 出局的警長在自己手機選：移交給一個活著的人（target），或撕掉警徽（0）（Leo 2026-10-27：警長自己選，主機不能代按）
export function passBadge(room, clientId, target, now = 0) {
  if (room.phase !== 'day' || !room.game.badgePending) return fail('現在不用移交警徽');
  const seat = L.seatOf(room, clientId);
  if (!seat || seat !== room.game.sheriff) return fail('只有警長能選');
  target = Number(target ?? 0);
  if (target && room.game.alive[target] !== true) return fail('只能移交給活著的人');
  if (target === seat) return fail('不能移交給自己'); // 翻牌的白癡警長還活著（Leo 2026-10-28）
  if (target && room.game.idiotRevealed.includes(target)) return fail('翻過牌的白癡不能接警徽'); // 被公投出局、失去投票權
  const g = structuredClone(room.game);
  Object.assign(g, { sheriff: target || null, badgeTorn: !target, badgePending: false, badgeChosen: true });
  g.log.push({ day: g.dayNo, text: target ? `${seat} 號警長把警徽移交給 ${target} 號。` : `${seat} 號警長撕掉警徽，不交給任何人。` });
  const seq0 = room.game.narration?.seq;
  const done = checkWin({ ...room, game: g }, seq0);
  if (done.phase !== 'ended') callNightIfReady(done, done.game, seq0); // 今天要天黑（自爆、撞到狼）：選完警徽才唸
  return ok(done);
}

/* ───────── 投票（玩家在自己手機按號碼，Leo 2026-10-27） ───────── */
// 有投票權：活著、沒翻過牌的白癡；隱狼等狼人陣營照樣投（Leo 2026-10-27）。警長算 1.5 票
const hasVote = (g, s) => g.alive[s] === true && !g.idiotRevealed.includes(s);
const voteWeight = (g, s) => (s === g.sheriff ? 1.5 : 1);

// 主機：開始投票。大家投完（或主機按結束）後，每支手機同時出現投票統計；主機再照統計登記放逐。
// pk＝上一輪最高票平手：平手的人不投票（例如 10 人 1、2 號 PK，只有 3～10 號投），其他人只能投他們
export function startVote(room, pk = false, now = 0) {
  if (room.phase !== 'day') return fail('現在不是白天');
  const blocked = pendingBlock(room); if (blocked) return blocked;
  const g0 = room.game;
  if (g0.day.nightCalled) return fail('今天直接天黑，不投票');
  if (g0.day.exileDone) return fail('今天已經放逐過了');
  if (g0.canShoot.length) return fail('請等開槍的玩家先選');
  if (g0.day.vote?.open) return fail('正在投票');
  const all = seatsList(g0).filter(s => hasVote(g0, s));
  let candidates = seatsList(g0).filter(s => g0.alive[s]), voters = all;
  if (pk) {
    const top = (g0.day.vote?.result?.top ?? []).filter(s => g0.alive[s]);
    if (top.length < 2) return fail('上一輪沒有平票');
    candidates = top;
    voters = all.filter(s => !top.includes(s));
    if (!voters.length) return fail('沒有人可以投 PK 票');
  }
  if (!voters.length) return fail('沒有人可以投票');
  const g = structuredClone(g0);
  g.day.vote = { round: (g0.day.vote?.round ?? 0) + 1, pk: Boolean(pk), open: true, candidates, voters, ballots: {}, result: null };
  say(g, ['voteStart']); // 主機唸「請大家進行投票。」（Leo 2026-10-27）
  g.log.push({ day: g.dayNo, text: pk ? `平票 PK：${candidates.join('、')} 號，其他人重新投票。` : '開始投票。' });
  return ok({ ...room, game: g });
}

// 投票結束（全部投完或主機按結束）：只有一個最高票就直接放逐，主機馬上唸「N 號被放逐出局。」
// （獵人／狼王接「N 號，請啟動角色技能。」；白癡等他自己選翻不翻，先不唸）（Leo 2026-10-27）。
// 平票、全部棄票由主機選（PK／沒人出局／重新投票）；放逐被擋住（例如還有人要開槍）就留給主機按
function finishVote(room, now) {
  const top = room.game.day.vote.result.top;
  if (top.length === 1) {
    const r = exile(room, top[0], now);
    if (r.ok) return r;
  }
  return ok(room);
}

// 玩家投票：target＝號碼，0＝棄票；投了不能改。全部投完自動結束、公布統計
export function castVote(room, clientId, target, now = 0) {
  const v0 = room.phase === 'day' ? room.game.day?.vote : null;
  if (!v0?.open) return fail('現在沒有在投票');
  const seat = L.seatOf(room, clientId);
  if (!seat || !v0.voters.includes(seat)) return fail('你這輪不能投票');
  if (v0.ballots[seat] !== undefined) return fail('你已經投過了');
  target = Number(target ?? 0);
  if (!Number.isInteger(target) || (target && (!v0.candidates.includes(target) || target === seat))) return fail('請投給可以投的人，或棄票');
  const g = structuredClone(room.game);
  const v = g.day.vote;
  v.ballots[seat] = target;
  if (!v.voters.every(s => v.ballots[s] !== undefined)) return ok({ ...room, game: g });
  closeVote(g);
  return finishVote({ ...room, game: g }, now);
}

// 主機：提早結束投票（有人手機沒電、不投）：沒投的算棄票
export function endVote(room, now = 0) {
  if (room.phase !== 'day' || !room.game.day?.vote?.open) return fail('現在沒有在投票');
  const g = structuredClone(room.game);
  closeVote(g);
  return finishVote({ ...room, game: g }, now);
}

function closeVote(g) {
  const v = g.day.vote;
  v.open = false;
  const rows = v.candidates.map(target => {
    const by = v.voters.filter(s => v.ballots[s] === target);
    return { target, voters: by, score: by.reduce((a, s) => a + voteWeight(g, s), 0) };
  }).filter(r => r.voters.length).sort((a, b) => b.score - a.score || a.target - b.target);
  const abstain = v.voters.filter(s => !v.ballots[s]); // 投 0 或沒投＝棄票
  const top = rows.filter(r => r.score === rows[0].score).map(r => r.target);
  v.result = { round: v.round, pk: v.pk, rows, abstain, top, sheriff: v.voters.includes(g.sheriff) ? g.sheriff : null };
  g.log.push({ day: g.dayNo, text: voteText(v.result) });
}

// 「投票結果：3 號 2.5 票（警長1、4 號）；5 號 1 票（2 號）；棄票 6 號。最高票 3 號。」
export function voteText(r) {
  const who = list => list.map(s => (s === r.sheriff ? `警長${s}` : `${s}`)).join('、') + ' 號';
  const parts = r.rows.map(x => `${x.target} 號 ${x.score} 票（${who(x.voters)}）`);
  if (r.abstain.length) parts.push(`棄票 ${who(r.abstain)}`);
  const end = !r.top.length ? '沒有人得票。' : r.top.length > 1 ? `平票：${r.top.join('、')} 號。` : `最高票 ${r.top[0]} 號。`;
  return `${r.pk ? 'PK ' : ''}投票結果：${parts.join('；') || '全部棄票'}。${end}`;
}

/* ───────── 勝負 ───────── */
export function winnerOf(g, counts, rules) {
  const alive = seatsList(g).filter(s => g.alive[s]);
  const team = s => R.ROLES[g.roles[s]].team;
  const wolves = alive.filter(s => team(s) === 'wolf').length;
  const gods = alive.filter(s => team(s) === 'god').length;
  const villagers = alive.filter(s => team(s) === 'villager').length;
  const hasGods = R.ROLE_ORDER.some(id => R.ROLES[id].team === 'god' && (counts[id] ?? 0) > 0);
  const hasVillagers = (counts.villager ?? 0) > 0;
  // 每個動作之後都會判，所以兩邊同時成立＝同一個動作造成的（例如同一晚刀死最後一個神、毒死最後一隻狼）：
  // 狼人勝（Leo 2026-10-14 選 3B），所以先看狼人的條件
  const wolfWins = rules.win === 'side' ? (hasGods && gods === 0) || (hasVillagers && villagers === 0) : gods + villagers === 0;
  if (wolfWins) return 'wolf';
  if (wolves === 0) return 'good';
  return null;
}

// 一狼一神一民：好人還有翻盤的機會（女巫還有藥、守衛或獵人活著、騎士還沒決鬥）→ 不提早判，照常打下去（Leo 2026-10-14 選 4B）
// knifeOnly：只算「擋得住今晚這一刀」的（守衛、解藥）——屠邊的一狼一神一民，狼隨便刀一個就贏，
// 毒藥（同時達成算狼勝）、獵人、騎士都來不及（Leo 2026-10-14 選 A）
function goodCanTurn(g, alive, { knifeOnly = false } = {}) {
  return alive.some(s => {
    const role = g.roles[s];
    if (role === 'guard') return true;
    if (role === 'witch') return knifeOnly ? g.potions.save : g.potions.save || g.potions.poison;
    return !knifeOnly && (role === 'hunter' || (role === 'knight' && !g.knightUsed));
  });
}

// Leo 2026-10-11 加的兩條狼人提早獲勝（屠邊、屠城都適用）。有人還能開槍時先等他開完（槍可能帶走狼）：
//   綁票：天亮睜眼（死訊公布）時，活著的狼人陣營 ≥ 好人的票數（翻過牌的白癡沒有票，Leo 2026-10-14 選 2A）→ 好人投不出狼
//   一狼一神一民：白天投完票（含平票）剩這三個人 → 今晚狼刀一個就一對一
// 好人還有翻盤機會時不判（綁票見 bindCanBreak、一狼一神一民見 goodCanTurn）
// 綁票的票數：警長算 1.5 票（Leo 2026-10-27 起主機登記警長）。
// 好人還能「追輪次」就不算綁票，看警徽在哪一邊（Leo 2026-10-27，取代 10-14 選 A 的條件——沒有警長時照舊）：
//   8-1 警徽在好人手上：夜裡還有追輪次的技能——守衛（守隊友）、女巫還有解藥或毒藥、獵人（帶槍）
//   8-2 警徽在狼人手上：白天還有追輪次的技能——騎士還沒決鬥（白天撞一隻出去）
//     （好人有 1.5 票，晚上守對一刀就能追一個輪次——Leo 2026-10-27 確認守衛算）
//   沒有警長：騎士還沒決鬥就不算綁票（Leo 2026-10-27）；其他照 2026-10-14 選 A——狼要剛好等於好人票數，
//   而且守衛活著＋女巫還有毒藥（同一晚毒一隻狼、守住刀）。獵人一換一、單靠守衛或解藥只能拖延、單靠毒藥是毒一隻刀一個
function bindCanBreak(g, alive, sheriff, wolfVotes, votes) {
  const has = role => alive.some(s => g.roles[s] === role);
  const knight = has('knight') && !g.knightUsed;
  if (sheriff && isWolfRole(g.roles[sheriff])) return knight;
  if (sheriff) return has('guard') || (has('witch') && (g.potions.save || g.potions.poison)) || has('hunter');
  if (knight) return true; // 沒有警長：騎士還沒決鬥就不算綁票（Leo 2026-10-27）
  if (wolfVotes !== votes) return false;
  return has('guard') && has('witch') && g.potions.poison;
}

export function houseRuleWin(g, rules = R.DEFAULT_RULES) {
  if (!g.day || g.day.pendingDeaths || g.day.idiotChoice || g.canShoot.length) return null;
  const team = s => R.ROLES[g.roles[s]].team;
  const alive = seatsList(g).filter(s => g.alive[s]);
  const n = t => alive.filter(s => team(s) === t).length;
  const wolves = n('wolf');
  const sheriff = g.sheriff && g.alive[g.sheriff] ? g.sheriff : null;
  const goodVoters = alive.filter(s => team(s) !== 'wolf' && !g.idiotRevealed.includes(s));
  const wolfVotes = wolves + (sheriff && team(sheriff) === 'wolf' ? 0.5 : 0);
  const votes = goodVoters.length + (sheriff && goodVoters.includes(sheriff) ? 0.5 : 0);
  // 警長剛出局、警徽還沒移交或撕掉：先等主機處理（警徽到哪一邊會改變結果），處理完再看
  if (g.day.bindCheck && !g.badgePending && wolves > 0 && wolfVotes >= votes && !bindCanBreak(g, alive, sheriff, wolfVotes, votes)) return 'bind';
  if (g.day.exileDone && alive.length === 3 && wolves === 1 && n('god') === 1 && n('villager') === 1
    && !goodCanTurn(g, alive, { knifeOnly: rules.win === 'side' })) return 'lastThree';
  return null;
}
const HOUSE_RULE_TEXT = {
  bind: '狼人不少於好人的票數，形成綁票，狼人陣營直接獲勝。',
  lastThree: '投票後只剩一狼、一神、一民，狼人陣營直接獲勝。',
};

// seq0：這個動作開始前的台詞序號。動作自己剛唸的那句（例如「3 號被放逐出局。」）要和「遊戲結束」接在同一句，
// 不然主機只會收到最後一句，前一句就沒唸到
function checkWin(room, seq0) {
  const g = room.game;
  let w = winnerOf(g, room.setup.counts, room.setup.rules);
  // 狼死光了、但狼王還能開槍：先等他開（帶走最後一個神或民＝兩邊同時達成＝狼勝；Leo 2026-10-22 ⑤A）。
  // 狼人已經贏的局面不用等：再開槍只會讓好人更少
  if (w === 'good' && g.canShoot.some(s => isWolfRole(g.roles[s]))) w = null;
  const house = w ? null : houseRuleWin(g, room.setup.rules);
  if (g.day && !g.canShoot.length && !g.badgePending) g.day.bindCheck = false; // 綁票只在天亮那一刻看（槍都開完、警徽處理完之後）
  if (house) w = 'wolf';
  if (!w) { askSkill(g, seq0); return room; }
  g.winner = w;
  g.timer = null;
  g.canShoot = [];
  const win = w === 'good' ? 'goodWin' : 'wolfWin';
  const before = g.narration && seq0 !== undefined && g.narration.seq > seq0 ? g.narration.clips : [];
  if (house) g.log.push({ day: g.dayNo, text: HOUSE_RULE_TEXT[house] }); // 只寫在畫面紀錄，主機照樣唸錄好的「狼人陣營獲勝」
  g.log.push({ day: g.dayNo, text: lineText([win]) });
  say(g, [...before, win]);
  return { ...room, phase: 'ended' };
}

// 獵人／狼王出局、可以開槍（被毒、殉情的不算）：接在這個動作的台詞後面喊「9 號，請啟動角色技能。」。
// Leo 2026-10-17 選「只有能開槍才喊」，知道這等於公開他是獵人或狼王。遊戲已經結束就不喊（checkWin 只在沒分勝負時呼叫）
function askSkill(g, seq0) {
  if (!g.day) return;
  const asked = g.day.skillAsked ?? [];
  const fresh = g.canShoot.filter(s => !asked.includes(s));
  if (!fresh.length) return;
  g.day.skillAsked = [...asked, ...fresh];
  const clips = fresh.flatMap(s => [seatKey(s), 'comma', 'skillOn']);
  g.log.push({ day: g.dayNo, text: lineText(clips) });
  const before = g.narration && seq0 !== undefined && g.narration.seq > seq0 ? g.narration.clips : [];
  say(g, [...before, ...clips]);
}

// 再來一局：座位、板子都留著，回到大廳
export function newGame(room) {
  if (room.phase !== 'ended' && room.phase !== 'day' && room.phase !== 'night') return fail('現在不能重開');
  const { game, ...rest } = room;
  return ok({ ...rest, phase: 'lobby', seatRequests: {} }); // 換手機接手座位的申請不帶到下一局
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
    nightReason: g.day?.nightCalled ? g.day.nightReason ?? 'knight' : null, // 主機畫面標題：騎士撞狼／白狼王自爆
    idiotChoice: g.day?.idiotChoice ?? null, // 等這個號碼選要不要翻牌（Leo 拍板：只有白癡會出現這個等待）
    // 警長（主機登記，公開）：badgePending＝警長出局、等他自己選移交或撕掉警徽
    sheriff: g.sheriff ?? null, badgeTorn: Boolean(g.badgeTorn), badgePending: Boolean(g.badgePending), badgeChosen: Boolean(g.badgeChosen),
    // 投票：投完才公布誰投誰（result）；投票中只公開投了幾票
    vote: g.day?.vote ? (({ ballots, ...v }) => ({ ...v, voted: Object.keys(ballots).length }))(g.day.vote) : null,
    // 夜裡只公開「現在輪到哪個角色、第幾句台詞」（本來就唸出來了），不公開死活與進度
    // eyesOpen：這句台詞唸出後到「X 請閉眼」之前（動作中＋做完後的停頓都算，免得從按鈕消失的時間看出角色做完了）
    night: g.night ? { step: curStep(g.night) ?? null, beat: g.night.beat, openedAt: g.night.openedAt, eyesOpen: ['acting', 'pause'].includes(g.night.stage) } : null,
  };
  if (room.phase === 'ended') pub.allRoles = g.roles; // 結束後翻開所有人的身分
  return pub;
}

// 狼人投刀的畫面資料。noKnife：狼美人不能被自刀（Leo 2026-10-27）。
// hiddenAlone：隱狼那步（只剩隱狼）——主機不唸「要擊殺的目標是？」，手機上要寫出來（Leo 2026-10-28）
function wolfView(g, n, seat) {
  const step = curStep(n);
  const noKnife = seatsList(g).filter(s => g.roles[s] === 'beauty' && g.alive[s]);
  return { kind: 'wolf', votes: n.wolfVotes, proposal: n.wolfProposal, killers: actors(g, step), noKnife, hiddenAlone: step === 'hidden' };
}

// 私人：只給坐在這個座位的手機
export function privateGame(room, seat) {
  const g = room.game;
  if (!g || !g.alive || !seat) return null;
  const role = g.roles[seat];
  const me = { alive: g.alive[seat], idiotRevealed: g.idiotRevealed.includes(seat) };
  if (isWolfRole(role)) me.wolves = wolfMates(g, seat);
  if (role === 'seer') me.seerChecks = g.seerChecks;
  if (role === 'gargoyle') me.gargoyleChecks = g.gargoyleChecks;
  if (role === 'gravekeeper') me.graveChecks = g.graveChecks;
  if (role === 'beauty') me.charm = g.charm;
  if (role === 'witch') me.potions = g.potions;
  if (role === 'guard') me.lastGuard = g.lastGuard;
  if (room.phase === 'day' && !g.day?.pendingDeaths) {
    if (g.canShoot.includes(seat)) me.canShoot = true; // 不限時
    if (g.day?.idiotChoice === seat) me.idiotChoose = true;
    const v = g.day?.vote;
    if (v?.open && v.voters.includes(seat)) me.vote = { mine: v.ballots[seat] ?? null, candidates: v.candidates.filter(s => s !== seat) };
  }
  // 騎士決鬥、自爆：白天（含警長競選中）；等別人選擇的那一下、今天要天黑時沒有（跟 duel、boom 的檢查一樣）
  // 出局的警長：自己選移交給誰或撕警徽（Leo 2026-10-27）
  if (room.phase === 'day' && g.badgePending && seat === g.sheriff) me.passBadge = { candidates: seatsList(g).filter(s => g.alive[s] && s !== seat && !g.idiotRevealed.includes(s)) }; // 翻牌的白癡警長還活著：不能交給自己
  // 照座位表上的死活給（第一天死訊還沒公布時昨晚死的人也有，按了會先公布死訊，見 afterDeaths）
  if (room.phase === 'day' && g.alive[seat] && !g.day?.idiotChoice && !g.badgePending && !g.day?.nightCalled && !g.canShoot.length) {
    if (role === 'knight' && !g.knightUsed) me.canDuel = true;
    if (isWolfRole(role) && role !== 'beauty' && role !== 'hidden' && !g.day?.exileDone) { me.canBoom = true; if (role === 'whiteKing') me.boomTake = true; }
  }
  const n = g.night;
  if (room.phase === 'night' && n?.stage === 'acting' && g.alive[seat] && actors(g, curStep(n)).includes(seat)) {
    const act = curBeat(room, n).act;
    if (act === 'guard') me.action = { kind: 'guard', lastGuard: g.lastGuard };
    // noKnife：狼美人不能被自刀（Leo 2026-10-27）——只有一起殺人的狼看得到
    if (act === 'wolf') me.action = wolfView(g, n, seat);
    if (act === 'witchSave') me.action = {
      kind: 'witchSave',
      victim: g.potions.save ? n.wolfTarget : null, // 解藥用掉之後就不告知死亡號碼
      canSave: g.potions.save && Boolean(n.wolfTarget) && (n.wolfTarget !== seat || witchMaySaveSelf(room.setup.rules, g.dayNo)),
      selfBlocked: g.potions.save && n.wolfTarget === seat && !witchMaySaveSelf(room.setup.rules, g.dayNo),
      saveUsedUp: !g.potions.save,
    };
    if (act === 'witchPoison') me.action = { kind: 'witchPoison', canPoison: g.potions.poison && !n.witchSave, savedTonight: n.witchSave, poisonUsedUp: !g.potions.poison };
    if (act === 'seer') me.action = { kind: 'seer', checked: n.seerTarget ? g.seerChecks.at(-1) : null };
    if (act === 'beauty') me.action = { kind: 'beauty', lastCharm: g.charm }; // 不能連續兩晚魅惑同一位
    if (act === 'gargoyle') me.action = { kind: 'gargoyle', checked: n.gargoyleTarget ? g.gargoyleChecks.at(-1) : null };
    if (act === 'grave') me.action = { kind: 'grave', info: graveFor(g) };
    // 帶槍手勢（獵人、狼王同一套）：被毒、或今晚會殉情（狼美人今晚死、魅惑的是你）都不能開槍
    if (act === 'hunter' || act === 'king') me.action = { kind: act, canShoot: !nightDeaths(g, n).noSkill.has(seat) };
  }
  // 隱狼那步、其他狼還活著（假等）：隱狼睜眼看得到狼同伴是誰（me.wolves），不用動作；這一步照樣假等，聽不出差別（Leo 2026-10-28）
  if (room.phase === 'night' && n?.stage === 'acting' && curStep(n) === 'hidden' && role === 'hidden' && g.alive[seat]
    && !actors(g, 'hidden').includes(seat)) me.action = { kind: 'hiddenMates' };
  return me;
}
