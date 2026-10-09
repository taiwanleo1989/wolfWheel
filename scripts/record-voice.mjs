#!/usr/bin/env node
// 把主機台詞的每個片段（public/shared/voice-lines.js）預錄成 public/voice/<key>.mp3，主機播放時直接拼起來。
//
//   npm run voice -- --voice <voice_id>    用 ElevenLabs 錄（Leo 2026-10-09 選定；金鑰在 .dev.vars：ELEVENLABS_API_KEY，
//                                          聲音 id 也可以寫在 .dev.vars：ELEVENLABS_VOICE_ID）
//   npm run voice -- --list-voices          列出這把金鑰能用的聲音
//   npm run voice -- --sample <資料夾> --voice <id>   只錄一段試聽（不動 public/voice）
//   npm run voice -- --force                全部重錄（預設只錄文字有變的片段）
//   --provider azure                         改用 Azure zh-TW-YunJheNeural（.dev.vars：AZURE_SPEECH_KEY、AZURE_SPEECH_REGION）
//   --provider zhiwei                        用 Windows 內建 Microsoft Zhiwei（只用來測流程，不上線）
//
// 錄一次之後就是普通的音檔，玩的時候不會再呼叫任何語音服務，不會產生費用。
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { LINES, SILENT, spokenText, lineText } from '../public/shared/voice-lines.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'voice');
const manifestPath = join(outDir, 'manifest.json');
const args = process.argv.slice(2);
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const provider = opt('--provider') ?? 'elevenlabs';
const force = args.includes('--force');
const AZURE_VOICE = 'zh-TW-YunJheNeural';

function devVars() {
  const p = join(root, '.dev.vars');
  if (!existsSync(p)) return {};
  return Object.fromEntries(readFileSync(p, 'utf8').split(/\r?\n/).map(l => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map(m => [m[1], m[2]]));
}
const xml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// ElevenLabs：多語模型唸中文；「——」換成刪節號讓它停頓
async function elevenlabs(text) {
  const env = { ...devVars(), ...process.env };
  const key = env.ELEVENLABS_API_KEY, voiceId = opt('--voice') ?? env.ELEVENLABS_VOICE_ID;
  if (!key) throw new Error('找不到 ELEVENLABS_API_KEY：請在 wolfWheel/.dev.vars 放 ELEVENLABS_API_KEY=…');
  if (!voiceId) throw new Error('沒有指定聲音：加 --voice <voice_id>，或在 .dev.vars 放 ELEVENLABS_VOICE_ID=…（先跑 --list-voices 看有哪些）');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: text.replace(/——/g, '……'),
      model_id: opt('--model') ?? 'eleven_multilingual_v2',
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs 回 ${res.status}：${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function listVoices() {
  const key = { ...devVars(), ...process.env }.ELEVENLABS_API_KEY;
  if (!key) throw new Error('找不到 ELEVENLABS_API_KEY');
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
  if (!res.ok) throw new Error(`ElevenLabs 回 ${res.status}：${(await res.text()).slice(0, 300)}`);
  const { voices } = await res.json();
  for (const v of voices) console.log([v.voice_id, v.name, v.category, v.labels?.gender, v.labels?.accent, v.labels?.age, v.labels?.description].map(x => x ?? '').join('	'));
}

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

const record = async text => {
  if (provider === 'zhiwei') return zhiwei(text);
  if (provider === 'azure') return azure(text);
  return elevenlabs(text);
};

if (args.includes('--list-voices')) { await listVoices(); process.exit(0); }

// 試聽：錄一段有代表性的台詞（含拼接的死訊），不動 public/voice
if (opt('--sample')) {
  const dir = opt('--sample');
  mkdirSync(dir, { recursive: true });
  const name = (opt('--voice') ?? provider).replace(/[^\w-]/g, '_');
  const sample = ['nightStart', 'wolfOpenKing', 'witchSave', 'dawn'].map(spokenText).join('') + '昨晚死亡的是九號、十二號。';
  const out = join(dir, `sample-${name}.mp3`);
  writeFileSync(out, trim(await record(sample)));
  console.log(`試聽檔：${out}（${lineText(['nightStart'])}…）`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const voiceName = provider === 'zhiwei' ? 'Microsoft Zhiwei（測試用）' : provider === 'azure' ? AZURE_VOICE : `ElevenLabs ${opt('--voice') ?? { ...devVars(), ...process.env }.ELEVENLABS_VOICE_ID}`;
let manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { files: {} };
if (manifest.voice !== voiceName) manifest = { voice: voiceName, files: {} }; // 換聲音就全部重錄

let made = 0, kept = 0;
for (const key of Object.keys(LINES)) {
  if (SILENT.has(key)) continue;
  const text = spokenText(key);
  const file = `${key}.mp3`;
  if (!force && manifest.files[key]?.text === text && existsSync(join(outDir, file))) { kept++; continue; }
  const buf = trim(await record(text));
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
