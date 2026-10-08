// 主機的聲音。兩種來源：
//   1. 錄好的男聲（預設）：每句台詞由片段組成（public/shared/voice-lines.js），播 public/voice/<片段>.mp3，接起來唸。
//      所有手機聽起來都一樣（iPhone 也是），不用網路語音。錄音：npm run voice。
//   2. 手機內建語音：錄音檔載入失敗、或主持人自己切換時才用。
// 夜裡放背景音樂、唸台詞時自動降低音量。
// 瀏覽器規定「使用者點過之後」才能出聲，所以要先 unlock()（開始按鈕、或「開啟主持語音」按鈕）。

const BGM_VOL = 0.18, BGM_DUCK = 0.05;
const GAP = { sep: 0.28, colon: 0.22, end: 0 }; // 標點片段：只停頓、不出聲
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let zhVoice = null, unlocked = false, lastSeq = null;
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
  get unlocked() { return unlocked; },
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
      voiceGain = actx.createGain(); voiceGain.gain.value = 1; voiceGain.connect(actx.destination);
      loadRecorded();
    }
    if (actx && actx.state === 'suspended') actx.resume();
    unlocked = true;
  },

  // 每次收到新狀態呼叫：台詞編號變大就唸
  onNarration(narration, { replay = false } = {}) {
    if (!narration) return;
    if (lastSeq === null && !replay) { lastSeq = narration.seq; return; } // 剛連上：不重唸舊的
    if (!replay && narration.seq <= lastSeq) return;
    lastSeq = narration.seq;
    this.speak(narration);
  },

  // 唸一句：有錄好的就播錄音，沒有就用手機內建語音
  async speak(narration) {
    if (!unlocked || !narration) return;
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

  // 剛按下「開始」：接下來收到的第一句（天黑請閉眼）一定要唸
  expectFresh() { lastSeq = 0; },
};

// 把片段一個接一個排好播；上一句還沒唸完就接在後面（不會搶話）
function playClips(clips) {
  let t = Math.max(actx.currentTime + 0.05, playingUntil);
  const startAt = t;
  for (const k of clips) {
    if (k in GAP) { t += GAP[k]; continue; }
    const src = actx.createBufferSource();
    src.buffer = buffers[k];
    src.connect(voiceGain);
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
