// 對局畫面（黑夜／白天／結束）。所有人共用一個畫面，依「你是誰、輪到誰」顯示不同區塊。
import { ROLES, TEAM_NAME } from '../shared/roles.js';
import { portrait } from '../shared/art.js';

const STEP_NAME = { guard: '守衛', wolf: '狼人', witch: '女巫', seer: '預言家' };
const SKIP_AFTER_MS = 30000; // 主機的「跳過」在同一步卡超過 30 秒才出現

let c;              // { state, $, setHTML, esc, send, toast, voice, ui, render }
const ui = { pick: null, pickKey: '', duelOpen: false, showMe: false, stepKey: '', stepSince: 0, hostPick: null, hostKey: '' };

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
  if (key !== ui.pickKey) { ui.pickKey = key; ui.pick = null; ui.duelOpen = false; }
  const pick = ui.pick;
  let html = '';

  if (phase === 'night' && me.alive && me.action) {
    const a = me.action;
    if (a.kind === 'guard') {
      html = `<h2>守衛，今晚你要守護誰？</h2>
        ${picker(aliveSeats().map(n => ({ n, disabled: n === a.lastGuard, note: n === a.lastGuard ? '昨晚守過' : n === seat ? '自己' : '' })), pick)}
        <div class="row-gap"><button class="btn primary" type="button" data-do="guard"${pick ? '' : ' disabled'}>守護 ${pick ?? '…'} 號</button>
        <button class="btn" type="button" data-do="guard0">今晚不守</button></div>`;
    } else if (a.kind === 'wolf') {
      const wolves = me.wolves.filter(w => w.alive);
      const votesFor = n => wolves.filter(w => a.votes[w.seat] === n).map(w => w.seat);
      const myVote = a.votes[seat];
      html = `<h2>狼人，今晚你們要殺誰？</h2>
        <p class="hint">所有狼人都選同一個人才會確定。你的隊友：${wolves.filter(w => w.seat !== seat).map(w => `${w.seat} 號${w.king ? '（狼王）' : ''}`).join('、') || '沒有'}</p>
        ${picker(aliveSeats().map(n => { const v = votesFor(n); return { n, note: v.length ? v.map(s => s + '號').join(' ') : '' }; }), myVote || null)}
        <div class="row-gap"><button class="btn${myVote === 0 ? ' primary' : ''}" type="button" data-do="wolf0">今晚空刀</button></div>
        <ul class="votes">${wolves.map(w => `<li>${w.seat} 號${w.seat === seat ? '（你）' : ''}：${a.votes[w.seat] === undefined ? '還沒選' : a.votes[w.seat] === 0 ? '空刀' : a.votes[w.seat] + ' 號'}</li>`).join('')}</ul>`;
    } else if (a.kind === 'witch') {
      const info = a.saveUsedUp ? '解藥已經用掉了，看不到今晚誰被殺。' : a.victim ? `今晚被殺的是 <b class="digits">${a.victim}</b> 號。` : '今晚沒有人被殺（平安）。';
      html = `<h2>女巫，今晚你要用藥嗎？</h2>
        <p class="witch-info">${info}</p>
        <p class="hint">一晚只能用一瓶。${me.potions ? `解藥：${me.potions.save ? '還有' : '用掉了'}；毒藥：${me.potions.poison ? '還有' : '用掉了'}` : ''}</p>
        ${a.canSave ? `<button class="btn primary big" type="button" data-do="save">用解藥救 ${a.victim} 號</button>` : (!a.saveUsedUp && a.victim ? '<p class="hint">依照規則，今晚不能救自己。</p>' : '')}
        ${a.canPoison ? `<h3>或是用毒藥</h3>${picker(aliveSeats({ except: [seat] }).map(n => ({ n })), pick)}
          <button class="btn" type="button" data-do="poison"${pick ? '' : ' disabled'}>毒 ${pick ?? '…'} 號</button>` : ''}
        <div class="row-gap"><button class="btn" type="button" data-do="none">今晚都不用</button></div>`;
    } else if (a.kind === 'seer') {
      if (a.checked) {
        html = `<h2>查驗結果</h2>
          <div class="seer-result ${a.checked.wolf ? 'wolf' : 'good'}"><span class="digits">${a.checked.target}</span> 號是 <b>${a.checked.wolf ? '狼人' : '好人'}</b></div>
          <button class="btn primary big" type="button" data-do="seerDone">知道了</button>`;
      } else {
        html = `<h2>預言家，你要查驗誰？</h2>
          ${picker(aliveSeats({ except: [seat] }).map(n => ({ n })), pick)}
          <button class="btn primary big" type="button" data-do="seer"${pick ? '' : ' disabled'}>查驗 ${pick ?? '…'} 號</button>`;
      }
    }
  } else if (phase === 'day' && me.canShoot) {
    html = `<h2>你可以發動技能</h2>
      <p class="hint">帶走一個人，或選擇不發動。按下後主機會公開宣布。</p>
      ${picker(aliveSeats({ except: [seat] }).map(n => ({ n })), pick)}
      <div class="row-gap"><button class="btn primary" type="button" data-do="shoot"${pick ? '' : ' disabled'}>帶走 ${pick ?? '…'} 號</button>
      <button class="btn" type="button" data-do="shoot0">不發動</button></div>`;
  } else if (phase === 'day' && me.canDuel) {
    html = ui.duelOpen
      ? `<h2>騎士決鬥</h2>
         <p class="hint">選一個人翻牌決鬥：他是狼人就出局；不是的話，你出局。只能用一次。</p>
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
    ui.pick = ui.pick === n ? null : n;
    c.render();
    return;
  }
  const d = e.target.closest('[data-do]');
  if (!d) return;
  const pick = ui.pick, act = payload => c.send({ type: 'act', payload });
  switch (d.dataset.do) {
    case 'guard': act({ target: pick }); break;
    case 'guard0': act({ target: 0 }); break;
    case 'wolf0': act({ target: 0 }); break;
    case 'save': act({ use: 'save' }); break;
    case 'poison': if (confirm(`確定用毒藥毒 ${pick} 號？`)) act({ use: 'poison', target: pick }); break;
    case 'none': act({ use: 'none' }); break;
    case 'seer': act({ target: pick }); break;
    case 'seerDone': act({ done: true }); break;
    case 'shoot': if (confirm(`確定帶走 ${pick} 號？`)) c.send({ type: 'shoot', target: pick }); break;
    case 'shoot0': if (confirm('確定不發動技能？之後不能反悔。')) c.send({ type: 'shoot', target: 0 }); break;
    case 'duelOpen': ui.duelOpen = true; c.render(); break;
    case 'duelClose': ui.duelOpen = false; ui.pick = null; c.render(); break;
    case 'duel': if (confirm(`確定和 ${pick} 號決鬥？猜錯的話你會出局。`)) c.send({ type: 'duel', target: pick }); break;
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
  const bgm = `<button class="btn small" type="button" data-host="bgm">背景音樂：${voice.bgmOn ? '開' : '關'}</button>`;
  let html = '';
  if (phase === 'night') {
    const step = g.night?.step;
    const stepKey = `${g.dayNo}|${step}|${g.night?.openedAt}`;
    if (stepKey !== ui.stepKey) { ui.stepKey = stepKey; ui.stepSince = Date.now(); }
    const stuck = step && Date.now() - ui.stepSince > SKIP_AFTER_MS;
    html = `<h2>主持中</h2>
      <p class="hint">${step ? `現在輪到：<b>${STEP_NAME[step]}</b>` : '過場中…'}　手機會自動唸台詞、自動往下走。</p>
      <div class="row-gap"><button class="btn small" type="button" data-host="replay">再唸一次</button>${bgm}</div>
      ${stuck ? `<div class="stuck"><p>這一步等很久了。如果有人的手機沒電或斷線，可以跳過（當作沒有動作）。</p>
        <button class="btn" type="button" data-host="skip">跳過這一步</button></div>` : ''}`;
    clearTimeout(ui.skipTimer); // 時間到了重畫一次，讓「跳過」按鈕出現（只保留一個計時器）
    if (step && !stuck) ui.skipTimer = setTimeout(() => c.render(), SKIP_AFTER_MS - (Date.now() - ui.stepSince) + 100);
  } else if (phase === 'day') {
    const pick = ui.hostPick;
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

function onHost(e) {
  const hp = e.target.closest('[data-host-pick]');
  if (hp) { const n = Number(hp.dataset.hostPick); ui.hostPick = ui.hostPick === n ? null : n; c.render(); return; }
  const b = e.target.closest('[data-host]');
  if (!b) return;
  const { send, voice, state } = c;
  switch (b.dataset.host) {
    case 'replay': voice.say(state.game.narration?.text ?? ''); break;
    case 'bgm': voice.toggleBgm(); voice.setNight(state.phase === 'night'); c.render(); break;
    case 'skip': if (confirm('跳過這一步？這個角色今晚當作沒有動作。')) send({ type: 'skip' }); break;
    case 'exile': if (confirm(`登記 ${ui.hostPick} 號被放逐？`)) send({ type: 'exile', target: ui.hostPick }); break;
    case 'exile0': if (confirm('登記「平票，沒人出局」？')) send({ type: 'exile', target: 0 }); break;
    case 'night':
      if (!state.game.exileDone && !confirm('今天還沒登記放逐結果，確定直接天黑？')) return;
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
