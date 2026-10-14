// 角色、板子、發牌。純函式；伺服器（src/）和網頁（public/judge/）共用這一份，改一次兩邊都生效。

export const ROLES = {
  wolf:     { name: '狼人',  team: 'wolf',     unique: false, desc: '每晚和狼隊友一起選一個人殺掉。白天隱藏身分，混在好人裡。' },
  king:     { name: '狼王',  team: 'wolf',     unique: true,  desc: '狼人陣營。被殺或被放逐時可以開槍帶走一人；被女巫毒死不能開槍。' },
  whiteKing: { name: '白狼王', team: 'wolf',    unique: true,  desc: '狼人陣營，晚上和狼隊友一起殺人。白天發言時（投票放逐之前）可以自爆，帶走一個人，今天直接天黑；不是自爆出局就不能帶人。' },
  beauty:   { name: '狼美人', team: 'wolf',     unique: true,  desc: '狼人陣營，晚上和狼隊友一起殺人。狼人殺完人後，再魅惑一個人；狼美人出局時（被殺、被毒、被放逐、被帶走都算），當晚魅惑的人跟著殉情出局，殉情的人不能發動技能。' },
  hidden:   { name: '隱狼',  team: 'wolf',     unique: true,  desc: '狼人陣營。你知道狼隊友是誰，他們不知道你。晚上不跟狼人一起殺人；預言家查你、守墓人看你都是好人。其他狼人全部出局後，你才開始在晚上殺人。' },
  gargoyle: { name: '石像鬼', team: 'wolf',     unique: true,  desc: '狼人陣營，不跟狼隊友見面（互相不知道）。每晚查驗一個人的具體身分。其他狼人全部出局後，你才開始在晚上殺人。' },
  seer:     { name: '預言家', team: 'god',      unique: true,  desc: '每晚查驗一個人，知道他是好人還是狼人。' },
  witch:    { name: '女巫',  team: 'god',      unique: true,  desc: '解藥可以救今晚被殺的人，毒藥可以毒死一個人。兩瓶各只能用一次。' },
  hunter:   { name: '獵人',  team: 'god',      unique: true,  desc: '被殺或被放逐時可以開槍帶走一人；被女巫毒死不能開槍。' },
  guard:    { name: '守衛',  team: 'god',      unique: true,  desc: '每晚守護一個人不被狼殺；不能連續兩晚守同一人。跟女巫救同一人，那人反而會死。' },
  gravekeeper: { name: '守墓人', team: 'god',   unique: true,  desc: '從第二晚開始，每晚得知前一個白天被投票放逐出局的人是好人還是狼人（隱狼會顯示好人）。' },
  knight:   { name: '騎士',  team: 'god',      unique: true,  desc: '白天投票放逐之前可以翻牌和一個人決鬥：他是狼人就出局；不是狼人，騎士自己出局。' },
  idiot:    { name: '白癡',  team: 'god',      unique: true,  desc: '被投票放逐時翻牌免死，但之後不能再投票。' },
  villager: { name: '平民',  team: 'villager', unique: false, desc: '沒有技能。靠推理和投票找出狼人。' },
};
export const ROLE_ORDER = ['wolf', 'king', 'whiteKing', 'beauty', 'hidden', 'gargoyle', 'seer', 'witch', 'hunter', 'guard', 'gravekeeper', 'knight', 'idiot', 'villager'];
// 狼隊（晚上睜眼一起殺人）以外的狼：隱狼、石像鬼。其他狼人全部出局後才開始殺人（2026-10-13 查主流規則）
export const LONE_WOLVES = ['hidden', 'gargoyle'];
export const TEAM_NAME = { wolf: '狼人陣營', god: '神職（好人）', villager: '平民（好人）' };

// 對局畫面的「本局板子」：依陣營分組、寫出狼人陣營總數（Leo 2026-10-10：自訂板子會記錯有幾隻狼）。
// 板子開局前本來就公開，這裡只講「有哪些角色」，不講誰死誰活
export function boardByTeam(counts) {
  const part = team => ROLE_ORDER.filter(id => ROLES[id].team === team && counts[id] > 0)
    .map(id => (counts[id] > 1 ? `${ROLES[id].name} ×${counts[id]}` : ROLES[id].name)).join('、');
  const wolves = ROLE_ORDER.filter(id => ROLES[id].team === 'wolf').reduce((n, id) => n + (counts[id] ?? 0), 0);
  return [
    { label: `狼人陣營 ${wolves} 隻`, text: part('wolf') },
    { label: '神職', text: part('god') },
    { label: '平民', text: part('villager') },
  ].filter(x => x.text);
}

export const DEFAULT_RULES = { witchSelfSave: 'never', win: 'side', police: true, fakeWaitMin: 8, fakeWaitMax: 15 };
const WITCH_OPTS = ['never', 'first', 'always']; // 預設不能自救（Leo 手稿，2026-10-08）
const WIN_OPTS = ['side', 'all'];

// 整理主機送來的角色數量：不認得的角色丟掉、負數與小數歸零、限定一人的角色最多 1
export function cleanCounts(raw) {
  const counts = {};
  for (const id of ROLE_ORDER) {
    let n = Math.floor(Number(raw?.[id] ?? 0));
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (ROLES[id].unique) n = Math.min(n, 1);
    n = Math.min(n, 20);
    if (n > 0) counts[id] = n;
  }
  return counts;
}

export function cleanRules(raw) {
  const r = { ...DEFAULT_RULES };
  if (WITCH_OPTS.includes(raw?.witchSelfSave)) r.witchSelfSave = raw.witchSelfSave;
  if (WIN_OPTS.includes(raw?.win)) r.win = raw.win;
  if (typeof raw?.police === 'boolean') r.police = raw.police; // 第一晚要不要上警（Leo 2026-10-08：不是每把都上警）
  const min = Math.round(Number(raw?.fakeWaitMin)), max = Math.round(Number(raw?.fakeWaitMax));
  if (Number.isFinite(min)) r.fakeWaitMin = Math.min(60, Math.max(3, min));
  if (Number.isFinite(max)) r.fakeWaitMax = Math.min(60, Math.max(3, max));
  if (r.fakeWaitMax < r.fakeWaitMin) r.fakeWaitMax = r.fakeWaitMin;
  return r;
}

export const totalOf = counts => Object.values(counts).reduce((a, b) => a + b, 0);

// 能不能用這組角色開局？回傳問題清單（空陣列＝可以）
export function problems(counts, players) {
  const out = [];
  const total = totalOf(counts);
  if (total !== players) out.push(`角色共 ${total} 個，座位有 ${players} 個，要一樣多`);
  const wolves = ROLE_ORDER.filter(id => ROLES[id].team === 'wolf').reduce((n, id) => n + (counts[id] ?? 0), 0);
  if (wolves < 1) out.push('至少要有 1 隻狼');
  if (total - wolves < 1) out.push('至少要有 1 個好人');
  if (wolves * 2 >= total && total > 0) out.push('狼人數量要少於一半，不然一開局就輸了');
  return out;
}

// 發牌：把角色洗亂後依座位 1..N 發下去。rand(n) 回傳 0..n-1 的整數（伺服器用 crypto）
export function deal(counts, players, rand) {
  const deck = [];
  for (const id of ROLE_ORDER) for (let i = 0; i < (counts[id] ?? 0); i++) deck.push(id);
  if (deck.length !== players) throw new Error('角色數與人數不符');
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const roles = {};
  deck.forEach((id, i) => { roles[i + 1] = id; });
  return roles;
}
