// @ts-check
// 기대효과 10건 비교의 측정 서버와 슬라이드 반영. 사용법은 docs/presentation/GUIDE.md.
//   node tools/effect-measure.mjs serve   측정 화면 http://127.0.0.1:8090
//   node tools/effect-measure.mjs apply   측정표를 집계해 기대효과 슬라이드에 반영
//   node tools/effect-measure.mjs apply --partial   10건 전에 두 방식을 모두 잰 사례만 예비 측정으로 반영
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const path = (/** @type {string} */ relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const CASES = path('evaluation/effect-compare/cases.json');
const PAGE = path('evaluation/effect-compare/measure.html');
const RESULTS = path('evaluation/results/effect-measurements.csv');
const SLIDE = path('docs/presentation/SafeHandoff_기대효과.html');
const HEADER = ['case_id', 'method', 'mode', 'participant', 'measured_at', 'person_seconds', 'wait_seconds',
  'total_seconds', 'leaks', 'missing_clues', 'revisions', 'status'];
export const METHODS = ['direct', 'safehandoff'];

/** @param {string[]} values */
const csvLine = values => values.map(value => `"${value.replaceAll('"', '""')}"`).join(',');

/** @param {string} text @returns {Record<string, string>[]} */
export function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).map(line =>
    [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replaceAll('""', '"')));
  const [head, ...body] = rows;
  return body.map(row => Object.fromEntries(head.map((key, index) => [key, row[index]])));
}

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * 같은 사례를 두 방식 모두 측정한 경우에만 집계한다. 미완료는 분모에 남고 시간 중앙값에서만 빠진다.
 * 연출 앱이나 부분 측정 값은 거부한다.
 * @param {Record<string, string>[]} rows
 * @param {string[]} caseIds
 * @param {{ partial?: boolean }} [options]
 */
export function aggregate(rows, caseIds, options = {}) {
  if (rows.some(row => !['real', 'none'].includes(row.mode))) throw new Error('EFFECT_NOT_REAL_MODE');
  if (options.partial) {
    const both = caseIds.filter(id => METHODS.every(method => rows.some(row => row.case_id === id && row.method === method)));
    if (both.length < 2) throw new Error('EFFECT_TOO_FEW_CASES');
    rows = rows.filter(row => both.includes(row.case_id));
    caseIds = both;
  }
  /** @type {Record<string, any>} */
  const result = {};
  for (const method of METHODS) {
    const own = rows.filter(row => row.method === method);
    const ids = own.map(row => row.case_id).sort();
    if (ids.join() !== [...caseIds].sort().join()) throw new Error(`EFFECT_INCOMPLETE:${method}`);
    const done = own.filter(row => row.status === 'completed');
    const seconds = done.map(row => Number(row.person_seconds));
    result[method] = {
      completed: done.length, total: own.length,
      medianSeconds: done.length ? median(seconds) : null,
      minSeconds: done.length ? Math.min(...seconds) : null,
      maxSeconds: done.length ? Math.max(...seconds) : null,
      leaks: done.reduce((sum, row) => sum + Number(row.leaks), 0),
      missingClues: done.reduce((sum, row) => sum + Number(row.missing_clues), 0),
    };
  }
  result.cases = caseIds.length;
  result.partial = Boolean(options.partial);
  result.participants = new Set(rows.map(row => row.participant)).size;
  result.date = rows.map(row => row.measured_at.slice(0, 10)).sort().at(-1);
  return result;
}

/** @param {string} label @param {string} kind @param {number} value @param {number} max @param {string} text */
const metricRow = (label, kind, value, max, text) =>
  `              <div class="mc-row${kind}"><dt>${label}</dt><dd>` +
  `<span class="mc-bar" style="width:${max ? Math.round(value / max * 110) : 0}px"></span>${text}</dd></div>`;

/** @param {string} html @param {string} key @param {string} body */
function replaceBlock(html, key, body) {
  const start = `<!-- EFFECT:${key}:start -->`;
  const end = `<!-- EFFECT:${key}:end -->`;
  const from = html.indexOf(start);
  const to = html.indexOf(end);
  if (from < 0 || to < 0) throw new Error(`EFFECT_MARKER_MISSING:${key}`);
  return `${html.slice(0, from + start.length)}\n${body}\n            ${html.slice(to)}`;
}

/** @param {string} html @param {any} data */
export function renderSlide(html, data) {
  const { direct, safehandoff } = data;
  /** @param {string} note @param {number} a @param {number} b @param {string} unit @param {string} [aMore] @param {string} [bMore] */
  const panel = (note, a, b, unit, aMore = '', bMore = '') => {
    const max = Math.max(a, b);
    return ['            <dl class="metric-compare">',
      metricRow('직접 준비', '', a, max, `${a}${unit}${aMore}`),
      metricRow('SafeHandoff', ' ours', b, max, `${b}${unit}${bMore}`),
      `              <p class="mc-note">${note}</p>`, '            </dl>'].join('\n');
  };
  /** @param {any} side */
  const range = side => (side.completed ? `<small> ${side.minSeconds}~${side.maxSeconds}</small>` : '');
  const counts = `완료 ${direct.completed}/${direct.total}, ${safehandoff.completed}/${safehandoff.total}`;
  let output = replaceBlock(html, 'time', panel(`사람 작업 중앙값·범위 · 대기 제외 · ${counts}`,
    direct.medianSeconds ?? 0, safehandoff.medianSeconds ?? 0, '초', range(direct), range(safehandoff)));
  output = replaceBlock(output, 'leak', panel('완료 건 합계 · 최종본에 남은 공개 금지 항목 수',
    direct.leaks, safehandoff.leaks, '개'));
  output = replaceBlock(output, 'clue', panel('완료 건 합계 · 최종본에서 빠진 필수 단서 수',
    direct.missingClues, safehandoff.missingClues, '개'));
  return replaceBlock(output, 'cond', `        <span><b>${data.partial ? '예비 측정' : '측정'} ${data.date}</b> · 가상 로그 ${data.cases}건 · 참여 ${data.participants}명 · ` +
    '교차 배정 · 후보 사실은 사전 준비(부분 파이프라인)</span>');
}

function apply() {
  const { cases } = JSON.parse(readFileSync(CASES, 'utf8'));
  const data = aggregate(parseCsv(readFileSync(RESULTS, 'utf8')), cases.map((/** @type {any} */ item) => item.id),
    { partial: process.argv.includes('--partial') });
  writeFileSync(SLIDE, renderSlide(readFileSync(SLIDE, 'utf8'), data));
  console.log(JSON.stringify(data, null, 2));
}

/** @param {import('node:http').IncomingMessage} request */
async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function serve() {
  const origin = process.env.SERVER_ORIGIN ?? 'http://127.0.0.1:8080';
  const port = Number(process.env.EFFECT_PORT ?? 8090);
  const server = createServer(async (request, response) => {
    /** @param {number} status @param {string} type @param {string} body */
    const send = (status, type, body) => { response.writeHead(status, { 'Content-Type': type }); response.end(body); };
    try {
      if (request.method === 'GET' && request.url === '/') return send(200, 'text/html; charset=utf-8', readFileSync(PAGE, 'utf8'));
      if (request.method === 'GET' && request.url === '/cases') return send(200, 'application/json', readFileSync(CASES, 'utf8'));
      if (request.method === 'GET' && request.url === '/core') {
        const core = await fetch(`${origin}/api/core`);
        return send(core.status, 'application/json', await core.text());
      }
      if (request.method === 'POST' && request.url === '/sharing') {
        const reply = await fetch(`${origin}/api/sharing`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: await readBody(request) });
        return send(reply.status, 'application/json', await reply.text());
      }
      if (request.method === 'POST' && request.url === '/record') {
        const row = JSON.parse(await readBody(request));
        mkdirSync(path('evaluation/results'), { recursive: true });
        if (!existsSync(RESULTS)) writeFileSync(RESULTS, `${csvLine(HEADER)}\n`);
        appendFileSync(RESULTS, `${csvLine(HEADER.map(key => String(row[key] ?? '')))}\n`);
        return send(204, 'text/plain', '');
      }
      return send(404, 'text/plain', 'not found');
    } catch (error) {
      return send(502, 'application/json', JSON.stringify({ error: 'EFFECT_UPSTREAM_FAILED',
        detail: error instanceof Error ? error.message : 'unknown' }));
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`측정 화면: http://127.0.0.1:${port} · 대상 앱: ${origin}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'serve') serve();
  else if (process.argv[2] === 'apply') apply();
  else { console.error('사용법: node tools/effect-measure.mjs serve|apply'); process.exitCode = 2; }
}
