#!/usr/bin/env node
// 把「在 ElevenLabs 網頁上產生的整段錄音」切回一個個片段（public/voice/<key>.mp3）。
//
// 為什麼要這樣做：免費方案不能用 API 呼叫聲音庫的聲音（台灣腔男聲），只能在網頁上產生；
// 網頁產生時停頓標記也不一定生效，所以改用 ElevenLabs「強制對齊」拿到每個字的時間，再照台詞切。
//
// 可以有好幾批錄音（voice-src/batches.json），後面的批次蓋掉前面同名的片段——
// 例如第一批號碼連著唸、切不乾淨，就只把號碼重錄成第二批（2026-10-09）。
//   batches.json：[{ "order": "order.json", "audio": "第一批.mp3" }, { "order": "order-2.json", "audio": "batch2.mp3" }]
//   order*.json：錄音當時貼上去的文字，照順序切成 [{ key, text }]；key 是 null 的是隔開用的「。……。」
//
//   npm run voice:split -- --voice "Liu Junnan（ElevenLabs v4）"
//   （金鑰 ELEVENLABS_API_KEY 在 .dev.vars，要有「強制對齊」權限；對齊結果會存檔，重切不再呼叫）
//
// 下刀：在兩段之間「最安靜的那一刻」切（每 5 毫秒算一次音量）。下刀點還有說話聲（> -55 dB）的段落會標 ⚠️＝要重錄。
// 台詞改過、但新台詞是某段錄音的開頭幾個字（例：「發動技能，帶走了」→「發動技能」）：只取那幾個字，不用重錄。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES, SILENT, spokenText } from '../public/shared/voice-lines.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'voice-src'), outDir = join(root, 'public', 'voice');
const args = process.argv.slice(2);
const opt = n => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const voiceLabel = opt('--voice') ?? 'ElevenLabs（網頁產生）';
const RATE = 16000, HOP = 80; // 80 樣本＝5ms
const LOUD = -55;
const isSpoken = c => /[\p{L}\p{N}]/u.test(c.text);
const apiKey = () => Object.fromEntries(readFileSync(join(root, '.dev.vars'), 'utf8').split(/\r?\n/).map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()])).ELEVENLABS_API_KEY;

async function loadBatch(b) {
  const audioPath = join(srcDir, b.audio);
  if (!existsSync(audioPath)) throw new Error(`找不到錄音 voice-src/${b.audio}`);
  const order = JSON.parse(readFileSync(join(srcDir, b.order), 'utf8'));
  const fullText = order.map(o => o.text).join('');

  // 強制對齊（存檔）
  const cache = join(srcDir, `alignment-${b.audio}.json`);
  let align;
  if (existsSync(cache)) align = JSON.parse(readFileSync(cache, 'utf8'));
  else {
    const fd = new FormData();
    fd.append('file', new Blob([readFileSync(audioPath)], { type: 'audio/mpeg' }), 'host.mp3');
    fd.append('text', fullText);
    const res = await fetch('https://api.elevenlabs.io/v1/forced-alignment', { method: 'POST', headers: { 'xi-api-key': apiKey() }, body: fd });
    const txt = await res.text();
    if (!res.ok) throw new Error(`強制對齊失敗 ${res.status}：${txt.slice(0, 300)}`);
    align = JSON.parse(txt);
    writeFileSync(cache, JSON.stringify(align));
  }
  const chars = align.characters;
  if (chars.length !== [...fullText].length) console.warn(`⚠️ ${b.audio}：對齊字數 ${chars.length} 跟原文 ${[...fullText].length} 不同`);

  // 每段的字與實際說話的頭尾時間（隔開用的段落也算進來，才能在它前後找安靜的地方）
  let at = 0;
  const segs = [];
  for (const o of order) {
    const n = [...o.text].length;
    const cs = chars.slice(at, at + n);
    at += n;
    const spoken = cs.filter(isSpoken);
    if (o.key && spoken.length) segs.push({ ...o, cs, start: spoken[0].start, end: spoken.at(-1).end });
  }

  // 音量曲線
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', audioPath, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const wave = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
  const rms = [];
  for (let i = 0; i + HOP <= wave.length; i += HOP) { let s = 0; for (let j = i; j < i + HOP; j++) s += wave[j] * wave[j]; rms.push(Math.sqrt(s / HOP)); }
  const total = wave.length / RATE;
  const quietest = (t0, t1) => {
    const a = Math.max(0, Math.floor(t0 * RATE / HOP)), z = Math.min(rms.length - 1, Math.ceil(t1 * RATE / HOP));
    let best = a;
    for (let i = a; i <= z; i++) if (rms[i] < rms[best]) best = i;
    return (best + 0.5) * HOP / RATE;
  };
  const cutBetween = (endA, startB) => quietest(Math.min(endA, startB) - 0.08, Math.max(endA, startB) + 0.08);
  const dbAt = t => 20 * Math.log10((rms[Math.min(rms.length - 1, Math.max(0, Math.round(t * RATE / HOP)))] ?? 0) + 1e-9);

  // 頭尾兩段不用跟別人搶邊界：往外多留一點，免得切到第一個字前的吸氣、最後一個字的尾音
  const cuts = segs.map((s, j) => ({
    from: j === 0 ? Math.max(0, s.start - 0.3) : cutBetween(segs[j - 1].end, s.start),
    to: j === segs.length - 1 ? Math.min(total, s.end + 0.4) : cutBetween(s.end, segs[j + 1].start),
  }));
  return { ...b, audioPath, segs, cuts, cutBetween, dbAt, first: segs[0]?.key, last: segs.at(-1)?.key };
}

const batches = existsSync(join(srcDir, 'batches.json'))
  ? JSON.parse(readFileSync(join(srcDir, 'batches.json'), 'utf8'))
  : [{ order: 'order.json', audio: readdirSync(srcDir).filter(n => n.endsWith('.mp3')).sort().at(-1) }];
const loaded = [];
for (const b of batches) loaded.push(await loadBatch(b));

// 片段表裡需要的每個片段：從「最後一批有它的」錄音拿（同 key 同文字；或某段錄音的開頭幾個字）
const plain = t => t.replace(/[。！？，、…]+$/u, '');
const plan = [], missing = [];
for (const key of Object.keys(LINES)) {
  if (SILENT.has(key)) continue;
  const want = spokenText(key).replace(/——/g, '……');
  let found = null;
  for (const B of [...loaded].reverse()) {
    const j = B.segs.findIndex(s => s.key === key && plain(s.text) === plain(want));
    if (j >= 0) { found = { B, ...B.cuts[j], isEdge: j === 0 || j === B.segs.length - 1 }; break; }
  }
  if (!found) {
    const p = plain(want);
    for (const B of [...loaded].reverse()) {
      const k = B.segs.findIndex(s => p && s.text.startsWith(p));
      if (k < 0) continue;
      const s = B.segs[k], n = [...p].length;
      const last = s.cs.slice(0, n).filter(isSpoken).at(-1), next = s.cs.slice(n).find(isSpoken);
      found = { B, from: B.cuts[k].from, to: next ? B.cutBetween(last.end, next.start) : B.cuts[k].to, note: `取自「${s.text}」的前 ${n} 字` };
      break;
    }
  }
  if (found) plan.push({ key, want, ...found });
  else missing.push(`${key}：${want}`);
}
if (missing.length) { console.error('❌ 這些台詞在錄音裡找不到，要重新產生錄音：\n  ' + missing.join('\n  ')); process.exitCode = 1; }

// 切檔：只輕輕去掉頭尾「幾乎沒聲音」的部分（門檻低、留 40ms），不會吃掉「四」「十」這種輕的開頭；加淡入淡出防爆音
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) rmSync(join(outDir, f));
const edge = 'silenceremove=start_periods=1:start_threshold=-58dB:start_silence=0.04';
const manifest = { voice: voiceLabel, source: batches.map(b => b.audio), files: {} };
const report = [], unclean = [];
for (const c of plan) {
  const file = `${c.key}.mp3`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', c.from.toFixed(3), '-to', c.to.toFixed(3), '-i', c.B.audioPath,
    '-af', `${edge},areverse,${edge},afade=t=in:d=0.012,areverse,afade=t=in:d=0.008`, '-ac', '1', '-b:a', '64k', join(outDir, file)], { stdio: 'pipe' });
  manifest.files[c.key] = { file, text: spokenText(c.key) };
  const dFrom = c.B.dbAt(c.from), dTo = c.B.dbAt(c.to);
  const loud = dFrom > LOUD || dTo > LOUD;
  if (loud) unclean.push(c.key);
  const tag = loaded.length > 1 ? `[${loaded.indexOf(c.B) + 1}] ` : '';
  report.push(`${tag}${c.key.padEnd(14)} ${c.from.toFixed(2).padStart(6)}→${c.to.toFixed(2).padStart(6)}  ${(c.to - c.from).toFixed(2)}s  ${c.want}${c.note ? '（' + c.note + '）' : ''}${loud ? `  ⚠️ 切點有聲音（${dFrom.toFixed(0)}／${dTo.toFixed(0)} dB）` : ''}`);
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(report.join('\n'));
console.log(`完成：${plan.length} 段 → public/voice/（${voiceLabel}）`);
if (unclean.length) console.log(`⚠️ ${unclean.length} 段切不乾淨（前後沒有真正的停頓），要重錄：${unclean.join(' ')}`);
else console.log('✅ 每一段的切點都落在安靜的地方');
