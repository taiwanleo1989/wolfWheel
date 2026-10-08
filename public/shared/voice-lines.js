// 主機台詞的「片段表」：每一句台詞、每個號碼都是一個片段，各自預錄成一個音檔（public/voice/<key>.mp3）。
// 引擎用片段組句子（例如 ['dawn', 'deathsAre', 'n9', 'end']），畫面上的文字與主機播的聲音都從這張表來，永遠一致。
// 改了這裡的字，要重錄：npm run voice（見 scripts/record-voice.mjs）。
//
// 文字裡的「——」錄音時會變成停頓；值是空字串的片段（標點）只影響文字、不錄音。

export const LINES = {
  // ── 黑夜（照 Leo 手稿） ──
  nightStart: '天黑請閉眼。',
  guardOpen: '守衛請睜眼。請選擇今晚要守護的玩家。',
  guardClose: '守衛請閉眼。',
  wolfOpen: '狼人請睜眼。今晚要擊殺的目標是？',
  wolfOpenKing: '狼人請睜眼。狼王請確認身分。今晚要擊殺的目標是？',
  wolfClose: '狼人請閉眼。',
  witchSave: '女巫請睜眼。今晚死亡的玩家是——請問你要使用解藥嗎？',
  witchPoison: '請問你要使用毒藥嗎？如果要，請選擇你要毒殺的號碼。',
  witchClose: '女巫請閉眼。',
  seerOpen: '預言家請睜眼。請問你今晚要查驗的玩家是？',
  seerClose: '預言家請閉眼。',
  hunterOpen: '獵人請睜眼。獵人，你今晚的帶槍手勢是——',
  hunterClose: '獵人請閉眼。',
  police: '要上警的玩家請起立。',
  // ── 天亮與白天 ──
  dawn: '天亮請睜眼。',
  deathsAre: '昨晚死亡的是 ',
  peace: '昨晚是平安夜。',
  shootTook: '發動技能，帶走了 ',
  tie: '平票，今天沒有人出局。',
  idiotFlip: '翻牌，是白癡，免於出局，但之後不能投票。',
  exiled: '被放逐出局。',
  knight: '騎士 ',
  duelWith: '決鬥 ',
  duelWolf: '是狼人，出局！',
  duelGood: '是好人，騎士以死謝罪。',
  goodWin: '遊戲結束，好人陣營獲勝！',
  wolfWin: '遊戲結束，狼人陣營獲勝！',
  // ── 標點（不錄音，只有文字；播放時 sep 會停頓一下） ──
  end: '。',
  sep: '、',
  colon: '：',
};
// 號碼：n1 ～ n20 →「1 號」～「20 號」
for (let i = 1; i <= 20; i++) LINES['n' + i] = `${i} 號`;

export const seatKey = n => 'n' + n;
export const SILENT = new Set(['end', 'sep', 'colon']);
export const lineText = keys => keys.map(k => LINES[k] ?? '').join('');
// 錄音用的文字：「——」改成停頓標記、去掉號碼中間的空白
export const spokenText = key => LINES[key].replace(/ 號/g, '號').trim();
