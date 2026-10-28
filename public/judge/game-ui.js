// 對局畫面（黑夜／白天／結束）。所有人共用一個畫面，依「你是誰、輪到誰」顯示不同區塊。
import { ROLES, TEAM_NAME, boardByTeam } from '../shared/roles.js';
import { portrait } from '../shared/art.js';

const SKIP_MS = 25000; // 跟伺服器 src/engine.js 的 SKIP_MS 一樣（Leo 2026-10-27 從 30 減 5 秒）
const STEP_NAME = { guard: '守衛', wolf: '狼人', beauty: '狼美人', hidden: '隱狼', witch: '女巫', seer: '預言家', gargoyle: '石像鬼', gravekeeper: '守墓人', hunter: '獵人', king: '狼王', police: '上警' };

let c;              // { state, $, setHTML, esc, send, toast, voice, ui, render, takeHost }
const FRESH = { pick: null, pickKey: '', duelOpen: false, boomOpen: false, showMe: false, meKey: '', confirm: null, sheriffPick: null, sheriffOpen: false, skillPick: null, badgePick: null };
const ui = { ...FRESH, dealNo: null };

export function renderGame(ctx) {
  c = ctx;
  const { state, $, setHTML, esc } = c;
  const g = state.game, me = state.you.game, seat = state.you.seat, phase = state.phase;
  // 新的一局（重開、再來一局、重新發牌）：上一局打開的身分、沒按完的確認框、選好的號碼全部清掉（2026-10-22 驗測：新身分直接攤在螢幕上）
  if (state.dealNo !== ui.dealNo) Object.assign(ui, FRESH, { dealNo: state.dealNo });

  $('#phaseTag').textContent = phase === 'night' ? `第 ${g.dayNo} 夜` : phase === 'day' ? `第 ${g.dayNo} 天` : '遊戲結束';
  $('#gameCode').textContent = state.code;
  $('#seatMini').textContent = seat ? `・你是 ${seat} 號` : state.you.isHost ? '・主機' : '・沒有座位';
  document.body.classList.toggle('is-night', phase === 'night');

  setHTML($('#narration'), g.narration ? `<span>${esc(g.narration.text)}</span>` : '');

  // 結束：勝負
  const win = $('#winnerBox');
  win.hidden = phase !== 'ended';
  if (phase === 'ended') {
    const good = g.winner === 'good';
    setHTML(win, `<div class="win-title ${good ? 'good' : 'wolf'}">${good ? '好人陣營獲勝' : '狼人陣營獲勝'}</div>
      ${seat && state.you.role ? `<p class="win-me">${(ROLES[state.you.role].team === 'wolf') === !good ? '你贏了！' : '你輸了…'}</p>` : ''}`);
  }

  // 夜裡：沒輪到你、或你已出局 → 每支手機都一樣的閉眼畫面
  const acting = phase === 'night' && me?.alive && me?.action;
  const cover = $('#nightCover');
  cover.hidden = !(phase === 'night' && seat && !acting);

  renderAction();
  renderVote();
  renderHost();
  renderTakeover();
  renderBoard();
  renderMyInfo();

  // 投票那一行畫成統計表（Leo 2026-10-28）；其他照文字
  setHTML($('#logList'), g.log.slice().reverse().map(e => (e.vote
    ? `<li class="vote-log"><span class="d">第 ${e.day} 天</span>第 ${e.vote.round ?? 1} 輪${e.vote.pk ? ' PK ' : ''}投票統計：${voteEnd(e.vote)}${tallyHTML(e.vote)}</li>`
    : `<li><span class="d">第 ${e.day} 天</span>${esc(e.text)}</li>`)).join(''));
}

/* ───────── 選座位的小格子 ───────── */
function picker(list, selected, attr = 'data-pick') {
  return `<div class="seats pick">${list.map(o =>
    `<button type="button" class="seat taken${o.disabled ? ' off' : ''}${selected === o.n ? ' chosen' : ''}" ${attr}="${o.n}"${o.disabled ? ' disabled' : ''} aria-label="${o.n} 號${o.note ? '（' + o.note + '）' : ''}">
      <span class="n">${o.n}</span>${o.note ? `<span class="tag">${c.esc(o.note)}</span>` : ''}</button>`).join('')}</div>`;
}
function aliveSeats({ except = [] } = {}) {
  const g = c.state.game;
  return Object.keys(g.alive).map(Number).sort((a, b) => a - b).filter(s => g.alive[s] && !except.includes(s));
}

// 隱狼看到的狼同伴（狼隊，不含石像鬼）：出局的標出來
const hiddenMatesLine = (me, seat) => `<p class="witch-info">狼同伴：${me.wolves.filter(w => w.seat !== seat).map(w => `<b class="digits">${w.seat}</b> 號${w.king ? '（狼王）' : ''}${w.alive ? '' : '（已出局）'}`).join('、') || '沒有'}</p>`;

/* ───────── 自己的動作 ───────── */
function renderAction() {
  const { state, $, setHTML } = c;
  const box = $('#actionBox');
  const me = state.you.game, seat = state.you.seat, phase = state.phase, g = state.game;
  if (!seat || !me) { box.hidden = true; return; }

  // 換了一個動作就清掉剛才選的座位
  const key = `${phase}|${g.dayNo}|${me.action?.kind ?? ''}|${me.canShoot ? 's' : ''}|${me.canDuel ? 'd' : ''}|${me.canBoom ? 'b' : ''}|${me.vote ? 'v' + g.vote?.round : ''}|${me.passBadge ? 'p' : ''}`;
  if (key !== ui.pickKey) { ui.pickKey = key; ui.pick = null; ui.skillPick = null; ui.badgePick = null; ui.duelOpen = false; ui.boomOpen = false; ui.confirm = null; }
  const pick = ui.pick;
  let html = '';
  // 「是否正確」：選好之後先確認，按「正確」才送出（照手稿：上帝回比號碼確認；白天投票也一樣）
  const confirmBox = ui.confirm
    ? `<div class="confirm"><p>${ui.confirm.text}，是否正確？</p>
        <div class="row-gap"><button class="btn primary" type="button" data-do="yes">正確</button><button class="btn" type="button" data-do="no">重選</button></div></div>`
    : '';

  if (phase === 'night' && me.alive && me.action) {
    const a = me.action;
    if (a.kind === 'guard') {
      html = `<h2>請選擇今晚要守護的玩家</h2>
        ${picker(aliveSeats().map(n => ({ n, disabled: n === a.lastGuard, note: n === a.lastGuard ? '昨晚守過' : n === seat ? '自己' : '' })), pick)}
        ${confirmBox || `<div class="row-gap"><button class="btn primary" type="button" data-do="guard"${pick ? '' : ' disabled'}>守護 ${pick ?? '…'} 號</button>
        <button class="btn" type="button" data-do="guard0">今晚不守</button></div>`}`;
    } else if (a.kind === 'wolf') {
      const wolves = me.wolves.filter(w => a.killers.includes(w.seat)); // 今晚一起殺人的（狼隊死光後是石像鬼；只剩隱狼時是隱狼自己）
      const votesFor = n => wolves.filter(w => a.votes[w.seat] === n).map(w => w.seat + '號');
      const voteText = v => (v === undefined || v === null ? '還沒選' : v === 0 ? '空刀' : v + ' 號');
      const myVote = a.votes[seat];
      const king = me.wolves.find(w => w.king);
      const agreed = a.proposal !== null && a.proposal !== undefined;
      // 隱狼那步（只剩隱狼）：主機只唸「隱狼請睜眼」，要做什麼寫在手機上（Leo 2026-10-28）
      html = a.hiddenAlone
        ? `<h2>隱狼：請選擇今晚要擊殺的玩家</h2>
          <p class="hint">其他狼都出局了，現在由你刀人。主機不會唸出來，直接在手機上選；選好按「正確」就閉眼。</p>
          ${hiddenMatesLine(me, seat)}`
        : `<h2>今晚要擊殺的目標是？</h2>
          <p class="hint">你的隊友：${wolves.filter(w => w.seat !== seat).map(w => `${w.seat} 號`).join('、') || '沒有'}${king ? `　<b>狼王是 ${king.seat} 號</b>${king.alive ? '' : '（已出局）'}` : ''}</p>`;
      html += `
        ${agreed
          ? `<div class="confirm"><p>${a.proposal ? `今晚要擊殺的玩家是 <b class="digits">${a.proposal}</b> 號` : '今晚空刀'}，是否正確？</p>
              <div class="row-gap"><button class="btn primary" type="button" data-do="wolfYes">正確</button><button class="btn" type="button" data-do="wolfNo">重選</button></div>
              ${a.hiddenAlone ? '' : '<p class="hint small">任何一隻狼按「正確」就確定。</p>'}</div>`
          : `<p class="hint">${a.hiddenAlone ? '點一個號碼（或按空刀）之後，會問「是否正確」。' : '在線上的狼（掉線的不算）都點同一個人（或都按空刀）之後，會問「是否正確」。'}</p>
            ${picker(aliveSeats().map(n => { const v = votesFor(n); const no = a.noKnife?.includes(n); return { n, disabled: no, note: no ? '不能刀' : v.join(' ') }; }), myVote || null)}
            <div class="row-gap"><button class="btn${myVote === 0 ? ' primary' : ''}" type="button" data-do="wolf0">今晚空刀</button></div>
            ${a.hiddenAlone ? '' : `<ul class="votes">${wolves.map(w => `<li>${w.seat} 號${w.seat === seat ? '（你）' : ''}：${voteText(a.votes[w.seat])}</li>`).join('')}</ul>`}`}`;
    } else if (a.kind === 'hiddenMates') {
      // 隱狼睜眼看狼同伴（Leo 2026-10-28）：其他狼還活著，今晚他們刀，隱狼不用動作
      html = `<h2>隱狼：你的狼同伴</h2>
        ${hiddenMatesLine(me, seat)}
        <p class="hint">其他狼還活著，今晚由他們刀人，你不用刀。看完按「知道了」，主機就唸「隱狼請閉眼」。</p>
        <button class="btn primary big" type="button" data-do="hiddenSeen">知道了</button>`;
    } else if (a.kind === 'witchSave') {
      const info = a.saveUsedUp ? '解藥已經用掉了，不會告知今晚死亡的玩家。'
        : a.victim ? `今晚死亡的玩家是 <b class="digits">${a.victim}</b> 號。` : '今晚沒有人死亡。';
      html = `<h2>請問你要使用解藥嗎？</h2>
        <p class="witch-info">${info}</p>
        ${a.selfBlocked ? '<p class="hint">依照規則，女巫不能救自己。</p>' : ''}
        <p class="hint">一晚只能用一瓶藥：用了解藥，今晚就不能再用毒藥。</p>
        ${confirmBox || `<div class="row-gap">
          ${a.canSave ? `<button class="btn primary" type="button" data-do="save">👍 救 ${a.victim} 號</button>` : ''}
          <button class="btn${a.canSave ? '' : ' primary'}" type="button" data-do="noSave">${a.canSave ? '👎 不救' : '繼續'}</button>
        </div>`}`;
    } else if (a.kind === 'witchPoison') {
      html = `<h2>請問你要使用毒藥嗎？</h2>
        ${a.savedTonight ? '<p class="hint">今晚已經用過解藥，不能再用毒藥。</p>'
          : a.poisonUsedUp ? '<p class="hint">毒藥已經用掉了。</p>'
          : `<p class="hint">如果要，請選擇你要毒殺的號碼。</p>
            ${picker(aliveSeats({ except: [seat] }).map(n => ({ n })), pick)}`}
        ${confirmBox || `<div class="row-gap">
          ${a.canPoison ? `<button class="btn primary" type="button" data-do="poison"${pick ? '' : ' disabled'}>毒 ${pick ?? '…'} 號</button>` : ''}
          <button class="btn${a.canPoison ? '' : ' primary'}" type="button" data-do="none">${a.canPoison ? '不使用' : '繼續'}</button></div>`}`;
    } else if (a.kind === 'seer') {
      if (a.checked) {
        html = `<h2>他的身分是……</h2>
          <div class="seer-result ${a.checked.wolf ? 'wolf' : 'good'}"><span class="digits">${a.checked.target}</span> 號是 <b>${a.checked.wolf ? '👎 狼人' : '👍 好人'}</b></div>
          <button class="btn primary big" type="button" data-do="seerDone">知道了</button>`;
      } else {
        html = `<h2>請問你今晚要查驗的玩家是？</h2>
          ${picker(aliveSeats({ except: [seat] }).map(n => ({ n })), pick)}
          ${confirmBox || `<button class="btn primary big" type="button" data-do="seer"${pick ? '' : ' disabled'}>查驗 ${pick ?? '…'} 號</button>`}`;
      }
    } else if (a.kind === 'beauty') {
      html = `<h2>請選擇今晚要魅惑的玩家</h2>
        <p class="hint">你被放逐、被槍帶走、被白狼王帶走時，今晚魅惑的人會跟著殉情出局（不能發動技能）；被騎士撞死、被女巫毒死不會殉情。</p>
        ${a.lastCharm ? `<p class="hint">不能連續兩晚魅惑同一位：昨晚魅惑的是 ${a.lastCharm} 號。</p>` : ''}
        ${picker(aliveSeats({ except: [seat] }).map(n => ({ n, disabled: n === a.lastCharm, note: n === a.lastCharm ? '昨晚魅惑過' : '' })), pick)}
        ${confirmBox || `<div class="row-gap"><button class="btn primary" type="button" data-do="beauty"${pick ? '' : ' disabled'}>魅惑 ${pick ?? '…'} 號</button>
        <button class="btn" type="button" data-do="beauty0">今晚不魅惑</button></div>`}`;
    } else if (a.kind === 'gargoyle') {
      if (a.checked) {
        html = `<h2>他的身分是……</h2>
          <div class="seer-result ${ROLES[a.checked.role].team === 'wolf' ? 'wolf' : 'good'}"><span class="digits">${a.checked.target}</span> 號是 <b>${ROLES[a.checked.role].name}</b></div>
          <button class="btn primary big" type="button" data-do="gargoyleDone">知道了</button>`;
      } else {
        html = `<h2>請問你今晚要查驗的玩家是？</h2>
          <p class="hint">石像鬼看得到具體身分。</p>
          ${picker(aliveSeats({ except: [seat] }).map(n => ({ n })), pick)}
          ${confirmBox || `<button class="btn primary big" type="button" data-do="gargoyle"${pick ? '' : ' disabled'}>查驗 ${pick ?? '…'} 號</button>`}`;
      }
    } else if (a.kind === 'grave') {
      html = `<h2>昨天被放逐的玩家，他的陣營是</h2>
        ${a.info ? `<div class="seer-result ${a.info.wolf ? 'wolf' : 'good'}"><span class="digits">${a.info.seat}</span> 號是 <b>${a.info.wolf ? '👎 狼人' : '👍 好人'}</b></div>`
          : '<p class="witch-info">昨天沒有人被放逐出局。</p>'}
        <button class="btn primary big" type="button" data-do="graveSeen">知道了</button>`;
    } else if (a.kind === 'hunter' || a.kind === 'king') {
      html = `<h2>你今晚的帶槍手勢是</h2>
        <div class="seer-result ${a.canShoot ? 'good' : 'wolf'}"><b>${a.canShoot ? '👍 可以開槍' : '👎 今晚不能開槍'}</b></div>
        <button class="btn primary big" type="button" data-do="hunterSeen">知道了</button>`;
    }
    // 伺服器更新了、這支手機還開著舊網頁：輪到它不認得的步驟會一片空白、卡住整晚（Leo 2026-10-17 狼王沒有按鈕）
    if (!html) html = `<h2>輪到你了，但這支手機的網頁是舊版</h2>
      <p class="hint">請按下面重新整理（座位和身分都會保留）。</p>
      <button class="btn primary big" type="button" data-do="reload">重新整理</button>`;
  } else if (phase === 'day' && me.idiotChoose) {
    html = `<h2>你被放逐了</h2>
      <p class="hint">你是白癡，可以選擇翻牌：翻牌就不會出局，但之後不能投票。也可以不翻，直接出局。按下後主機會公開宣布。</p>
      <div class="row-gap"><button class="btn primary" type="button" data-do="idiotFlip">翻牌（免於出局）</button>
      <button class="btn" type="button" data-do="idiotOut">不翻牌，出局</button></div>`;
  } else if (phase === 'day' && me.passBadge) {
    // 警長出局：自己選要移交給誰、還是撕掉警徽（Leo 2026-10-27：警長自己選，主機不能代按）
    const pick = ui.badgePick;
    html = me.alive
      ? `<h2>你是警長，你翻牌了</h2>
      <p class="hint">你被公投出局、失去投票權（Leo 2026-10-28）：請先口頭發表遺言，再選要把警徽移交給誰，或撕掉警徽（不交給任何人）。按下後全場紀錄會寫出來。</p>`
      : `<h2>你是警長，你出局了</h2>
      <p class="hint">請選要把警徽移交給誰，或撕掉警徽（不交給任何人）。按下後全場紀錄會寫出來。</p>`;
    html += `
      ${picker(me.passBadge.candidates.map(n => ({ n })), pick, 'data-badge-pick')}
      <div class="row-gap"><button class="btn primary" type="button" data-do="passBadge"${pick ? '' : ' disabled'}>移交給 ${pick ?? '…'} 號</button>
      <button class="btn" type="button" data-do="tearBadge">撕掉警徽</button></div>`;
  } else if (phase === 'day' && me.canShoot) {
    html = `<h2>你可以發動技能</h2>
      <p class="hint">帶走一個人，或選擇不發動。帶人的話主機會公開宣布；不發動主機不唸。</p>
      ${g.badgePending && g.sheriff === seat ? '<p class="hint">你是警長：先處理技能，接著再選要移交還是撕掉警徽（Leo 2026-10-28）。</p>' : ''}
      ${picker(aliveSeats({ except: [seat] }).map(n => ({ n })), pick)}
      <div class="row-gap"><button class="btn primary" type="button" data-do="shoot"${pick ? '' : ' disabled'}>帶走 ${pick ?? '…'} 號</button>
      <button class="btn" type="button" data-do="shoot0">不發動</button></div>`;
  } else if (phase === 'day' && me.vote) {
    // 白天投票（Leo 2026-10-27）：每個有票的人畫面一樣，投完等大家，統計同時出現在每支手機（見 renderVote）
    const v = me.vote;
    html = v.mine !== null
      ? `<h2>你投了${v.mine ? ` <b class="digits">${v.mine}</b> 號` : '棄票'}</h2>
        <p class="hint">等其他人投完，每支手機會同時出現投票統計。</p>`
      : `<h2>${g.vote?.pk ? '平票 PK：' : ''}請投票</h2>
        <p class="hint">點你要放逐的號碼${g.sheriff === seat ? '（你是警長，算 1.5 票）' : ''}，投了就不能改。</p>
        ${picker(v.candidates.map(n => ({ n })), pick)}
        ${confirmBox || `<div class="row-gap"><button class="btn primary" type="button" data-do="vote"${pick ? '' : ' disabled'}>投 ${pick ?? '…'} 號</button>
        <button class="btn" type="button" data-do="vote0">棄票</button></div>`}`;
  } else if (phase === 'day' && g.vote?.open && g.vote.pk && g.vote.candidates.includes(seat)) {
    // 平票 PK：PK 的人這輪不投票，只有其他人投（Leo 2026-10-27）
    html = `<h2>平票 PK：你是被投的人</h2>
      <p class="hint">這輪你不能投票，由其他人在 ${g.vote.candidates.join('、')} 號裡選。等大家投完，每支手機會同時出現結果。</p>`;
  } else if (phase !== 'ended' && !me.alive) {
    html = `<p class="out">你已出局。可以留遺言（如果還有的話），之後請靜靜看戲，不要透露訊息。</p>`;
  } else if (me.idiotRevealed) {
    html = `<p class="out">你已翻牌（白癡）：還活著，但不能投票。</p>`;
  }
  box.hidden = !html;
  setHTML(box, html);
}

function onAction(e) {
  // 騎士決鬥、自爆另外選號（2026-10-27 審查：跟投票共用同一格，決鬥點了號碼投票也跟著選好）
  const bp = e.target.closest('[data-badge-pick]');
  if (bp) { const n = Number(bp.dataset.badgePick); ui.badgePick = ui.badgePick === n ? null : n; c.render(); return; }
  const sp = e.target.closest('[data-skill-pick]');
  if (sp) { const n = Number(sp.dataset.skillPick); ui.skillPick = ui.skillPick === n ? null : n; c.render(); return; }
  const p = e.target.closest('[data-pick]');
  if (p) {
    const n = Number(p.dataset.pick);
    if (c.state.you.game?.action?.kind === 'wolf') { c.send({ type: 'act', payload: { target: n } }); return; } // 狼人點了就投票
    if (ui.confirm) return; // 正在問「是否正確」時，先回答再重選
    ui.pick = ui.pick === n ? null : n;
    c.render();
    return;
  }
  const d = e.target.closest('[data-do]');
  if (!d) return;
  const pick = ui.pick, act = payload => c.send({ type: 'act', payload });
  // 主機也是玩家時：確認視窗可能把主機的聲音暫停，按完順便恢復（其他手機不出聲，不用）
  const confirm = msg => { const yes = window.confirm(msg); if (c.state.you.isHost) c.voice.unlock(); return yes; };
  const ask = (text, payload) => { ui.confirm = { text, payload }; c.render(); };
  switch (d.dataset.do) {
    // 先問「是否正確」
    case 'guard': ask(`今晚要守護的玩家是 ${pick} 號`, { target: pick }); break;
    case 'guard0': ask('今晚不守護任何人', { target: 0 }); break;
    case 'poison': ask(`今晚要毒殺的玩家是 ${pick} 號`, { use: 'poison', target: pick }); break;
    case 'seer': ask(`今晚要查驗的玩家是 ${pick} 號`, { target: pick }); break;
    case 'gargoyle': ask(`今晚要查驗的玩家是 ${pick} 號`, { target: pick }); break;
    case 'beauty': ask(`今晚要魅惑的玩家是 ${pick} 號`, { target: pick }); break;
    case 'beauty0': ask('今晚不魅惑任何人', { target: 0 }); break;
    case 'yes': if (ui.confirm.vote) c.send({ type: 'vote', target: ui.confirm.payload.target }); else act(ui.confirm.payload); ui.confirm = null; break;
    // 白天投票：也先問「是否正確」
    case 'vote': ui.confirm = { text: `投給 ${pick} 號`, payload: { target: pick }, vote: true }; c.render(); break;
    case 'vote0': ui.confirm = { text: '這輪棄票', payload: { target: 0 }, vote: true }; c.render(); break;
    case 'no': ui.confirm = null; ui.pick = null; c.render(); break;
    // 狼人：全體一致後由任何一隻確認
    case 'wolf0': act({ target: 0 }); break;
    case 'wolfYes': act({ confirm: true }); break;
    case 'wolfNo': act({ reset: true }); break;
    // 女巫解藥（👍／👎）、毒藥不用：有得選才問「是否正確」（Leo 2026-10-22 ⑦A）；沒得選的「繼續」直接送
    case 'save': ask(`今晚要用解藥救 ${c.state.you.game.action.victim} 號`, { use: 'save' }); break;
    case 'noSave': if (c.state.you.game.action.canSave) ask('今晚不使用解藥', { use: 'skip' }); else act({ use: 'skip' }); break;
    case 'none': if (c.state.you.game.action.canPoison) ask('今晚不使用毒藥', { use: 'none' }); else act({ use: 'none' }); break;
    // 預言家看完、獵人看完
    case 'seerDone': act({ done: true }); break;
    case 'gargoyleDone': act({ done: true }); break;
    case 'graveSeen': act({ seen: true }); break;
    case 'hunterSeen': act({ seen: true }); break;
    case 'hiddenSeen': act({ seen: true }); break; // 隱狼看完狼同伴（Leo 2026-10-28）
    case 'reload': location.reload(); break;
    case 'passBadge': if (ui.badgePick && confirm(`把警徽移交給 ${ui.badgePick} 號？`)) { c.send({ type: 'passBadge', target: ui.badgePick }); ui.badgePick = null; } break;
    case 'tearBadge': if (confirm('撕掉警徽？不交給任何人。')) c.send({ type: 'passBadge', target: 0 }); break;
    case 'shoot': if (confirm(`確定帶走 ${pick} 號？`)) c.send({ type: 'shoot', target: pick }); break;
    case 'shoot0': if (confirm('確定不發動技能？之後不能反悔。')) c.send({ type: 'shoot', target: 0 }); break;
    case 'duelOpen': ui.duelOpen = true; c.render(); break;
    case 'duelClose': ui.duelOpen = false; ui.skillPick = null; c.render(); break;
    case 'duel': if (confirm(`確定和 ${ui.skillPick} 號決鬥？猜錯的話你會出局。`)) c.send({ type: 'duel', target: ui.skillPick }); break;
    case 'boomOpen': ui.boomOpen = true; c.render(); break;
    case 'boomClose': ui.boomOpen = false; ui.skillPick = null; c.render(); break;
    case 'boom': if (confirm(`確定自爆、帶走 ${ui.skillPick} 號？`)) c.send({ type: 'boom', target: ui.skillPick }); break;
    case 'boom0': if (confirm(c.state.you.game?.boomTake ? '確定自爆、不帶走任何人？' : '確定自爆？你會出局，今天直接天黑。')) c.send({ type: 'boom', target: 0 }); break;
    case 'idiotFlip': if (confirm('確定翻牌？翻牌後不會出局，但之後不能投票。')) c.send({ type: 'idiot', flip: true }); break;
    case 'idiotOut': if (confirm('確定不翻牌、直接出局？')) c.send({ type: 'idiot', flip: false }); break;
  }
}

/* ───────── 主機控制 ───────── */
function renderHost() {
  const { state, $, setHTML, voice } = c;
  const box = $('#hostCtl');
  const isHost = state.you.isHost, g = state.game, phase = state.phase;
  box.hidden = !isHost;
  if (!isHost) return;
  const done = h => setHTML(box, seatRequestsHTML(state.seatRequests) + h + restartRow(phase)); // 最上面是換手機的申請；每個畫面最下面都有「直接重開」

  const bgm = `<button class="btn small" type="button" data-host="bgm">背景音樂：${voice.bgmOn ? '開' : '關'}</button>
    <button class="btn small" type="button" data-host="voice">主持聲音：${voice.voiceName}</button>`;
  let html = '';
  if (phase === 'night') {
    const step = g.night?.step;
    html = `<h2>主持中</h2>
      <p class="hint">${step ? `現在輪到：<b>${STEP_NAME[step]}</b>` : '過場中…'}　手機會自動唸台詞、自動往下走。</p>
      <div class="row-gap"><button class="btn small" type="button" data-host="replay">再唸一次</button>${bgm}</div>
      ${step === 'police' ? `<button class="btn primary big" type="button" data-host="policeDone">大家都起立好了，天亮</button>
        <p class="hint center">不按的話，大約 7～10 秒後會自動天亮。</p>` : skipBox(g.night)}`;
  } else if (phase === 'day') {
    if (g.deathsPending) {
      // 第一天：先選警長（口頭競選、主機登記）；登記完（或警徽流失）就直接唸「N 號玩家當選警長。」接著昨晚死訊（Leo 2026-10-28）
      html = `<h2>警長競選</h2>
        <p class="hint">請上警的玩家依序發言，其他人口頭（或舉手）選出警長，選好在下面登記。登記完會直接唸「N 號玩家當選警長」，接著公布昨晚的死訊；沒人當選就按「警徽流失」，也會直接公布。</p>
        ${sheriffHTML(g)}
        <div class="row-gap"><a class="btn small" href="../" target="_blank" rel="noopener">發言順序轉盤 ↗</a></div>`;
      done(html);
      return;
    }
    if (g.nightCalled) {
      // 騎士撞到狼、白狼王／狼人自爆：今天不放逐，「天黑請閉眼」已經唸過了，等主機按
      html = `<h2>${NIGHT_REASON[g.nightReason] ?? '直接天黑'}</h2>
        <p class="hint">${g.nightReason === 'noExile' ? '已經唸了「天黑請閉眼」，今天到此結束。' : '今天不投票放逐，直接天黑。有人要開槍的話先讓他開完，再按下面的按鈕。'}</p>
        ${sheriffHTML(g)}
        <button class="btn primary big" type="button" data-host="night">進入黑夜</button>
        <div class="row-gap">${bgm}</div>`;
      done(html);
      return;
    }
    if (g.idiotChoice) {
      html = `<h2>白天</h2>
        <p class="hint">等 ${g.idiotChoice} 號在自己的手機上選擇……</p>`;
      done(html);
      return;
    }
    const v = g.vote;
    // 投票（Leo 2026-10-27；10-28 起主機不選放逐對象）：主機只按「進行投票」→ 每個活人在手機上投 → 投完自動：
    // 單一最高票放逐、平票自動 PK（平票以外的人投）、PK 又平票或全部棄票＝今天沒人出局、直接天黑
    html = `<h2>白天</h2>
      ${sheriffHTML(g)}
      <p class="hint">請大家依序發言，發言完按「進行投票」：主機唸「請大家進行投票」，活著的玩家在自己手機上投（可以棄票）。投完自動處理：只有一個最高票就放逐、唸出局；平票就自動 PK（平票以外的人再投一次）；PK 又平票或全部棄票＝今天沒人出局、直接天黑。</p>
      ${g.exileDone ? '<p class="done">✓ 今天的放逐已登記</p>' : v?.open ? `
        <p class="done">${v.pk ? `平票 PK（${v.candidates.join('、')} 號）` : '投票'}中：已投 ${v.voted}／${v.voters.length} 人</p>
        ${votedLine(v)}
        <div class="row-gap"><button class="btn" type="button" data-host="endVote">結束投票（沒投的算棄票）</button></div>` : `
        <div class="row-gap"><button class="btn primary big" type="button" data-host="startVote">進行投票</button></div>`}
      <div class="row-gap"><button class="btn primary big" type="button" data-host="night">天黑請閉眼</button></div>
      <div class="row-gap"><a class="btn small" href="../" target="_blank" rel="noopener">發言順序轉盤 ↗</a>${bgm}</div>`;
  } else if (phase === 'ended') {
    html = `<button class="btn primary big" type="button" data-host="restart">再來一局（直接重新發牌）</button>
      <p class="hint center">座位和板子都不變，馬上發新的身分。</p>
      <div class="row-gap"><button class="btn" type="button" data-host="newGame">回到設定（改板子、人數）</button></div>`;
  }
  done(html);
}

// 直接重開（Leo 2026-10-11）：對局中隨時可以按；座位和板子不變，馬上重新發牌。結束畫面上面已經有大按鈕，這裡不重複
function restartRow(phase) {
  if (phase === 'ended') return '';
  return `<div class="restart-row"><span class="hint small">要重來？</span>
    <button class="btn small" type="button" data-host="restart">直接重開</button>
    <button class="btn small" type="button" data-host="newGame">回到設定</button></div>`;
}

// 「跳過」防手機沒電卡死（Leo 2026-10-10）：每個角色一樣——睜眼就出現（灰的）、睜眼 SKIP_MS（25 秒）後才能按，文字不提任何角色。
// 時間從這支手機收到「睜眼」那刻算；伺服器自己也會檢查
function skipBox(night) {
  if (!night?.step || !night.eyesOpen) { clearTimeout(ui.skipTimer); return ''; }
  const key = `${c.state.game.dayNo}|${night.step}|${night.beat}|${night.openedAt}`;
  if (key !== ui.skipKey) { ui.skipKey = key; ui.skipSince = Date.now(); }
  const left = SKIP_MS - (Date.now() - ui.skipSince);
  clearTimeout(ui.skipTimer); // 時間到重畫一次，讓按鈕亮起來（只保留一個計時器）
  if (left > 0) ui.skipTimer = setTimeout(() => c.render(), left + 100);
  return `<div class="row-gap"><button class="btn" type="button" data-host="skip"${left > 0 ? ' disabled' : ''}>跳過（睜眼 ${SKIP_MS / 1000} 秒後可按）</button></div>
    <p class="hint center">手機沒電、沒辦法操作時才按：這一步當作沒有動作。</p>`;
}

// 主機看誰投了、誰還沒投（只有號碼，看不到投給誰；Leo 2026-10-28）。全部投完會自動結算，不會停在這裡
function votedLine(v) {
  const done = v.votedSeats ?? [], wait = v.voters.filter(s => !done.includes(s));
  return `<p class="hint">已投：${done.length ? done.join('、') + ' 號' : '還沒有人'}<br>還沒投：<b>${wait.length ? wait.join('、') + ' 號' : '沒有'}</b></p>`;
}

const NIGHT_REASON = { knight: '騎士撞到狼人', boom: '白狼王自爆', wolfBoom: '狼人自爆', noExile: '今天沒有人出局' };

// 警長（Leo 2026-10-27）：主機登記誰當警長、警長出局移交警徽、撕警徽。全場都看得到（座位表標「警長」、紀錄寫一行）
function sheriffHTML(g) {
  if (g.badgePending) return `<div class="sheriff"><p class="warn"><b>警長 ${g.sheriff} 號${g.alive[g.sheriff] ? '翻牌了（失去投票權，要交出警徽）' : '出局了'}</b>：等他在自己的手機上選要移交給誰、還是撕掉警徽（能開槍的警長先開槍、再選警徽）……</p></div>`;
  const pick = ui.sheriffPick;
  const status = g.sheriff ? `<p class="hint">警長：<b>${g.sheriff} 號</b>（${g.idiotRevealed?.includes(g.sheriff) ? '翻過牌的白癡沒有票（更新前開的房間才會這樣）' : '投票算 1.5 票'}；出局時由他自己選移交或撕警徽）</p>`
    : g.badgeTorn ? '<p class="hint">警徽已撕掉／流失，沒有警長。</p>' : '<p class="hint">還沒有警長。</p>';
  if (g.vote?.open) return `<div class="sheriff">${status}</div>`; // 投票中不能換警長（伺服器也擋；2026-10-28 審查：按鈕在卻按不動）
  if (g.badgeChosen) return `<div class="sheriff">${status}<p class="hint">警徽已經由警長自己處理過，主機不能再改。</p></div>`; // Leo 2026-10-28
  const open = ui.sheriffOpen || (g.deathsPending && !g.sheriff && !g.badgeTorn);
  if (!open) return `<div class="sheriff">${status}<button class="btn small" type="button" data-host="sheriffOpen">${g.sheriff ? '登記錯了，改警長' : '登記警長'}</button></div>`;
  return `<div class="sheriff"><h3>登記警長</h3>${status}
    ${picker(aliveSeats({ except: [g.sheriff, ...(g.idiotRevealed ?? [])] }).map(n => ({ n })), pick, 'data-sheriff-pick')}
    <div class="row-gap"><button class="btn primary small" type="button" data-host="sheriff"${pick ? '' : ' disabled'}>警長是 ${pick ?? '…'} 號</button>
    ${!g.sheriff && !g.badgeTorn ? '<button class="btn small" type="button" data-host="tear">警徽流失（沒有警長）</button>' : ''}
    <button class="btn small" type="button" data-host="sheriffClose">收起</button></div></div>`;
}

function onHost(e) {
  const sp = e.target.closest('[data-sheriff-pick]');
  if (sp) { const n = Number(sp.dataset.sheriffPick); ui.sheriffPick = ui.sheriffPick === n ? null : n; c.render(); return; }
  if (approveFromClick(e, msg => { c.voice.unlock(); c.send(msg); })) return;
  const b = e.target.closest('[data-host]');
  if (!b) return;
  const { voice, state } = c;
  // 主機每按一個按鈕都順便恢復聲音：iPhone 跳出確認視窗時可能把網頁聲音暫停（Leo 2026-10-10 實玩：按放逐後沒聲音、要再按才唸、還唸兩次）
  voice.unlock();
  const confirm = msg => { const yes = window.confirm(msg); voice.unlock(); return yes; };
  const send = msg => { voice.unlock(); c.send(msg); };
  switch (b.dataset.host) {
    case 'replay': voice.stop(); voice.speak(state.game.narration); break;
    case 'voice': voice.toggleSource(); voice.stop(); voice.speak(state.game.narration); c.render(); break; // 切完馬上用新聲音重唸這句
    case 'bgm': voice.toggleBgm(); voice.setNight(state.phase === 'night'); c.render(); break;
    case 'policeDone': send({ type: 'skip' }); break;
    case 'skip': if (confirm('跳過這一步？這一步當作沒有動作。')) send({ type: 'skip' }); break;
    case 'startVote': send({ type: 'startVote' }); break;
    case 'endVote': if (confirm('結束投票？還沒投的人算棄票。')) send({ type: 'endVote' }); break;
    case 'sheriffOpen': ui.sheriffOpen = true; c.render(); break;
    case 'sheriffClose': ui.sheriffOpen = false; ui.sheriffPick = null; c.render(); break;
    case 'sheriff': {
      const n = ui.sheriffPick; if (!n) break;
      if (confirm(state.game.deathsPending ? `登記 ${n} 號當警長？接著會公布昨晚的死訊。` : `登記 ${n} 號當警長？`)) { send({ type: 'sheriff', seat: n }); ui.sheriffOpen = false; ui.sheriffPick = null; }
      break;
    }
    case 'tear': if (confirm(state.game.deathsPending ? '警徽流失？現在沒有警長，接著會公布昨晚的死訊。' : '警徽流失？現在沒有警長。')) { send({ type: 'tearBadge' }); ui.sheriffOpen = false; ui.sheriffPick = null; } break;
    case 'night':
      if (!state.game.exileDone && !state.game.nightCalled && !confirm('今天還沒投票放逐，確定直接天黑？')) return;
      send({ type: 'nextNight' }); break;
    case 'restart':
      if (state.phase !== 'ended' && !confirm('直接重開？這局作廢，座位和板子不變，馬上重新發牌（每個人身分都會換）。')) return;
      // 重開後台詞序號接著舊局往上算（伺服器 G.restart），這裡不能歸零：確認視窗那幾秒收到的舊台詞會被當新的唸、
      // 再把序號拉回去，「請確認角色身分。」反而不唸（2026-10-22 瀏覽器實測）
      voice.stop(); voice.setNight(false); voice.holdUntil('checkRole'); send({ type: 'restart' }); break;
    case 'newGame':
      if (state.phase !== 'ended' && !confirm('這局作廢，回到設定（可以改板子、人數）？')) return;
      voice.stop(); voice.setNight(false); send({ type: 'newGame' }); break;
  }
}

/* ───────── 投票統計（每支手機都一樣，Leo 2026-10-27） ───────── */
function renderVote() {
  const { state, $, setHTML } = c;
  const box = $('#voteBox');
  const v = state.phase === 'day' || state.phase === 'ended' ? state.game.vote : null; // 這一票直接結束遊戲：結算畫面也看得到統計（2026-10-28 審查）
  box.hidden = !v;
  if (!v) return;
  if (v.open) {
    const prev = v.pk && v.prev ? `<p class="hint">上一輪：${v.prev.rows.map(x => `${x.target} 號 ${x.score} 票`).join('、')}（誰投誰見下面全場紀錄）。</p>` : ''; // 平票自動 PK（Leo 2026-10-28）
    const pkLine = v.pk ? `<p class="hint">PK：${v.candidates.join('、')} 號（這輪不投票）；投票的人：${v.voters.join('、')} 號。</p>${prev}` : '';
    setHTML(box, `<h2>${v.pk ? '平票 PK 投票中' : '投票中'}</h2>${pkLine}<p class="hint">已投 ${v.voted}／${v.voters.length} 人。投完後每支手機同時出現統計。</p>`);
    return;
  }
  const r = v.result;
  setHTML(box, `<h2>${r.pk ? '平票 PK ' : ''}投票統計</h2>${tallyHTML(r)}<p class="done">${voteEnd(r)}</p>`);
}

// 投票統計表：每支手機的統計框、全場紀錄共用（Leo 2026-10-28：紀錄要統計的方式）
function tallyHTML(r) {
  const who = list => list.map(s => (s === r.sheriff ? `${s} 號（警長 1.5 票）` : `${s} 號`)).join('、');
  return `<ul class="tally">${r.rows.map(x => `<li${r.top.includes(x.target) ? ' class="top"' : ''}><b class="digits">${x.target} 號</b><span class="score">${x.score} 票</span><span class="by">${who(x.voters)}投</span></li>`).join('')}
      ${r.abstain.length ? `<li><b>棄票</b><span class="score"></span><span class="by">${who(r.abstain)}</span></li>` : ''}</ul>`;
}
const voteEnd = r => (!r.top.length ? '沒有人得票。' : r.top.length > 1 ? `平票：${r.top.join('、')} 號` : `最高票：${r.top[0]} 號`);

/* ───────── 公開的座位表 ───────── */
function renderBoard() {
  const { state, $, setHTML } = c;
  const g = state.game;
  const seats = Object.keys(g.alive).map(Number).sort((a, b) => a - b);
  $('#aliveCount').textContent = `存活 ${seats.filter(s => g.alive[s]).length}／${seats.length}`;
  setHTML($('#gameBoard'), `<div class="gb-title">本局板子</div>` +
    boardByTeam(state.setup.counts).map(x => `<div class="gb-row"><b>${x.label}</b>${x.text}</div>`).join(''));
  setHTML($('#boardSeats'), seats.map(n => {
    const role = g.allRoles?.[n];
    const tag = role ? ROLES[role].name : g.idiotRevealed.includes(n) ? '白癡' : n === state.you.seat ? '你' : '';
    const tags = [tag, n === g.sheriff ? '警長' : ''].filter(Boolean).join('・');
    return `<div class="seat taken${g.alive[n] ? '' : ' dead'}${n === state.you.seat ? ' mine' : ''}${role ? ' revealed' : ''}">
      ${role ? `<span class="mini">${portrait(role)}</span>` : ''}<span class="n">${n}</span>${tags ? `<span class="tag">${tags}</span>` : ''}</div>`;
  }).join(''));
}

/* ───────── 自己的身分（點開才看） ───────── */
function renderMyInfo() {
  const { state, $, setHTML, esc } = c;
  const box = $('#myInfo');
  const role = state.you.role, me = state.you.game;
  box.hidden = !role || !me;
  if (box.hidden) return;
  // 換階段（天黑、天亮）就自動蓋起來：手機放桌上時打開的身分不會一直露著（夜班菜單 4A）
  const phaseKey = `${state.phase}|${state.game?.dayNo}`;
  if (phaseKey !== ui.meKey) { ui.meKey = phaseKey; ui.showMe = false; }
  if (!ui.showMe) { setHTML(box, `<button class="btn big" type="button" data-me="show">看我的身分（先確定旁人看不到）</button>`); return; }
  const r = ROLES[role];
  const lines = [];
  if (me.wolves) lines.push(`狼隊友：${me.wolves.filter(w => w.seat !== state.you.seat).map(w => `${w.seat} 號${w.king ? '（狼王）' : ''}${w.alive ? '' : '（已出局）'}`).join('、') || '沒有'}`);
  if (role === 'hidden') lines.push('狼隊友不知道你是隱狼。其他狼還活著時你不刀人、也不能自爆；其他狼都出局（只剩你）時，夜裡「隱狼請睜眼」那步由你在手機上選要殺誰。');
  if (me.gargoyleChecks) lines.push(me.gargoyleChecks.length ? '查驗紀錄：' + me.gargoyleChecks.map(x => `第 ${x.day} 夜 ${x.target} 號是${ROLES[x.role].name}`).join('；') : '查驗紀錄：還沒有');
  if (me.graveChecks) lines.push(me.graveChecks.length ? '守墓紀錄：' + me.graveChecks.map(x => `第 ${x.day} 天放逐的 ${x.seat} 號是${x.wolf ? '狼人' : '好人'}`).join('；') : '守墓紀錄：還沒有');
  if (role === 'beauty') lines.push(`目前魅惑：${me.charm ? me.charm + ' 號' : '沒有'}`);
  if (me.seerChecks) lines.push(me.seerChecks.length ? '查驗紀錄：' + me.seerChecks.map(x => `第 ${x.day} 夜 ${x.target} 號是${x.wolf ? '狼人' : '好人'}`).join('；') : '查驗紀錄：還沒有');
  if (me.potions) lines.push(`解藥：${me.potions.save ? '還有' : '用掉了'}；毒藥：${me.potions.poison ? '還有' : '用掉了'}`);
  if (role === 'guard') lines.push(`昨晚守護：${me.lastGuard ? me.lastGuard + ' 號' : '沒有'}（今晚不能再守同一人）`);
  setHTML(box, `<div class="me-row"><div class="thumb big">${portrait(role)}</div>
      <div><div class="role-name sm team-${r.team}">${esc(r.name)}</div><div class="hint">${esc(TEAM_NAME[r.team])}${me.alive ? '' : '・已出局'}</div></div></div>
    <p class="role-desc">${esc(r.desc)}</p>
    ${lines.map(l => `<p class="me-line">${esc(l)}</p>`).join('')}
    ${daySkill(me)}
    <button class="btn" type="button" data-me="hide">蓋起來</button>`);
}

// 騎士決鬥、白狼王自爆：放在「看我的身分」裡面，白天大家的畫面才會一樣（Leo 2026-10-22 B1：本來只有這兩個角色有大按鈕，瞄一眼就知道）
function daySkill(me) {
  const seat = c.state.you.seat, pick = ui.skillPick;
  if (c.state.phase !== 'day') return '';
  if (me.canDuel) return ui.duelOpen
    ? `<div class="skill"><h2>騎士決鬥</h2>
       <p class="hint">選一個人翻牌決鬥：他是狼人就出局，今天直接天黑；不是的話，你出局，白天繼續。只能用一次。</p>
       ${picker(aliveSeats({ except: [seat] }).map(n => ({ n })), pick, 'data-skill-pick')}
       <div class="row-gap"><button class="btn primary" type="button" data-do="duel"${pick ? '' : ' disabled'}>決鬥 ${pick ?? '…'} 號</button>
       <button class="btn" type="button" data-do="duelClose">取消</button></div></div>`
    : `<button class="btn big" type="button" data-do="duelOpen">⚔ 發起決鬥（騎士技能）</button>`;
  // 自爆：白狼王可以帶人；其他狼人（狼美人除外）2026-10-27 起也能自爆，不帶人
  if (me.canBoom) return ui.boomOpen
    ? (me.boomTake ? `<div class="skill"><h2>白狼王自爆</h2>
       <p class="hint">自爆後你出局，可以帶走一個人或不帶；今天不再投票，直接天黑（被帶走的人要開槍、或你／被帶走的人是警長要選警徽，都等處理完才唸天黑）。今天的放逐登記之後就不能自爆（平票會自動 PK，PK 中還能自爆；PK 又平票、全部棄票＝今天沒人出局，就不能了）。</p>
       ${picker(aliveSeats({ except: [seat] }).map(n => ({ n })), pick, 'data-skill-pick')}
       <div class="row-gap"><button class="btn primary" type="button" data-do="boom"${pick ? '' : ' disabled'}>自爆，帶走 ${pick ?? '…'} 號</button>
       <button class="btn" type="button" data-do="boom0">自爆，不帶人</button>
       <button class="btn" type="button" data-do="boomClose">取消</button></div></div>`
      : `<div class="skill"><h2>狼人自爆</h2>
       <p class="hint">自爆後你出局，主機唸「你的號碼狼人自爆，天黑請閉眼」；今天不再投票，直接天黑（你是警長的話，先選完警徽才唸天黑）。今天的放逐登記之後就不能自爆（平票會自動 PK，PK 中還能自爆；PK 又平票、全部棄票＝今天沒人出局，就不能了）。</p>
       <div class="row-gap"><button class="btn primary" type="button" data-do="boom0">確定自爆</button>
       <button class="btn" type="button" data-do="boomClose">取消</button></div></div>`)
    : `<button class="btn big" type="button" data-do="boomOpen">💥 自爆（${me.boomTake ? '白狼王技能' : '狼人'}）</button>`;
  return '';
}

/* ───────── 換手機：接手主機、接手座位（對局中也要能用；Leo 2026-10-22 A1） ───────── */
function renderTakeover() {
  const { state, $, setHTML } = c;
  const box = $('#takeover');
  let html = '';
  if (!state.hostOnline && !state.you.isHost) {
    html += `<p><b>主機離線了。</b>主機斷線 1 分鐘後，可以由一支手機接手主持（主機看不到任何人的身分）。</p>
      <button class="btn" type="button" data-take="host">由我接手當主機</button>`;
  }
  if (!state.you.seat && !state.you.isHost && state.phase !== 'ended') {
    const off = state.seats.filter(s => s.taken && !s.online).map(s => s.n);
    if (state.you.requestedSeat) html += `<p>已申請接手 <b>${state.you.requestedSeat}</b> 號，請主機按同意。</p>`;
    else if (off.length) html += `<p><b>換手機接手座位</b>：點你原本的號碼，主機按同意後就接回來。</p>
      ${picker(off.map(n => ({ n })), null, 'data-take-seat')}`;
  }
  box.hidden = !html;
  setHTML(box, html);
}

function onTakeover(e) {
  if (e.target.closest('[data-take="host"]')) { c.takeHost(); return; }
  const s = e.target.closest('[data-take-seat]');
  if (s) c.send({ type: 'claimSeat', seat: Number(s.dataset.takeSeat) });
}

// 主機：換手機接手座位的申請（只看得到號碼）。對局畫面和發牌畫面共用
export function seatRequestsHTML(list) {
  if (!list?.length) return '';
  return `<div class="requests"><h3>換手機接手座位</h3>
    <p class="hint">先口頭確認是本人換了手機，再按同意。</p>
    ${list.map(n => `<div class="row-gap"><b class="digits">${n} 號</b>
      <button class="btn primary small" type="button" data-approve="${n}" data-yes="1">同意</button>
      <button class="btn small" type="button" data-approve="${n}" data-yes="0">拒絕</button></div>`).join('')}</div>`;
}
export function approveFromClick(e, send) {
  const b = e.target.closest('[data-approve]');
  if (!b) return false;
  const n = Number(b.dataset.approve), yes = b.dataset.yes === '1';
  if (yes && !window.confirm(`請先口頭確認是 ${n} 號本人換了手機。同意新手機接手 ${n} 號？`)) return true;
  send({ type: 'approveSeat', seat: n, yes });
  return true;
}

export function bindGame($) {
  $('#actionBox').addEventListener('click', onAction);
  $('#hostCtl').addEventListener('click', onHost);
  $('#takeover').addEventListener('click', onTakeover);
  $('#myInfo').addEventListener('click', e => {
    const b = e.target.closest('[data-me]');
    if (b) { ui.showMe = b.dataset.me === 'show'; c.render(); }
    else onAction(e); // 騎士決鬥、白狼王自爆的按鈕在這裡面
  });
}
