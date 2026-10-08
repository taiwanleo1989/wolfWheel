// 角色、板子、發牌。純函式；伺服器（src/）和網頁（public/judge/）共用這一份，改一次兩邊都生效。

export const ROLES = {
  wolf:     { name: '狼人',  team: 'wolf',     unique: false, desc: '每晚和狼隊友一起選一個人殺掉。白天隱藏身分，混在好人裡。' },
  king:     { name: '狼王',  team: 'wolf',     unique: true,  desc: '狼人陣營。被殺或被放逐時可以開槍帶走一人；被女巫毒死不能開槍。' },
  seer:     { name: '預言家', team: 'god',      unique: true,  desc: '每晚查驗一個人，知道他是好人還是狼人。' },
  witch:    { name: '女巫',  team: 'god',      unique: true,  desc: '解藥可以救今晚被殺的人，毒藥可以毒死一個人。兩瓶各只能用一次。' },
  hunter:   { name: '獵人',  team: 'god',      unique: true,  desc: '被殺或被放逐時可以開槍帶走一人；被女巫毒死不能開槍。' },
  guard:    { name: '守衛',  team: 'god',      unique: true,  desc: '每晚守護一個人不被狼殺；不能連續兩晚守同一人。跟女巫救同一人，那人反而會死。' },
  knight:   { name: '騎士',  team: 'god',      unique: true,  desc: '白天可以翻牌和一個人決鬥：他是狼人就出局；不是狼人，騎士自己出局。' },
  idiot:    { name: '白癡',  team: 'god',      unique: true,  desc: '被投票放逐時翻牌免死，但之後不能再投票。' },
  villager: { name: '平民',  team: 'villager', unique: false, desc: '沒有技能。靠推理和投票找出狼人。' },
};
export const ROLE_ORDER = ['wolf', 'king', 'seer', 'witch', 'hunter', 'guard', 'knight', 'idiot', 'villager'];
export const TEAM_NAME = { wolf: '狼人陣營', god: '神職（好人）', villager: '平民（好人）' };

export const PRESETS = [
  { id: 'yu-nv-lie-bai', name: '預女獵白', players: 12, counts: { wolf: 4, seer: 1, witch: 1, hunter: 1, idiot: 1, villager: 4 } },
  { id: 'lang-wang-shou-wei', name: '狼王守衛', players: 12, counts: { wolf: 3, king: 1, seer: 1, witch: 1, hunter: 1, guard: 1, villager: 4 } },
  { id: 'lang-wang-qi-shi', name: '狼王騎士', players: 12, counts: { wolf: 3, king: 1, seer: 1, witch: 1, hunter: 1, knight: 1, villager: 4 } },
  { id: 'yu-nv-lie-9', name: '預女獵（9 人）', players: 9, counts: { wolf: 3, seer: 1, witch: 1, hunter: 1, villager: 3 } },
];

export const DEFAULT_RULES = { witchSelfSave: 'never', win: 'side', fakeWaitMin: 8, fakeWaitMax: 15 };
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
  const wolves = (counts.wolf ?? 0) + (counts.king ?? 0);
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
