// 主機的聲音：用手機內建的中文語音唸台詞（不用額外檔案），夜裡放背景音樂、唸台詞時自動降低音量。
// 瀏覽器規定「使用者點過之後」才能出聲，所以要先 unlock()（開始按鈕、或「開啟主持語音」按鈕）。

const BGM_VOL = 0.18, BGM_DUCK = 0.05;
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let zhVoice = null, unlocked = false, lastSeq = null;
let actx = null, gain = null, bgm = null, bgmOn = true, speaking = false;

function pickVoice() {
  if (!synth) return;
  const vs = synth.getVoices();
  zhVoice = vs.find(v => /zh[-_]TW/i.test(v.lang)) || vs.find(v => /zh[-_](HK|Hant)/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || null;
}
if (synth) { pickVoice(); synth.addEventListener?.('voiceschanged', pickVoice); }

try { bgmOn = localStorage.getItem('ww-judge-bgm') !== '0'; } catch {}

export const voice = {
  supported: Boolean(synth),
  get unlocked() { return unlocked; },
  get bgmOn() { return bgmOn; },

  // 必須在點擊事件裡呼叫
  unlock() {
    if (synth) { synth.cancel(); const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); }
    const C = window.AudioContext || window.webkitAudioContext;
    if (C && !actx) {
      actx = new C();
      bgm = new Audio('../bgm.m4a'); bgm.loop = true; bgm.preload = 'auto';
      try { const src = actx.createMediaElementSource(bgm); gain = actx.createGain(); gain.gain.value = 0; src.connect(gain).connect(actx.destination); } catch { gain = null; }
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
    this.say(narration.text);
  },

  say(text) {
    if (!unlocked || !synth) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-TW';
    if (zhVoice) u.voice = zhVoice;
    u.rate = 0.92;
    u.onstart = () => { speaking = true; duck(); };
    u.onend = u.onerror = () => { speaking = false; duck(); };
    synth.speak(u);
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

function duck() { fadeTo(speaking ? BGM_DUCK : BGM_VOL); }
function fadeTo(v, done) {
  if (gain && actx) gain.gain.setTargetAtTime(v, actx.currentTime, 0.25);
  else if (bgm) bgm.volume = v;
  if (done) setTimeout(done, 800);
}
