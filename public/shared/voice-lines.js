// 主機台詞的「片段表」：每一句台詞、每個號碼都是一個片段，各自預錄成一個音檔（public/voice/<key>.mp3）。
// 引擎用片段組句子（例如 ['dawn', 'deathsAre', 'n9', 'end']），畫面上的文字與主機播的聲音都從這張表來，永遠一致。
// 改了這裡的字，要重錄：npm run voice（見 scripts/record-voice.mjs）。
//
// 文字裡的「——」錄音時會變成停頓；值是空字串的片段（標點）只影響文字、不錄音。

export const LINES = {
  // ── 發牌（Leo 2026-10-11：發牌時主機要出聲） ──
  checkRole: '請確認角色身分。',
  // ── 黑夜（照 Leo 手稿） ──
  nightStart: '天黑請閉眼。',
  guardOpen: '守衛請睜眼。請選擇今晚要守護的玩家。',
  guardClose: '守衛請閉眼。',
  wolfOpen: '狼人請睜眼。今晚要擊殺的目標是？',
  wolfOpenKing: '狼人請睜眼。狼王請確認身分。今晚要擊殺的目標是？',
  wolfAsk: '狼人今晚要擊殺的目標是？', // 狼人太久沒操作時只重唸這句（Leo 2026-10-17；第六批錄音）
  wolfClose: '狼人請閉眼。',
  // 2026-10-13 新角色（狼美人、石像鬼、守墓人）：照手稿同一個句型「X 請睜眼。…」「X 請閉眼。」
  beautyOpen: '狼美人請睜眼。請選擇今晚要魅惑的玩家。',
  beautyClose: '狼美人請閉眼。',
  witchSave: '女巫請睜眼。今晚死亡的玩家是——請問你要使用解藥嗎？',
  witchPoison: '請問你要使用毒藥嗎？如果要，請選擇你要毒殺的號碼。',
  witchClose: '女巫請閉眼。',
  seerOpen: '預言家請睜眼。請問你今晚要查驗的玩家是？',
  seerClose: '預言家請閉眼。',
  gargoyleOpen: '石像鬼請睜眼。請問你今晚要查驗的玩家是？',
  gargoyleClose: '石像鬼請閉眼。',
  graveOpen: '守墓人請睜眼。昨天被放逐的玩家，他的陣營是——',
  graveClose: '守墓人請閉眼。',
  hunterOpen: '獵人請睜眼。獵人，你今晚的帶槍手勢是——',
  hunterClose: '獵人請閉眼。',
  // 2026-10-17 狼王的帶槍手勢：照獵人那句的句型
  kingOpen: '狼王請睜眼。狼王，你今晚的帶槍手勢是——',
  kingClose: '狼王請閉眼。',
  police: '要上警的玩家請起立。',
  // ── 天亮與白天 ──
  dawn: '天亮請睜眼。',
  deathsAre: '昨晚死亡的是 ',
  peace: '昨晚是平安夜。',
  shootSkill: '發動技能。', // 10-09 版：只唸到「發動技能」（保留片段，現在不用）
  shootTook: '發動技能，帶走了 ',
  skillOn: '請啟動角色技能。', // 獵人／狼王出局可以開槍時：「9 號，請啟動角色技能。」（Leo 2026-10-17） // Leo 2026-10-10 實玩：開槍後要聽到誰死 →「7 號發動技能，帶走了 4 號。」
  tie: '平票，今天沒有人出局。',
  idiotFlip: '翻牌，是白癡，免於出局，但之後不能投票。',
  exiled: '被放逐出局。',
  knight: '騎士 ',
  duelWith: '決鬥 ',
  duelWolf: '是狼人，出局！',
  duelGood: '是好人，騎士以死謝罪。',
  whiteBoom: '白狼王自爆。', // 「5 號白狼王自爆。」（不帶人）
  whiteBoomTook: '白狼王自爆，帶走了 ', // 「5 號白狼王自爆，帶走了 3 號。」
  // 狼人自爆（Leo 2026-10-27）：「3 號狼人自爆，天黑請閉眼。」；還沒錄音，錄好前整句用手機內建語音
  wolfBoom: '狼人自爆',
  charmDied: '殉情出局。', // 狼美人白天出局：「8 號殉情出局。」
  goodWin: '遊戲結束，好人陣營獲勝！',
  wolfWin: '遊戲結束，狼人陣營獲勝！',
  // ── 標點（不錄音，只有文字；播放時 sep 會停頓一下） ──
  end: '。',
  sep: '、',
  colon: '：',
  comma: '，',
};
// 號碼：n1 ～ n20 →「1 號」～「20 號」
for (let i = 1; i <= 20; i++) LINES['n' + i] = `${i} 號`;

export const seatKey = n => 'n' + n;
export const SILENT = new Set(['end', 'sep', 'colon', 'comma']);
export const lineText = keys => keys.map(k => LINES[k] ?? '').join('');
// 錄音用的文字：號碼一律寫成國字（「9 號」→「九號」），AI 語音才不會把數字唸成英文
const DIGITS = '零一二三四五六七八九';
export function zhNumber(n) {
  if (n < 10) return DIGITS[n];
  if (n < 20) return '十' + (n % 10 ? DIGITS[n % 10] : '');
  return DIGITS[Math.floor(n / 10)] + '十' + (n % 10 ? DIGITS[n % 10] : '');
}
// 破音字：AI 語音唸錯的字，錄音時換成同音字（畫面上照樣顯示原字）。
// 「角色」會被唸成 ㄐㄩㄝˊ 色，Leo 要 ㄐㄧㄠˇ 色 → 錄音寫「腳色」（2026-10-17）
const SAY_AS = [['角色', '腳色']];
export const sayAs = t => SAY_AS.reduce((s, [a, b]) => s.replaceAll(a, b), t);
export const spokenText = key => sayAs(LINES[key].replace(/(\d+) 號/g, (_, d) => zhNumber(Number(d)) + '號').trim());
