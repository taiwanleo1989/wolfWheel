// 對局畫面（黑夜／白天／結束）。所有人共用一個畫面，依「你是誰、輪到誰」顯示不同區塊。
import { ROLES, TEAM_NAME } from '../shared/roles.js';
import { portrait } from '../shared/art.js';

const SKIP_MS = 30000; // 跟伺服器 src/engine.js 的 SKIP_MS 一樣
const STEP_NAME = { guard: '守衛', wolf: '狼人', witch: '女巫', seer: '預言家', hunter: '獵人', police: '上警' };

let c;              // { state, $, setHTML, esc, send, toast, voice, ui, render }
const ui = { pick: null, pickKey: '', duelOpen: false, showMe: false, hostPick: null, hostKey: '' };

export function renderGame(ctx) {
  c = ctx;
  const { state, $, setHTML, esc } = c;
  const g = state.game, me = state.you.game, seat = state.you.seat, phase = state.phase;

  $('#phaseTag').textContent = phase === 'night' ? `第 ${g.dayNo} 夜` : phase === 'day' ? `第 ${g.dayNo} 天` : '遊戲結束';
  $('#gameCode').textContent = state.code;
  $('#seatMini').textContent = seat ? `・你是 ${seat} 號` : '・主機';
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
  renderHost();
  renderBoard();
  renderMyInfo();

  setHTML($('#logList'), g.log.slice().reverse().map(e => `<li><span class="d">第 ${e.day} 天</span>${esc(e.text)}</li>`).join(''));
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

/* ───────── 自己的動作 ───────── */
function renderAction() {
  const { state, $, setHTML } = c;
  const box = $('#actionBox');
  const me = state.you.game, seat = state.you.seat, phase = state.phase, g = state.game;
  if (!seat || !me) { box.hidden = true; return; }

  // 換了一個動作就清掉剛才選的座位
  const key = `${phase}|${g.dayNo}|${me.action?.kind ?? ''}|${me.canShoot ? 's' : ''}|${me.canDuel ? 'd' : ''}`;
  if (key !== ui.pickKey) { ui.pickKey = key; ui.pick = null; ui.duelOpen = false; ui.confirm = null; }
  const pick = ui.pick;
  let html = '';

  if (phase === 'night' && me.alive && me.action) {
    const a = me.action;
    // 「是否正確」：選好之後先確認，按「正確」才送出（照手稿：上帝回比號碼確認）
    const confirmBox = ui.confirm
      ? `<div class="confirm"><p>${ui.confirm.text}，是否正確？</p>
          <div class="row-gap"><button class="btn primary" type="button" data-do="yes">正確</button><button class="btn" type="button" data-do="no">重選</button></div></div>`
      : '';
    if (a.kind === 'guard') {
      html = `<h2>請選擇今晚要守護的玩家</h2>
        ${picker(aliveSeats().map(n => ({ n, disabled: n === a.lastGuard, note: n === a.lastGuard ? '昨晚守過' : n === seat ? '自己' : '' })), pick)}
        ${confirmBox || `<div class="row-gap"><button class="btn primary" type="button" data-do="guard"${pick ? '' : ' disabled'}>守護 ${pick ?? '…'} 號</button>
        <button class="btn" type="button" data-do="guard0">今晚不守</button></div>`}`;
    } else if (a.kind === 'wolf') {
      const wolves = me.wolves.filter(w => w.alive);
      const votesFor = n => wolves.filter(w => a.votes[w.seat] === n).map(w => w.seat);
      const myVote = a.votes[seat];
      const king = me.wolves.find(w => w.king);
      const agreed = a.proposal !== null && a.proposal !== undefined;
      html = `<h2>今晚要擊殺的目標是？</h2>
        <p class="hint">你的隊友：${wolves.filter(w => w.seat !== seat).map(w => `${w.seat} 號`).join('、') || '沒有'}${king ? `　<b>狼王是 ${king.seat} 號</b>${king.alive ? '' : '（已出局）'}` : ''}</p>
        ${agreed
          ? `<div class="confirm"><p>${a.proposal ? `今晚要擊殺的玩家是 <b class="digits">${a.proposal}</b> 號` : '今晚空刀'}，是否正確？</p>
              <div class="row-gap"><button class="btn primary" type="button" data-do="wolfYes">正確</button><button class="btn" type="button" data-do="wolfNo">重選</button></div>
              <p class="hint small">任何一隻狼按「正確」就確定。</p></div>`
          : `<p class="hint">所有狼人點同一個人（或都按空刀）之後，會問「是否正確」。</p>
            ${picker(aliveSeats().map(n => { const v = votesFor(n); return { n, note: v.length ? v.map(s => s + '號').join(' ') : '' }; }), myVote || null)}
            <div class="row-gap"><button class="btn${myVote === 0 ? ' primary' : ''}" type="button" data-do="wolf0">今晚空刀</button></div>
            <ul class="votes">${wolves.map(w => `<li>${w.seat} 號${w.seat === seat ? '（你）' : ''}：${a.votes[w.seat] === undefined ? '還沒選' : a.votes[w.seat] === 0 ? '空刀' : a.votes[w.seat] + ' 號'}</li>`).join('')}</ul>`}`;
    } else if (a.kind === 'witchSave') {
      const info = a.saveUsedUp ? '解藥已經用掉了，不會告知今晚死亡的玩家。'
        : a.victim ? `今晚死亡的玩家是 <b class="digits">${a.victim}</b> 號。` : '今晚沒有人死亡。';
      html = `<h2>請問你要使用解藥嗎？</h2>
        <p class="witch-info">${info}</p>
        ${a.selfBlocked ? '<p class="hint">依照規則，女巫不能救自己。</p>' : ''}
        <p class="hint">一晚只能用一瓶藥：用了解藥，今晚就不能再用毒藥。</p>
        <div class="row-gap">
          ${a.canSave ? `<button class="btn primary" type="button" data-do="save">👍 救 ${a.victim} 號</button>` : ''}
          <button class="btn${a.canSave ? '' : ' primary'}" type="button" data-do="noSave">${a.canSave ? '👎 不救' : '繼續'}</button>
        </div>`;
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
    } else if (a.kind === 'hunter') {
      html = `<h2>你今晚的帶槍手勢是</h2>
        <div class="seer-result ${a.canShoot ? 'good' : 'wolf'}"><b>${a.canShoot ? '👍 可以開槍' : '👎 被毒了，不能開槍'}</b></div>
        <button class="btn primary big" type="button" data-do="hunterSeen">知道了</button>`;
    }
  } else if (phase === 'day' && me.idiotChoose) {
    html = `<h2>你被投票放逐了</h2>
      <p class="hint">你是白癡，可以選擇翻牌：翻牌就不會出局，但之後不能投票。也可以不翻，直接出局。按下後主機會公開宣布。</p>
      <div class="row-gap"><button class="btn primary" type="button" data-do="idiotFlip">翻牌（免於出局）</button>
      <button class="btn" type="button" data-do="idiotOut">不翻牌，出局</button></div>`;
  } else if (phase === 'day' && me.canShoot) {
    html = `<h2>你可以發動技能</h2>
      <p class="hint">帶走一個人，或選擇不發動。按下後主機會公開宣布。</p>
      ${picker(aliveSeats({ except: [seat] }).map(n => ({ n })), pick)}
      <div class="row-gap"><button class="btn primary" type="button" data-do="shoot"${pick ? '' : ' disabled'}>帶走 ${pick ?? '…'} 號</button>
      <button class="btn" type="button" data-do="shoot0">不發動</button></div>`;
  } else if (phase === 'day' && me.canDuel) {
    html = ui.duelOpen
      ? `<h2>騎士決鬥</h2>
         <p class="hint">選一個人翻牌決鬥：他是狼人就出局，今天直接天黑；不是的話，你出局，白天繼續投票。只能用一次。</p>
         ${picker(aliveSeats({ except: [seat] }).map(n => ({ n })), pick)}
         <div class="row-gap"><button class="btn primary" type="button" data-do="duel"${pick ? '' : ' disabled'}>決鬥 ${pick ?? '…'} 號</button>
         <button class="btn" type="button" data-do="duelClose">取消</button></div>`
      : `<button class="btn big" type="button" data-do="duelOpen">⚔ 發起決鬥（騎士技能）</button>`;
  } else if (phase !== 'ended' && !me.alive) {
    html = `<p class="out">你已出局。可以留遺言（如果還有的話），之後請靜靜看戲，不要透露訊息。</p>`;
  } else if (me.idiotRevealed) {
    html = `<p class="out">你已翻牌（白癡）：還活著，但不能投票。</p>`;
  }
  box.hidden = !html;
  setHTML(box, html);
}

function onAction(e) {
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
    case 'yes': act(ui.confirm.payload); ui.confirm = null; break;
    case 'no': ui.confirm = null; ui.pick = null; c.render(); break;
    // 狼人：全體一致後由任何一隻確認
    case 'wolf0': act({ target: 0 }); break;
    case 'wolfYes': act({ confirm: true }); break;
    case 'wolfNo': act({ reset: true }); break;
    // 女巫解藥（👍／👎）、毒藥不用、預言家看完、獵人看完
    case 'save': act({ use: 'save' }); break;
    case 'noSave': act({ use: 'skip' }); break;
    case 'none': act({ use: 'none' }); break;
    case 'seerDone': act({ done: true }); break;
    case 'hunterSeen': act({ seen: true }); break;
    case 'shoot': if (confirm(`確定帶走 ${pick} 號？`)) c.send({ type: 'shoot', target: pick }); break;
    case 'shoot0': if (confirm('確定不發動技能？之後不能反悔。')) c.send({ type: 'shoot', target: 0 }); break;
    case 'duelOpen': ui.duelOpen = true; c.render(); break;
    case 'duelClose': ui.duelOpen = false; ui.pick = null; c.render(); break;
    case 'duel': if (confirm(`確定和 ${pick} 號決鬥？猜錯的話你會出局。`)) c.send({ type: 'duel', target: pick }); break;
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
  $('#voiceBar').hidden = !(isHost && phase !== 'ended' && !voice.unlocked);
  if (!isHost) return;

  const key = `${phase}|${g.dayNo}`;
  if (key !== ui.hostKey) { ui.hostKey = key; ui.hostPick = null; }
  const bgm = `<button class="btn small" type="button" data-host="bgm">背景音樂：${voice.bgmOn ? '開' : '關'}</button>
    <button class="btn small" type="button" data-host="voice">主持聲音：${voice.voiceName}</button>`;
  let html = '';
  if (phase === 'night') {
    const step = g.night?.step;
    html = `<h2>主持中</h2>
      <p class="hint">${step ? `現在輪到：<b>${STEP_NAME[step]}</b>` : '過場中…'}　手機會自動唸台詞、自動往下走。</p>
      <div class="row-gap"><button class="btn small" type="button" data-host="replay">再唸一次</button>${bgm}</div>
      ${step === 'police' ? `<button class="btn primary big" type="button" data-host="policeDone">大家都起立好了，天亮</button>
        <p class="hint center">不按的話，12 秒後會自動天亮。</p>` : skipBox(g.night)}`;
  } else if (phase === 'day') {
    const pick = ui.hostPick;
    if (g.deathsPending) {
      // 第一天：先選警長（口頭），選完才公布昨晚死訊
      html = `<h2>警長競選</h2>
        <p class="hint">請上警的玩家依序發言，其他人投票選出警長（口頭進行）。選完後再公布昨晚的死訊。</p>
        <div class="row-gap"><a class="btn small" href="../" target="_blank" rel="noopener">發言順序轉盤 ↗</a></div>
        <button class="btn primary big" type="button" data-host="announce">警長選好了，公布昨晚死訊</button>`;
      setHTML(box, html);
      return;
    }
    if (g.nightCalled) {
      // 騎士撞到狼：今天不放逐，「天黑請閉眼」已經唸過了，等主機按
      html = `<h2>騎士撞到狼人</h2>
        <p class="hint">今天不投票放逐，直接天黑。有人要開槍的話先讓他開完，再按下面的按鈕。</p>
        <button class="btn primary big" type="button" data-host="night">進入黑夜</button>
        <div class="row-gap">${bgm}</div>`;
      setHTML(box, html);
      return;
    }
    if (g.idiotChoice) {
      html = `<h2>白天</h2>
        <p class="hint">等 ${g.idiotChoice} 號在自己的手機上選擇……</p>`;
      setHTML(box, html);
      return;
    }
    html = `<h2>白天</h2>
      <p class="hint">請大家依序發言、投票（口頭進行）。投完票在這裡登記結果。</p>
      ${g.exileDone ? '<p class="done">✓ 今天的放逐已登記</p>' : `
        <h3>被放逐的是</h3>
        ${picker(aliveSeats().map(n => ({ n })), pick, 'data-host-pick')}
        <div class="row-gap"><button class="btn primary" type="button" data-host="exile"${pick ? '' : ' disabled'}>放逐 ${pick ?? '…'} 號</button>
        <button class="btn" type="button" data-host="exile0">平票／沒人出局</button></div>`}
      <div class="row-gap"><button class="btn primary big" type="button" data-host="night">天黑請閉眼</button></div>
      <div class="row-gap"><a class="btn small" href="../" target="_blank" rel="noopener">發言順序轉盤 ↗</a>${bgm}</div>`;
  } else if (phase === 'ended') {
    html = `<button class="btn primary big" type="button" data-host="newGame">再來一局</button>
      <p class="hint center">座位和板子會保留，回到設定後重新發牌。</p>`;
  }
  setHTML(box, html);
}

// 「跳過」防手機沒電卡死（Leo 2026-10-10）：每個角色一樣——睜眼就出現（灰的）、睜眼 30 秒後才能按，文字不提任何角色。
// 時間從這支手機收到「睜眼」那刻算；伺服器自己也會檢查 30 秒
function skipBox(night) {
  if (!night?.step || !night.eyesOpen) { clearTimeout(ui.skipTimer); return ''; }
  const key = `${c.state.game.dayNo}|${night.step}|${night.beat}|${night.openedAt}`;
  if (key !== ui.skipKey) { ui.skipKey = key; ui.skipSince = Date.now(); }
  const left = SKIP_MS - (Date.now() - ui.skipSince);
  clearTimeout(ui.skipTimer); // 時間到重畫一次，讓按鈕亮起來（只保留一個計時器）
  if (left > 0) ui.skipTimer = setTimeout(() => c.render(), left + 100);
  return `<div class="row-gap"><button class="btn" type="button" data-host="skip"${left > 0 ? ' disabled' : ''}>跳過（睜眼 30 秒後可按）</button></div>
    <p class="hint center">手機沒電、沒辦法操作時才按：這一步當作沒有動作。</p>`;
}

function onHost(e) {
  const hp = e.target.closest('[data-host-pick]');
  if (hp) { const n = Number(hp.dataset.hostPick); ui.hostPick = ui.hostPick === n ? null : n; c.render(); return; }
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
    case 'announce': if (confirm('公布昨晚的死訊？')) send({ type: 'announce' }); break;
    case 'exile': if (confirm(`登記 ${ui.hostPick} 號被放逐？`)) send({ type: 'exile', target: ui.hostPick }); break;
    case 'exile0': if (confirm('登記「平票，沒人出局」？')) send({ type: 'exile', target: 0 }); break;
    case 'night':
      if (!state.game.exileDone && !state.game.nightCalled && !confirm('今天還沒登記放逐結果，確定直接天黑？')) return;
      send({ type: 'nextNight' }); break;
    case 'newGame': send({ type: 'newGame' }); break;
  }
}

/* ───────── 公開的座位表 ───────── */
function renderBoard() {
  const { state, $, setHTML } = c;
  const g = state.game;
  const seats = Object.keys(g.alive).map(Number).sort((a, b) => a - b);
  $('#aliveCount').textContent = `存活 ${seats.filter(s => g.alive[s]).length}／${seats.length}`;
  setHTML($('#boardSeats'), seats.map(n => {
    const role = g.allRoles?.[n];
    const tag = role ? ROLES[role].name : g.idiotRevealed.includes(n) ? '白癡' : n === state.you.seat ? '你' : '';
    return `<div class="seat taken${g.alive[n] ? '' : ' dead'}${n === state.you.seat ? ' mine' : ''}${role ? ' revealed' : ''}">
      ${role ? `<span class="mini">${portrait(role)}</span>` : ''}<span class="n">${n}</span>${tag ? `<span class="tag">${tag}</span>` : ''}</div>`;
  }).join(''));
}

/* ───────── 自己的身分（點開才看） ───────── */
function renderMyInfo() {
  const { state, $, setHTML, esc } = c;
  const box = $('#myInfo');
  const role = state.you.role, me = state.you.game;
  box.hidden = !role || !me;
  if (box.hidden) return;
  if (!ui.showMe) { setHTML(box, `<button class="btn big" type="button" data-me="show">看我的身分（先確定旁人看不到）</button>`); return; }
  const r = ROLES[role];
  const lines = [];
  if (me.wolves) lines.push(`狼隊友：${me.wolves.filter(w => w.seat !== state.you.seat).map(w => `${w.seat} 號${w.king ? '（狼王）' : ''}${w.alive ? '' : '（已出局）'}`).join('、') || '沒有'}`);
  if (me.seerChecks) lines.push(me.seerChecks.length ? '查驗紀錄：' + me.seerChecks.map(x => `第 ${x.day} 夜 ${x.target} 號是${x.wolf ? '狼人' : '好人'}`).join('；') : '查驗紀錄：還沒有');
  if (me.potions) lines.push(`解藥：${me.potions.save ? '還有' : '用掉了'}；毒藥：${me.potions.poison ? '還有' : '用掉了'}`);
  if (role === 'guard') lines.push(`昨晚守護：${me.lastGuard ? me.lastGuard + ' 號' : '沒有'}（今晚不能再守同一人）`);
  setHTML(box, `<div class="me-row"><div class="thumb big">${portrait(role)}</div>
      <div><div class="role-name sm team-${r.team}">${esc(r.name)}</div><div class="hint">${esc(TEAM_NAME[r.team])}${me.alive ? '' : '・已出局'}</div></div></div>
    <p class="role-desc">${esc(r.desc)}</p>
    ${lines.map(l => `<p class="me-line">${esc(l)}</p>`).join('')}
    <button class="btn" type="button" data-me="hide">蓋起來</button>`);
}

export function bindGame($) {
  $('#actionBox').addEventListener('click', onAction);
  $('#hostCtl').addEventListener('click', onHost);
  $('#myInfo').addEventListener('click', e => {
    const b = e.target.closest('[data-me]');
    if (b) { ui.showMe = b.dataset.me === 'show'; c.render(); }
  });
}
