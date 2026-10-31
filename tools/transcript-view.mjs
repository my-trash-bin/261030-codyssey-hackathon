#!/usr/bin/env node
// @ts-check
// LLM 모델에 입력된 내용을 transcript(JSONL)에서 읽어 보여 주는 도구.
// 모델 호출마다 두 가지 입력을 나눠 출력한다.
//   - System Prompt : 모델에 주는 역할·규칙 지시문 (system 메시지)
//   - User Prompt   : 이번 요청에서 실제로 입력된 내용 (user 메시지)
//
//   transcript-view              가장 최근 실행의 System Prompt·User Prompt 내용
//   transcript-view --count 5    최근 실행 5개
//   transcript-view --raw        User Prompt를 원본 JSON 그대로
//   transcript-view <실행 ID 앞부분>  해당 실행
//   transcript-view --watch      새 실행이 끝날 때마다 바로 출력 (Ctrl+C로 종료)
//   transcript-view --dir <경로>  기록 폴더 지정 (생략하면 .env의 SAFEHANDOFF_TRANSCRIPT_DIR)
//
// 기록은 .env에 SAFEHANDOFF_TRANSCRIPT_DIR와 SAFEHANDOFF_TRANSCRIPT_CONTENT=1을 켠 뒤의 실행부터 남는다.
// 읽기 전용이다. 파일을 고치거나 지우지 않는다.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

function envValue(key) {
  if (process.env[key]) return process.env[key];
  const file = join(root, '.env');
  if (!existsSync(file)) return undefined;
  const match = new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, 'm').exec(readFileSync(file, 'utf8'));
  return match?.[1];
}

const dirSetting = value('--dir') ?? envValue('SAFEHANDOFF_TRANSCRIPT_DIR');
if (!dirSetting) {
  console.error('기록 폴더가 설정되지 않았습니다. .env에 SAFEHANDOFF_TRANSCRIPT_DIR와 SAFEHANDOFF_TRANSCRIPT_CONTENT=1을 켜고 앱 서버를 다시 시작하세요.');
  process.exit(2);
}
const dir = resolve(root, dirSetting);
if (!existsSync(dir)) {
  console.error(`기록 폴더가 없습니다: ${dir}\n앱 서버를 실행하고 요청을 한 번 보내면 생깁니다.`);
  process.exit(2);
}

const color = process.stdout.isTTY && !flag('--no-color');
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const red = t => paint(31, t), green = t => paint(32, t), yellow = t => paint(33, t), cyan = t => paint(36, t), dim = t => paint(2, t), bold = t => paint(1, t);

const OPERATION = { writeReviewed: '문서 작성·검토', generate: '문서 작성·검토', analyze: '자료 분석' };
const ROLE = { writer: '작성 모델', reviewer: '검토 모델', analysis: '분석 모델' };
const time = ms => { const d = new Date(ms), z = n => String(n).padStart(2, '0'); return `${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`; };

function files() {
  return readdirSync(dir)
    .filter(name => /^transcript-[0-9a-f-]{36}\.jsonl$/.test(name))
    .map(name => { const path = join(dir, name); return { name, path, mtime: statSync(path).mtimeMs }; })
    .sort((a, b) => b.mtime - a.mtime);
}

function load(file) {
  const events = [];
  for (const line of readFileSync(file.path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* 쓰는 중인 마지막 줄은 건너뛴다 */ }
  }
  const status = events.some(e => e.event === 'run_failed') ? 'failed'
    : events.some(e => e.event === 'run_completed') ? 'completed' : 'running';
  return { file, events, status, id: events[0]?.run_id ?? file.name.slice(11, 47), operation: events[0]?.operation ?? '?',
    started: file.mtime - (events.at(-1)?.elapsed_ms ?? 0), failCode: events.find(e => e.event === 'run_failed')?.data?.code };
}

const statusText = run => run.status === 'completed' ? green('성공') : run.status === 'failed' ? red(`실패 ${run.failCode ?? ''}`) : yellow('진행 중');

// 기록된 입력이 JSON 문자열이면 들여쓰기해서 보여 준다.
function pretty(text) {
  if (typeof text !== 'string') return JSON.stringify(text, null, 2);
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

// User Prompt(JSON)를 사람이 읽는 형태로 바꾼다. 알 수 없는 항목은 JSON 그대로 둔다.
function draftLines(draft) {
  const out = [];
  for (const b of Array.isArray(draft?.blocks) ? draft.blocks : []) {
    const refs = b.fact_ids?.length ? `  [근거 ${b.fact_ids.length}개]` : '';
    if (b.type === 'heading') out.push(`${'#'.repeat(b.level ?? 2)} ${b.text}`);
    else if (b.type === 'paragraph') out.push(`${b.text}${refs}`);
    else if (b.type === 'list') for (const i of b.items ?? []) out.push(`- ${i.text}${i.fact_ids?.length ? `  [근거 ${i.fact_ids.length}개]` : ''}`);
    else out.push(JSON.stringify(b));
  }
  return out;
}
function readable(input) {
  let v;
  try { v = typeof input === 'string' ? JSON.parse(input) : input; } catch { return String(input); }
  if (!v || typeof v !== 'object') return String(input);
  const out = [];
  const pack = v.fact_pack;
  if (pack) {
    out.push(`[전달 조건] 수신 대상: ${pack.audience_type} · 출력 언어: ${pack.output_language} · 문서 양식: ${pack.template_id}`);
    if (pack.approved_brief) out.push(`[요청 요약] ${pack.approved_brief}`);
    out.push(`[승인된 사실 ${pack.facts?.length ?? 0}개] — 사람이 공개를 허용한 문장만 들어감`);
    (pack.facts ?? []).forEach((f, i) => out.push(`  ${i + 1}. (${f.kind}/${f.uncertainty}${pack.required_fact_ids?.includes(f.id) ? '/필수' : ''}) ${f.statement}`));
  }
  if (v.draft) { out.push('[검토할 초안]'); for (const l of draftLines(v.draft)) out.push(`  ${l}`); }
  if (Array.isArray(v.rendered_files)) {
    for (const f of v.rendered_files) {
      out.push(`[검토할 공유 파일] ${f.path ?? ''}`);
      const body = typeof f.text === 'string' ? f.text : typeof f.content === 'string' ? f.content : JSON.stringify(f);
      for (const l of body.split('\n')) out.push(`  ${l}`);
    }
  }
  if (Array.isArray(v.grounding)) out.push(`[근거 연결] 사실 ${v.grounding.length}개 모두 ${[...new Set(v.grounding.map(g => g.source))].join(', ')} (이번 작업에서 사람이 승인)`);
  if (v.feedback) { out.push('[이전 검토 지적 — 고쳐 쓰기 요청]'); for (const f of [].concat(v.feedback)) out.push(`  - ${f.reason_code ?? ''} ${f.action ?? ''}`); }
  const known = new Set(['fact_pack', 'draft', 'rendered_files', 'grounding', 'feedback']);
  for (const [k, val] of Object.entries(v)) if (!known.has(k)) out.push(`[${k}] ${JSON.stringify(val)}`);
  return out.join('\n');
}

function box(title, text) {
  console.log(`     ┌ ${title}`);
  for (const line of String(text).split('\n')) console.log(`     │ ${line}`);
  console.log('     └');
}

function show(run) {
  console.log(bold(`\n■ ${time(run.started)}  ${run.id.slice(0, 8)}  ${OPERATION[run.operation] ?? run.operation}  `) + statusText(run));
  const calls = run.events.filter(e => e.event === 'model_started');
  if (!calls.length) { console.log(dim('   (모델 호출 없음)')); return; }
  for (const e of calls) {
    const d = e.data ?? {};
    console.log(yellow(`   ▶ ${ROLE[d.role] ?? d.role} 호출 #${d.call}${d.attempt > 1 ? ` (재시도 ${d.attempt}번째)` : ''}`));
    const c = e.content;
    if (c === undefined) {
      console.log(dim(d.role === 'analysis'
        ? '     분석 단계는 원자료 보호를 위해 코어가 입력 내용을 기록하지 않습니다(설계).'
        : '     입력 내용이 기록되지 않았습니다. SAFEHANDOFF_TRANSCRIPT_CONTENT=1을 켜기 전 실행입니다.'));
      continue;
    }
    const sys = c.systemPrompt ?? '';
    const user = c.input === undefined ? '' : String(c.input);
    box(cyan(`System Prompt (${sys.length.toLocaleString()}자)`), sys || dim('(없음)'));
    box(cyan(`User Prompt — 실제 입력 (${user.length.toLocaleString()}자)${flag('--raw') ? ' · 원본 JSON' : ''}`),
      !user ? dim('(없음)') : flag('--raw') ? pretty(c.input) : readable(c.input));
  }
}

function find(prefix) {
  const run = files().map(load).find(r => r.id.startsWith(prefix));
  if (!run) { console.error(`'${prefix}'로 시작하는 실행을 찾지 못했습니다.`); process.exit(1); }
  return run;
}

if (flag('--help') || flag('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 16).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
} else if (flag('--watch')) {
  const done = new Set(files().map(f => f.name));
  console.log(bold(`새 실행을 기다립니다 (Ctrl+C로 종료) — ${dir}`));
  // Windows의 fs.watch는 열린 파일에 쓰는 내용을 놓칠 수 있어 1초마다 확인한다.
  setInterval(() => {
    for (const file of files()) {
      if (done.has(file.name)) continue;
      const run = load(file);
      if (run.status === 'running') continue;
      done.add(file.name);
      show(run);
    }
  }, 1000);
} else {
  console.log(dim(`기록 폴더: ${dir}`));
  const positional = args.filter((a, i) => !a.startsWith('--') && !['--dir', '--count'].includes(args[i - 1]));
  const runs = positional[0] ? [find(positional[0])]
    : files().map(load).slice(0, Number(value('--count')) || 1);
  if (!runs.length) console.log('아직 기록이 없습니다. 웹 화면에서 분석이나 초안 생성을 한 번 실행하세요.');
  for (const run of runs) show(run);
}
