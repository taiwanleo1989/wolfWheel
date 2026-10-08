#!/usr/bin/env node
// 把主機台詞的每個片段（public/shared/voice-lines.js）預錄成 public/voice/<key>.mp3，主機播放時直接拼起來。
//
//   npm run voice                 用 Azure 男聲 zh-TW-YunJheNeural 錄（金鑰在 .dev.vars：AZURE_SPEECH_KEY、AZURE_SPEECH_REGION）
//   npm run voice -- --force      全部重錄（預設只錄文字有變的片段）
//   node scripts/record-voice.mjs --provider zhiwei   用 Windows 內建 Microsoft Zhiwei 錄（只用來測流程，不上線）
//
// 錄一次之後就是普通的音檔，玩的時候不會再呼叫 Azure，不會產生費用。
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { LINES, SILENT, spokenText } from '../public/shared/voice-lines.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'voice');
const manifestPath = join(outDir, 'manifest.json');
const args = process.argv.slice(2);
const provider = args.includes('--provider') ? args[args.indexOf('--provider') + 1] : 'azure';
const force = args.includes('--force');
const AZURE_VOICE = 'zh-TW-YunJheNeural';

function devVars() {
  const p = join(root, '.dev.vars');
  if (!existsSync(p)) return {};
  return Object.fromEntries(readFileSync(p, 'utf8').split(/\r?\n/).map(l => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map(m => [m[1], m[2]]));
}
const xml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

async function azure(text) {
  const env = { ...devVars(), ...process.env };
  const key = env.AZURE_SPEECH_KEY, region = env.AZURE_SPEECH_REGION || 'eastasia';
  if (!key) throw new Error('找不到 AZURE_SPEECH_KEY：請在 wolfWheel/.dev.vars 放 AZURE_SPEECH_KEY=… 與 AZURE_SPEECH_REGION=…');
  // 「——」＝上帝比手勢的停頓
  const body = xml(text).replace(/——/g, '<break time="900ms"/>');
  const ssml = `<speak version="1.0" xml:lang="zh-TW"><voice name="${AZURE_VOICE}"><prosody rate="-6%">${body}</prosody></voice></speak>`;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'wolfwheel-voice' },
    body: ssml,
  });
  if (!res.ok) throw new Error(`Azure 回 ${res.status}：${(await res.text()).slice(0, 200)}（401＝金鑰或區域不對）`);
  return Buffer.from(await res.arrayBuffer());
}

function zhiwei(text) {
  const wav = join(tmpdir(), `wolf-${Date.now()}.wav`), mp3 = wav.replace(/\.wav$/, '.mp3');
  const ps = `Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait() | Out-Null; $task.Result }
$s = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$s.Voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -eq 'Microsoft Zhiwei' } | Select-Object -First 1
$st = Await ($s.SynthesizeTextToStreamAsync($env:WOLF_TEXT)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$r = New-Object Windows.Storage.Streams.DataReader($st.GetInputStreamAt(0)); $n = [uint32]$st.Size
$null = Await ($r.LoadAsync($n)) ([uint32]); $b = New-Object byte[] $n; $r.ReadBytes($b)
[System.IO.File]::WriteAllBytes($env:WOLF_OUT, $b)`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { env: { ...process.env, WOLF_TEXT: text.replace(/——/g, '，，，'), WOLF_OUT: wav }, stdio: 'pipe' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-ac', '1', '-b:a', '48k', mp3], { stdio: 'pipe' });
  const buf = readFileSync(mp3);
  rmSync(wav, { force: true }); rmSync(mp3, { force: true });
  return buf;
}

// 剪掉頭尾的靜音：片段要一個接一個拼成句子，頭尾留白會讓「昨晚死亡的是 9 號、12 號」一頓一頓的
function trim(mp3In) {
  const a = join(tmpdir(), `wolf-in-${Date.now()}.mp3`), b = a.replace('-in-', '-out-');
  writeFileSync(a, mp3In);
  const edge = 'silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.03';
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', a, '-af', `${edge},areverse,${edge},areverse`, '-ac', '1', '-b:a', '48k', b], { stdio: 'pipe' });
  const out = readFileSync(b);
  rmSync(a, { force: true }); rmSync(b, { force: true });
  return out;
}

mkdirSync(outDir, { recursive: true });
const voiceName = provider === 'zhiwei' ? 'Microsoft Zhiwei（測試用）' : AZURE_VOICE;
let manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { files: {} };
if (manifest.voice !== voiceName) manifest = { voice: voiceName, files: {} }; // 換聲音就全部重錄

let made = 0, kept = 0;
for (const key of Object.keys(LINES)) {
  if (SILENT.has(key)) continue;
  const text = spokenText(key);
  const file = `${key}.mp3`;
  if (!force && manifest.files[key]?.text === text && existsSync(join(outDir, file))) { kept++; continue; }
  const buf = trim(provider === 'zhiwei' ? zhiwei(text) : await azure(text));
  writeFileSync(join(outDir, file), buf);
  manifest.files[key] = { file, text };
  made++;
  process.stdout.write(`錄好 ${key}：${text}\n`);
}
// 片段表裡已經刪掉的片段，從清單移除
for (const key of Object.keys(manifest.files)) if (!(key in LINES)) { rmSync(join(outDir, manifest.files[key].file), { force: true }); delete manifest.files[key]; }
manifest.voice = voiceName;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`完成：新錄 ${made} 段、沿用 ${kept} 段，聲音 ${voiceName}`);
