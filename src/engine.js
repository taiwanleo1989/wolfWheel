// 對局引擎：黑夜 → 天亮 → 白天 → 黑夜 … → 結束。純函式：輸入房間與時間，回傳新房間。
// 時間相關的動作（假等、停頓）用 game.timer = { at } 交給房間的鬧鐘，到時呼叫 advance()。
//
// 黑夜照 Leo 的手稿（2026-10-08）：守衛 → 狼人 → 女巫（解藥、毒藥兩段）→ 預言家 → 獵人 →（第一晚）上警 → 天亮。
// 2026-10-13 加五個角色，插進手稿的順序：狼人之後狼美人、預言家之後石像鬼、守墓人（第二晚起）；白狼王、隱狼沒有自己的一步。
// 2026-10-17 獵人之後加狼王的帶槍手勢（Leo：跟獵人同一套；女巫用完毒才知道今晚能不能開槍）。
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
//   day{exileDone,pendingDeaths,noSkill[],nightCalled,nightReason}, winner, timer{at}
import * as L from './lobby.js';
import * as R from '../public/shared/roles.js';
import { lineText, seatKey } from '../public/shared/voice-lines.js';

export const NIGHT_ORDER = ['guard', 'wolf', 'beauty', 'witch', 'seer', 'gargoyle', 'gravekeeper', 'hunter', 'king'];

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
    case 'beauty': return { beats: [{ say: ['beautyOpen'], act: 'beauty' }], close: ['beautyClose'] };
    case 'gargoyle': return { beats: [{ say: ['gargoyleOpen'], act: 'gargoyle' }], close: ['gargoyleClose'] };
    case 'gravekeeper': return { beats: [{ say: ['graveOpen'], act: 'grave' }], close: ['graveClose'] };
    case 'hunter': return { beats: [{ say: ['hunterOpen'], act: 'hunter' }], close: ['hunterClose'] };
    case 'king': return { beats: [{ say: ['kingOpen'], act: 'king' }], close: ['kingClose'] };
    case 'police': return { beats: [{ say: ['police'], act: null }], close: null };
  }
}

export const INTRO_MS = 5000;   // 「天黑請閉眼」之後，等大家閉好眼
export const CLOSE_MS = 4000;   // 「X 請閉眼」之後，到下一個角色睜眼
export const POLICE_MS = 12000; // 「要上警的玩家請起立」之後等大家起立（主機可以提早按繼續）
export const PAUSE_MS = [2000, 5000]; // 每句台詞的動作完成後，隨機停一下才唸下一句
export const SKIP_MS = 30000;   // 夜裡角色睜眼這麼久之後，主機才能按「跳過」（防手機沒電卡死）
// 白天的被動技能（獵人／狼王開槍、白癡翻牌、騎士決鬥）一律不限時、沒有任何倒數（Leo 2026-10-10、10-11）

// 夜裡角色這麼久沒操作，主機就把這句台詞再唸一次（Leo 2026-10-11：先 20 秒，同日改 15 秒；2026-10-17 改 30 秒）。
// 死掉的角色也一樣（Leo 2026-10-17「角色死亡也是要講 30 秒」）：假等抽到超過 30 秒，就在 30 秒重唸、等到假等結束，
// 跟「活人慢慢按」長得一模一樣，聽重唸猜不出誰死了
export const REPEAT_MS = 30000;

// 現在的鬧鐘只是「重唸」（在等活著的角色）？房間用它判斷：主機不在線上就不用重唸（沒人出聲），改回閒置清房
export const waitingForPeople = room => room.phase === 'night' && room.game?.night?.stage === 'acting' && room.game.night.wait === 'people';
export function pauseRepeat(room) { return { ...room, game: { ...room.game, timer: null } }; }
export function resumeRepeat(room, now) {
  if (!waitingForPeople(room) || room.game.timer) return room;
  return { ...room, game: { ...room.game, timer: { at: now + REPEAT_MS } } };
}

const ok = room => ({ ok: true, room });
const fail = error => ({ ok: false, error });
const isWolfRole = role => R.ROLES[role].team === 'wolf';
const isPackRole = role => isWolfRole(role) && !R.LONE_WOLVES.includes(role); // 晚上睜眼一起殺人的狼
// 預言家、守墓人看到的「是不是狼」：隱狼顯示好人（騎士決鬥照真實陣營）
const looksWolf = role => isWolfRole(role) && role !== 'hidden';
const between = (rand, [lo, hi]) => lo + rand(hi - lo + 1);
const seatsList = g => Object.keys(g.roles).map(Number).sort((a, b) => a - b);

// 台詞用片段組成（public/shared/voice-lines.js）：clips 給主機播錄好的聲音，text 給畫面與紀錄
function say(g, clips) { g.narration = { seq: (g.narration?.seq ?? 0) + 1, text: lineText(clips), clips }; }
function note(g, clips) { g.log.push({ day: g.dayNo, text: lineText(clips) }); say(g, clips); }

// 晚上一起殺人的狼：活著的狼隊；狼隊全部出局後換隱狼、石像鬼（還活著的）
export function killers(g) {
  const alive = seatsList(g).filter(s => g.alive[s] && isWolfRole(g.roles[s]));
  const pack = alive.filter(s => isPackRole(g.roles[s]));
  return pack.length ? pack : alive;
}

// 某一步要誰動作（只算活著的）：狼人那步是 killers；上警不等任何人；其他是那個角色本人
export function actors(g, step) {
  if (step === 'police') return [];
  if (step === 'wolf') return killers(g);
  return seatsList(g).filter(s => g.roles[s] === step && g.alive[s]);
}

// 這支手機看得到的狼隊友：狼隊互相認得；隱狼單向認得狼隊；石像鬼誰都不認得；
// 狼隊死光、隱狼石像鬼開始一起殺人時，彼此晚上會見面
function wolfMates(g, seat) {
  const role = g.roles[seat];
  const pack = seatsList(g).filter(s => isPackRole(g.roles[s]));
  const set = new Set(role === 'gargoyle' ? [seat] : role === 'hidden' ? [...pack, seat] : pack);
  const k = killers(g);
  if (k.includes(seat)) for (const s of k) set.add(s);
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
    canShoot: [], knightUsed: false, log: [], winner: null,
  });
  return ok(beginNight({ ...room, game: g }, now));
}

// silent：「天黑請閉眼」白天已經唸過了（騎士撞到狼），這裡不再唸一次，只等大家閉好眼
function beginNight(room, now, { silent = false } = {}) {
  const g = room.game;
  const c = room.setup.counts;
  const wolfCount = R.ROLE_ORDER.filter(id => R.ROLES[id].team === 'wolf').reduce((a, id) => a + (c[id] ?? 0), 0);
  // 守墓人從第二晚開始（第一晚還沒有人被放逐，大家都知道，不用唸）
  const steps = NIGHT_ORDER.filter(step => (step === 'wolf' ? wolfCount > 0
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
  say(g, beat.say);
  if (beat.act === null) { n.wait = 'police'; g.timer = { at: now + POLICE_MS }; }
  else if (actors(g, curStep(n)).length === 0) {
    n.wait = 'fake';
    n.fakeEnd = now + 1000 * between(rand, [room.setup.rules.fakeWaitMin, room.setup.rules.fakeWaitMax]);
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
    say(g, curBeat(room, n).say);
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
      g.seerChecks.push({ day: g.dayNo, target, wolf: looksWolf(g.roles[target]) });
    }
  } else if (act === 'beauty') {
    if (target && (!aliveTarget(target) || target === seat)) return fail('請選一個活著的其他玩家');
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
// Leo 2026-10-10：防手機沒電卡死。每個角色、活的死的都同一套：按鈕一律睜眼就出現（灰的）、30 秒才能按；
// 死掉的角色假等超過 30 秒時也一樣 30 秒後能跳過（2026-10-17 假等預設改 8～45 秒）——活的死的同一套，看不出差別
export function skipStep(room, now, rand) {
  if (room.phase !== 'night' || room.game.night.stage !== 'acting') return fail('現在沒有可以跳過的步驟');
  const n = room.game.night;
  if (curStep(n) !== 'police' && now - n.openedAt < SKIP_MS) return fail('睜眼 30 秒後才能跳過');
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
}

// 白天出局：狼美人出局時，她最近一晚魅惑的人跟著殉情（不能發動技能）。回傳要接在台詞後面的「8 號殉情出局。」
function dayKill(g, seat) {
  kill(g, seat);
  const c = g.charm;
  if (g.roles[seat] !== 'beauty' || !c || !g.alive[c]) return [];
  kill(g, c, { noSkill: true });
  return [seatKey(c), 'charmDied'];
}

// 昨晚死了誰：狼刀（同守同救也死）、毒藥；狼美人今晚死了，今晚魅惑的人殉情。noSkill＝不能開槍的
function nightDeaths(g, n) {
  const deaths = new Set(), noSkill = new Set();
  if (n.wolfTarget) {
    const saved = n.witchSave, guarded = n.guardTarget === n.wolfTarget;
    if (saved === guarded) deaths.add(n.wolfTarget); // 都沒救＝死；同守同救＝也死
  }
  if (n.witchPoison) { deaths.add(n.witchPoison); noSkill.add(n.witchPoison); }
  const beautyDies = [...deaths].some(s => g.roles[s] === 'beauty');
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

// 主機：警長選完了，公布昨晚死訊
export function announceDeaths(room, now = 0) {
  if (room.phase !== 'day' || !room.game.day?.pendingDeaths) return fail('現在沒有要公布的死訊');
  const g = structuredClone(room.game);
  const list = g.day.pendingDeaths;
  // 舊房間（2026-10-13 前開的局）只記了 poisoned
  const noSkill = g.day.noSkill ?? (g.day.poisoned ? [g.day.poisoned] : []);
  for (const s of list) kill(g, s, { noSkill: noSkill.includes(s) });
  g.day.pendingDeaths = null;
  note(g, deathClips(list));
  g.day.bindCheck = true; // 第一天的「天亮睜眼」到公布死訊才算完
  return ok(checkWin({ ...room, game: g }, room.game.narration?.seq));
}

const pendingBlock = room => (room.game.day?.pendingDeaths ? fail('請先公布昨晚死訊')
  : room.game.day?.idiotChoice ? fail('請等被放逐的玩家選擇') : null);

/* ───────── 白天 ───────── */
// 白天沒有任何倒數：開槍、白癡翻牌、騎士決鬥都一直等本人按（Leo 2026-10-10 拿掉 30 秒，10-11 連計時機制一起拆掉）

// 騎士撞到狼王（或白狼王帶走獵人／狼王）那天：最後一槍開完（或放棄）才唸「天黑請閉眼」
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
  const g = structuredClone(room.game);
  target = Number(target ?? 0);
  g.day.exileDone = true;
  g.day.bindCheck = false; // 已經進到投票，「天亮睜眼」的綁票檢查結束（投完票改看「一狼一神一民」，見 checkWin）
  if (!target) note(g, ['tie']);
  else {
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
  g.graveInfo = { day: g.dayNo, seat, wolf: looksWolf(g.roles[seat]) };
  note(g, [seatKey(seat), 'exiled', ...dayKill(g, seat)]);
}

// 被放逐的白癡：flip＝翻牌免死（之後不能投票）；不翻＝照常出局
function resolveIdiot(g, flip) {
  const seat = g.day.idiotChoice;
  g.day.idiotChoice = null;
  if (flip) {
    g.idiotRevealed.push(seat);
    note(g, [seatKey(seat), 'idiotFlip']);
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

export function duel(room, clientId, target, now = 0) {
  if (room.phase !== 'day') return fail('只有白天能決鬥');
  const blocked = pendingBlock(room); if (blocked) return blocked;
  const seat = L.seatOf(room, clientId);
  const g0 = room.game;
  if (!seat || g0.roles[seat] !== 'knight' || !g0.alive[seat]) return fail('你不能決鬥');
  if (g0.knightUsed) return fail('決鬥只能用一次');
  // 跟白狼王自爆同一套：死訊公布後、投票放逐前、沒人在等開槍（Leo 2026-10-14 選 1A）
  if (g0.day.nightCalled) return fail('今天已經要天黑了');
  if (g0.day.exileDone) return fail('投票放逐之後不能決鬥');
  if (g0.canShoot.length) return fail('請等開槍的玩家先選');
  target = Number(target);
  if (!g0.alive[target] || target === seat) return fail('請選一個活著的其他玩家');
  const g = structuredClone(g0);
  g.knightUsed = true;
  g.day.bindCheck = false; // 白天已經往下走，「天亮睜眼」的綁票檢查結束
  if (isWolfRole(g.roles[target])) {
    // 撞到狼：狼出局，今天不放逐，直接唸「天黑請閉眼」；主機按「進入黑夜」才開始夜晚（Leo 2026-10-10）
    // 撞到狼王：狼王先開槍，開完才唸「天黑請閉眼」（見 shoot）
    const chain = dayKill(g, target);
    const over = winnerOf(g, room.setup.counts, room.setup.rules);
    g.day.nightCalled = !over;
    g.day.nightReason = 'knight';
    note(g, ['knight', seatKey(seat), 'duelWith', seatKey(target), 'colon', seatKey(target), 'duelWolf', ...chain, ...(over || g.canShoot.length ? [] : ['nightStart'])]);
  } else {
    // 撞到好人：騎士出局，白天繼續發言、投票
    kill(g, seat);
    note(g, ['knight', seatKey(seat), 'duelWith', seatKey(target), 'colon', seatKey(target), 'duelGood']);
  }
  return ok(checkWin({ ...room, game: g }, room.game.narration?.seq));
}

// 白狼王自爆（2026-10-13）：白天發言時、投票放逐之前；帶走一人（0＝不帶），今天直接天黑（跟騎士撞到狼同一套：
// 唸「天黑請閉眼」、主機按「進入黑夜」）。被帶走的獵人／狼王可以開槍，開完才唸天黑
export function boom(room, clientId, target, now = 0) {
  if (room.phase !== 'day') return fail('只有白天能自爆');
  const blocked = pendingBlock(room); if (blocked) return blocked;
  const seat = L.seatOf(room, clientId);
  const g0 = room.game;
  if (!seat || g0.roles[seat] !== 'whiteKing' || !g0.alive[seat]) return fail('你不能自爆');
  if (g0.day.nightCalled) return fail('今天已經要天黑了');
  if (g0.day.exileDone) return fail('投票放逐之後不能自爆');
  if (g0.canShoot.length) return fail('請等開槍的玩家先選');
  target = Number(target ?? 0);
  if (target && (!g0.alive[target] || target === seat)) return fail('只能帶走活著的其他玩家');
  const g = structuredClone(g0);
  g.day.bindCheck = false; // 白天已經往下走，「天亮睜眼」的綁票檢查結束
  kill(g, seat);
  const chain = target ? dayKill(g, target) : [];
  const over = winnerOf(g, room.setup.counts, room.setup.rules);
  g.day.nightCalled = !over;
  g.day.nightReason = 'boom';
  note(g, [seatKey(seat), ...(target ? ['whiteBoomTook', seatKey(target), 'end'] : ['whiteBoom']), ...chain, ...(over || g.canShoot.length ? [] : ['nightStart'])]);
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
// 綁票：好人白天投不贏、晚上每刀少一個，獵人帶走一隻＝一換一、單靠守衛或解藥只能拖延、單靠毒藥是毒一隻刀一個。
// 只有讓狼變少而好人不變的才打得破，而且狼要剛好等於好人票數：騎士還沒決鬥（白天撞死一隻狼），
// 或守衛活著＋女巫還有毒藥（同一晚毒一隻狼、守住刀）（Leo 2026-10-14 綁票選 A）
function bindCanBreak(g, alive, wolves, votes) {
  if (wolves !== votes) return false;
  const has = role => alive.some(s => g.roles[s] === role);
  return (has('knight') && !g.knightUsed) || (has('guard') && has('witch') && g.potions.poison);
}

export function houseRuleWin(g, rules = R.DEFAULT_RULES) {
  if (!g.day || g.day.pendingDeaths || g.day.idiotChoice || g.canShoot.length) return null;
  const team = s => R.ROLES[g.roles[s]].team;
  const alive = seatsList(g).filter(s => g.alive[s]);
  const n = t => alive.filter(s => team(s) === t).length;
  const wolves = n('wolf'), votes = n('god') + n('villager') - alive.filter(s => g.idiotRevealed.includes(s)).length;
  if (g.day.bindCheck && wolves > 0 && wolves >= votes && !bindCanBreak(g, alive, wolves, votes)) return 'bind';
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
  const house = w ? null : houseRuleWin(g, room.setup.rules);
  if (g.day && !g.canShoot.length) g.day.bindCheck = false; // 綁票只在天亮那一刻看（槍都開完之後）
  if (house) w = 'wolf';
  if (!w) return room;
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
    nightReason: g.day?.nightCalled ? g.day.nightReason ?? 'knight' : null, // 主機畫面標題：騎士撞狼／白狼王自爆
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
    else if (role === 'knight' && g.alive[seat] && !g.knightUsed && !g.day?.idiotChoice && !g.day?.nightCalled && !g.day?.exileDone && !g.canShoot.length) me.canDuel = true;
    if (role === 'whiteKing' && g.alive[seat] && !g.day?.idiotChoice && !g.day?.exileDone && !g.day?.nightCalled && !g.canShoot.length) me.canBoom = true;
  }
  const n = g.night;
  if (room.phase === 'night' && n?.stage === 'acting' && g.alive[seat] && actors(g, curStep(n)).includes(seat)) {
    const act = curBeat(room, n).act;
    if (act === 'guard') me.action = { kind: 'guard', lastGuard: g.lastGuard };
    if (act === 'wolf') me.action = { kind: 'wolf', votes: n.wolfVotes, proposal: n.wolfProposal, killers: killers(g) };
    if (act === 'witchSave') me.action = {
      kind: 'witchSave',
      victim: g.potions.save ? n.wolfTarget : null, // 解藥用掉之後就不告知死亡號碼
      canSave: g.potions.save && Boolean(n.wolfTarget) && (n.wolfTarget !== seat || witchMaySaveSelf(room.setup.rules, g.dayNo)),
      selfBlocked: g.potions.save && n.wolfTarget === seat && !witchMaySaveSelf(room.setup.rules, g.dayNo),
      saveUsedUp: !g.potions.save,
    };
    if (act === 'witchPoison') me.action = { kind: 'witchPoison', canPoison: g.potions.poison && !n.witchSave, savedTonight: n.witchSave, poisonUsedUp: !g.potions.poison };
    if (act === 'seer') me.action = { kind: 'seer', checked: n.seerTarget ? g.seerChecks.at(-1) : null };
    if (act === 'beauty') me.action = { kind: 'beauty' };
    if (act === 'gargoyle') me.action = { kind: 'gargoyle', checked: n.gargoyleTarget ? g.gargoyleChecks.at(-1) : null };
    if (act === 'grave') me.action = { kind: 'grave', info: graveFor(g) };
    // 帶槍手勢（獵人、狼王同一套）：被毒、或今晚會殉情（狼美人今晚死、魅惑的是你）都不能開槍
    if (act === 'hunter' || act === 'king') me.action = { kind: act, canShoot: !nightDeaths(g, n).noSkill.has(seat) };
  }
  return me;
}
