// 主機的聲音。兩種來源：
//   1. 錄好的男聲（預設）：每句台詞由片段組成（public/shared/voice-lines.js），播 public/voice/<片段>.mp3，接起來唸。
//      所有手機聽起來都一樣（iPhone 也是），不用網路語音。錄音：npm run voice。
//   2. 手機內建語音：錄音檔載入失敗、或主持人自己切換時才用。
// 夜裡放背景音樂、唸台詞時自動降低音量。
// 瀏覽器規定「使用者點過之後」才能出聲，所以要先 unlock()：主機點螢幕任何地方都會呼叫 tapped()（見 app.js）。
// Leo 2026-10-17：拿掉「點這裡開啟主持語音」那條，該講話就直接講；聲音被暫停時漏掉的那句，主機下次點螢幕就補唸。

const BGM_VOL = 0.18, BGM_DUCK = 0.05;
// 主持人講話的音量（錄音與手機內建語音都用這個）：Leo 2026-10-17 實玩嫌太大聲，1 → 0.6（約 -4.4 dB）；背景音樂不變
const VOICE_VOL = 0.6;
const GAP = { sep: 0.28, colon: 0.22, comma: 0.2, end: 0 }; // 標點片段：只停頓、不出聲
// 個別片段放大（倍數）。「天黑請閉眼」是大家還在聊天時唸的第一句，Leo 2026-10-11 實玩嫌太小聲：放大 2 倍（約 +6 dB），
// 後面接限幅器，放大後也不會破音。錄音本身跟其他句一樣大聲（-21.5 LUFS），所以重錄後這裡照樣有效
export const CLIP_GAIN = { nightStart: 2 };
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let zhVoice = null, unlocked = false, lastSeq = null, ranOnce = false, onChange = null, waitFor = null;
let missed = null; // 聲音出不來時收到的台詞：主機下次點螢幕補唸
let actx = null, gain = null, voiceGain = null, bgm = null, bgmOn = true, speaking = 0;
let source = 'recorded';              // 'recorded' | 'device'
let manifest = null, buffers = {}, loading = null, playingUntil = 0, playing = [];

function pickVoice() {
  if (!synth) return;
  const vs = synth.getVoices();
  zhVoice = vs.find(v => /zh[-_]TW/i.test(v.lang)) || vs.find(v => /zh[-_](HK|Hant)/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || null;
}
if (synth) { pickVoice(); synth.addEventListener?.('voiceschanged', pickVoice); }

try {
  bgmOn = localStorage.getItem('ww-judge-bgm') !== '0';
  source = localStorage.getItem('ww-judge-voice') === 'device' ? 'device' : 'recorded';
} catch {}

// 把錄好的片段全部先載好（約 1MB），播的時候才不會卡
function loadRecorded() {
  if (loading || !actx) return loading;
  loading = (async () => {
    try {
      manifest = await fetch('../voice/manifest.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null));
      if (!manifest) return;
      await Promise.all(Object.entries(manifest.files).map(async ([key, f]) => {
        const data = await fetch(`../voice/${f.file}`).then(r => r.arrayBuffer());
        buffers[key] = await new Promise((ok, bad) => actx.decodeAudioData(data, ok, bad));
      }));
    } catch { manifest = null; buffers = {}; }
  })();
  return loading;
}
const recordedReady = clips => manifest && clips?.length && clips.every(k => k in GAP || buffers[k]);

export const voice = {
  supported: Boolean(synth),
  // 「現在出得了聲」：點過解鎖，而且聲音系統還在跑。
  // iPhone 接電話、切 App、鎖螢幕後回來，聲音系統會被暫停（suspended／Safari 的 interrupted），要再點一下才能恢復（Leo 2026-10-10）
  get unlocked() { return unlocked && !(ranOnce && actx && actx.state !== 'running'); },
  get bgmOn() { return bgmOn; },
  get source() { return source; },
  get voiceName() { return source === 'recorded' && manifest ? '男聲（錄音）' : '手機內建'; },

  // 必須在點擊事件裡呼叫
  unlock() {
    if (synth) { synth.cancel(); const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); }
    const C = window.AudioContext || window.webkitAudioContext;
    if (C && !actx) {
      actx = new C();
      bgm = new Audio('../bgm.m4a'); bgm.loop = true; bgm.preload = 'auto';
      try { const src = actx.createMediaElementSource(bgm); gain = actx.createGain(); gain.gain.value = 0; src.connect(gain).connect(actx.destination); } catch { gain = null; }
      // 台詞 → 限幅器 → 喇叭：個別片段放大後超過 0 dB 的部分壓下來，不會破音
      const limiter = actx.createDynamicsCompressor();
      limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.15;
      limiter.connect(actx.destination);
      voiceGain = actx.createGain(); voiceGain.gain.value = VOICE_VOL; voiceGain.connect(limiter);
      keepAlive();
      actx.onstatechange = () => { if (actx.state === 'running') ranOnce = true; onChange?.(); };
      loadRecorded();
    }
    if (actx && actx.state !== 'running') actx.resume().catch(() => {});
    unlocked = true;
  },

  // 停掉正在唸、排隊中的台詞（重唸前呼叫，免得被暫停時排進去的那句恢復後又唸一次）
  stop() {
    for (const s of playing) { try { s.stop(); } catch {} }
    playing = []; playingUntil = 0;
    if (synth) synth.cancel();
  },

  // 切回網頁時呼叫：先試著自己恢復（有些手機不用點就能恢復）；恢復不了，等主機下次點螢幕（tapped）
  wake() {
    if (actx && actx.state !== 'running') actx.resume().catch(() => {});
  },

  // 聲音系統狀態變了（被暫停／恢復）就通知畫面重畫
  onStateChange(fn) { onChange = fn; },

  // 每次收到新狀態呼叫：台詞編號變大就唸
  onNarration(narration, { replay = false } = {}) {
    if (!narration) return;
    // 按了直接重開：確認視窗那幾秒還在路上的舊局台詞不唸，等到新局那句。等不到（重開失敗）就在 8 秒後、
    // 或伺服器回錯時（release）補唸最後收到的那句，不會整段沒聲音（2026-10-23 審查）
    if (waitFor && !replay) {
      if (!narration.clips?.includes(waitFor.clip)) { waitFor.held = narration; return; }
      this.release(false);
    }
    if (lastSeq === null && !replay) { lastSeq = narration.seq; return; } // 剛連上：不重唸舊的
    if (!replay && narration.seq <= lastSeq) return;
    lastSeq = narration.seq;
    this.speak(narration);
  },

  // 唸一句：有錄好的就播錄音，沒有就用手機內建語音
  async speak(narration) {
    if (!narration) return;
    if (!unlocked) { missed = narration; return; } // 重新整理後主機還沒點過螢幕
    // 聲音系統被暫停了（白天開槍、決鬥這種「別支手機按的」台詞，主機沒點螢幕）：先試著恢復；
    // 恢復不了就改用手機內建語音唸這句，並記下來，主機下次點螢幕再用錄音補唸（Leo 2026-10-17 實玩白天開槍沒聲音）
    if (actx && actx.state !== 'running') {
      actx.resume().catch(() => {});
      await new Promise(ok => setTimeout(ok, 400));
      if (actx.state !== 'running') { missed = narration; this.say(narration.text); return; }
    }
    missed = null;
    if (source === 'recorded' && actx) {
      await loadRecorded();
      if (recordedReady(narration.clips)) { playClips(narration.clips); return; }
    }
    this.say(narration.text);
  },

  say(text) {
    if (!unlocked || !synth || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-TW';
    if (zhVoice) u.voice = zhVoice;
    u.rate = 0.92;
    u.volume = VOICE_VOL;
    u.onstart = () => { speaking++; duck(); };
    u.onend = u.onerror = () => { speaking = Math.max(0, speaking - 1); duck(); };
    synth.speak(u);
  },

  toggleSource() {
    source = source === 'recorded' ? 'device' : 'recorded';
    try { localStorage.setItem('ww-judge-voice', source); } catch {}
    return source;
  },

  // 夜裡播、白天停
  setNight(isNight) {
    if (!bgm || !unlocked) return;
    if (isNight && bgmOn) { bgm.play().catch(() => {}); duck(); }
    else fadeTo(0, () => bgm.pause());
  },

  toggleBgm() {
    bgmOn = !bgmOn;
    try { localStorage.setItem('ww-judge-bgm', bgmOn ? '1' : '0'); } catch {}
    return bgmOn;
  },

  // 主機點了螢幕任何地方（必須在點擊事件裡呼叫）：恢復聲音；剛才有漏唸的就補唸
  tapped() {
    // 聲音正常就不用 unlock（unlock 會停掉手機內建語音正在唸的那句）
    if (!unlocked || (actx && actx.state !== 'running')) this.unlock();
    if (!missed) return;
    const n = missed;
    missed = null;
    this.stop();
    this.speak(n);
  },

  // 剛按下「開始」：接下來收到的第一句（天黑請閉眼）一定要唸
  expectFresh() { lastSeq = 0; },
  // 剛變成主機（接手、或拿回主機）：當作剛連上，從下一句開始唸——手機記的序號可能停在別局（2026-10-22 驗測）
  resync() { lastSeq = null; },
  // 直接重開：舊局的台詞先不唸，等到這個片段（請確認角色身分）（2026-10-22 瀏覽器實測：會先唸一句舊局的「要上警的玩家請起立。」）
  holdUntil(clip) {
    this.release(false);
    waitFor = { clip, held: null, timer: setTimeout(() => this.release(), 8000) };
  },
  // 不等了：catchUp＝把擋住期間最後收到的那句照常處理（序號比較新就唸）
  release(catchUp = true) {
    if (!waitFor) return;
    clearTimeout(waitFor.timer);
    const held = waitFor.held;
    waitFor = null;
    if (catchUp && held) this.onNarration(held);
  },
};

// 一直播一段聽不到的極小聲音（約 -80 dB）：白天背景音樂停了、沒在唸台詞時，iPhone 會把沒聲音的網頁聲音系統暫停，
// 之後別支手機觸發的台詞（開槍、決鬥、自爆、白癡翻牌）就唸不出來（Leo 2026-10-17 實玩：白天開槍沒聲音）
function keepAlive() {
  const buf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 1e-4;
  const src = actx.createBufferSource();
  src.buffer = buf; src.loop = true;
  src.connect(actx.destination);
  src.start();
}

// 把片段一個接一個排好播；上一句還沒唸完就接在後面（不會搶話）
function playClips(clips) {
  let t = Math.max(actx.currentTime + 0.05, playingUntil);
  const startAt = t;
  for (const k of clips) {
    if (k in GAP) { t += GAP[k]; continue; }
    const src = actx.createBufferSource();
    src.buffer = buffers[k];
    if (CLIP_GAIN[k]) { const g = actx.createGain(); g.gain.value = CLIP_GAIN[k]; src.connect(g).connect(voiceGain); }
    else src.connect(voiceGain);
    src.start(t);
    playing.push(src);
    t += buffers[k].duration + 0.04;
  }
  playingUntil = t;
  // 唸的期間把背景音樂壓低
  setTimeout(() => { speaking++; duck(); }, Math.max(0, (startAt - actx.currentTime) * 1000));
  setTimeout(() => { speaking = Math.max(0, speaking - 1); duck(); playing = playing.filter(s => s.buffer && actx.currentTime < t); }, Math.max(0, (t - actx.currentTime) * 1000));
}

function duck() { fadeTo(speaking > 0 ? BGM_DUCK : BGM_VOL); }
function fadeTo(v, done) {
  if (gain && actx) gain.gain.setTargetAtTime(v, actx.currentTime, 0.25);
  else if (bgm) bgm.volume = v;
  if (done) setTimeout(done, 800);
}
