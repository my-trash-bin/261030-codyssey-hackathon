import { Workspace } from './state.js';
const $ = id => document.getElementById(id);
const state = new Workspace();
let sources = [], candidates = [], scenarios = [], mode = '', scenarioID = '';
let controller = null, serial = 0;
function status(message) { $('status').textContent = message; }
function resetConfirmation() { $('confirm').checked = false; syncDownload(); }
function syncDownload() { $('download').disabled = !state.downloadable($('confirm').checked); }
function stale() {
  state.invalidate(); resetConfirmation();
  $('result-state').textContent = '입력·공개 선택이 변경됐습니다. 다시 작성해 주세요.';
  $('title').disabled = $('body').disabled = $('confirm').disabled = $('review-again').disabled = true;
  $('review').textContent = '';
}
function invalidateAnalysis() {
  stale(); candidates = []; renderCandidates();
}
async function api(path, input, signal) {
  const response = await fetch('/api' + path, {
    method: input === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Safehandoff-UI': '1' },
    body: input === undefined ? undefined : JSON.stringify(input), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP_${response.status}`);
  return result;
}
async function request(label, work) {
  controller?.abort();
  const ownController = new AbortController(), ownSerial = ++serial;
  controller = ownController; $('cancel').disabled = false; status(label);
  try { await work(ownController.signal, ownSerial); }
  catch (error) { if (ownSerial === serial) status(error.name === 'AbortError' ? '요청을 취소했습니다. 선택은 보존됩니다.' : `실패: ${error.message}`); }
  finally { if (ownSerial === serial) { controller = null; $('cancel').disabled = true; } }
}
function renderSources() {
  $('sources').replaceChildren(); $('source-count').textContent = `${sources.length}개`;
  for (const source of sources) {
    const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
    summary.textContent = source.name; pre.textContent = source.text;
    details.append(summary, pre); $('sources').append(details);
  }
}
function renderCandidates() {
  $('candidates').replaceChildren();
  if (!candidates.length) { $('candidates').textContent = '자료를 분석하거나 공개 후보를 직접 추가하세요.'; return; }
  for (const candidate of candidates) {
    const card = document.createElement('article'); card.className = 'candidate';
    const label = document.createElement('label'); label.className = 'check';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = candidate.approved;
    check.addEventListener('change', () => { candidate.approved = check.checked; stale(); });
    label.append(check, document.createTextNode('이 표현을 현재 목적·수신자에게 공개 승인'));
    const text = document.createElement('textarea'); text.rows = 3; text.value = candidate.text;
    text.setAttribute('aria-label', '공유할 표현');
    text.addEventListener('input', () => { candidate.text = text.value; candidate.approved = false; check.checked = false; stale(); });
    const reason = document.createElement('p'); reason.className = 'hint'; reason.textContent = candidate.reason;
    const evidence = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '근거 원자료 확인'; evidence.append(summary);
    for (const id of candidate.source_ids) {
      const source = sources.find(item => item.id === id), pre = document.createElement('pre');
      pre.textContent = source ? `${source.name}\n${source.text}` : '사용자가 직접 입력한 공개 후보'; evidence.append(pre);
    }
    card.append(text, reason, evidence, label); $('candidates').append(card);
  }
}
function currentInput() {
  const inputSources = [...sources];
  if ($('notes').value.trim()) inputSources.push({ id: 'notes', name: '직접 입력 메모', text: $('notes').value });
  return { scenario: scenarioID, purpose: $('purpose').value, recipient: $('recipient').value, sources: inputSources };
}
function facts() {
  return { purpose: $('purpose').value, recipient: $('recipient').value,
    facts: candidates.filter(c => c.approved).map(c => ({ id: c.id, text: c.text })) };
}
function renderResult() {
  const result = state.result;
  $('title').value = result.document.title; $('body').value = result.document.body;
  $('title').disabled = $('body').disabled = $('review-again').disabled = false;
  $('result-state').textContent = `${result.mode === 'demo' ? '시연용 템플릿' : '실제 모델'} · 현재 승인으로 작성한 공유본`;
  renderReview(result.review); resetConfirmation();
}
function renderReview(review) {
  const prefix = mode === 'demo' ? '시연 검사: 승인 문장의 포함 여부만 확인합니다. 추가 정보 유출이나 의미를 판정하지 않습니다.' : '모델 검토: 보안을 보장하지 않으며 사람의 최종 확인이 필요합니다.';
  $('review').textContent = prefix + '\n' + (review.pass ? '검토 통과. 실제 내용을 확인하세요.' : `검토 필요: ${review.issues.join(' / ')}`);
  $('confirm').disabled = !review.pass; resetConfirmation();
}
$('load').onclick = () => {
  const scenario = scenarios.find(s => s.id === $('scenario').value); if (!scenario) return;
  controller?.abort(); serial++; $('cancel').disabled = true;
  sources = structuredClone(scenario.input.sources); scenarioID = scenario.id;
  $('purpose').value = scenario.input.purpose; $('recipient').value = scenario.input.recipient;
  $('notes').value = ''; $('files').value = ''; invalidateAnalysis(); renderSources(); status('사례를 불러왔습니다. 자료 분석을 시작하세요.');
};
$('files').onchange = async () => {
  invalidateAnalysis(); const ticket = state.ticket();
  try {
    const loaded = await Promise.all([...$('files').files].map(async (file, i) => ({ id: `upload-${i}`, name: file.name, text: await file.text() })));
    if (ticket !== state.ticket()) return;
    sources = loaded; scenarioID = ''; invalidateAnalysis(); renderSources();
  } catch (error) { status(`파일 읽기 실패: ${error.message}`); }
};
for (const id of ['purpose', 'recipient', 'notes']) $(id).oninput = invalidateAnalysis;
$('analyze').onclick = () => {
  invalidateAnalysis(); const ticket = state.ticket(), input = currentInput();
  request('자료를 분석하고 있습니다…', async (signal, ownSerial) => {
    const result = await api('/v1/analyze', input, signal);
    if (ownSerial !== serial || ticket !== state.ticket()) return;
    candidates = result.candidates.map(c => ({ ...c, approved: false })); renderCandidates();
    status('공개 후보를 확인하세요. 처음에는 모두 미승인입니다.');
  });
};
$('add').onclick = () => {
  const text = $('manual-text').value.trim(); if (!text) return;
  candidates.push({ id: `manual-${Date.now()}-${candidates.length}`, text, approved: false, source_ids: [], reason: '사용자가 직접 정한 공개 후보' });
  $('manual-text').value = ''; stale(); renderCandidates();
};
$('generate').onclick = () => {
  const input = facts(); if (!input.facts.length) { status('공개할 표현을 하나 이상 승인하세요.'); return; }
  stale(); const ticket = state.ticket();
  request('현재 승인으로 공유본을 새로 작성하고 검토합니다…', async (signal, ownSerial) => {
    const result = await api('/v1/generate', input, signal);
    if (ownSerial !== serial || !state.apply(ticket, result)) return;
    renderResult(); status('공유본을 작성했습니다. 공개 선택을 변경하면 다시 작성해야 합니다.');
  });
};
for (const id of ['title', 'body']) $(id).oninput = () => {
  if (!state.result) return;
  state.edit(); state.result.document = { title: $('title').value, body: $('body').value };
  $('confirm').disabled = true; resetConfirmation(); $('review').textContent = '편집한 공유본은 다시 검토해야 합니다.';
};
$('review-again').onclick = () => {
  const ticket = state.ticket();
  request('편집본을 검토합니다…', async (signal, ownSerial) => {
    const review = await api('/v1/review', { ...facts(), document: { title: $('title').value, body: $('body').value } }, signal);
    if (ownSerial !== serial || !state.review(ticket, review)) return;
    renderReview(review); status('편집본 검토가 끝났습니다.');
  });
};
$('confirm').onchange = syncDownload;
$('cancel').onclick = () => controller?.abort();
$('download').onclick = () => {
  if (!state.downloadable($('confirm').checked)) return;
  const doc = state.result.document, blob = new Blob([`# ${doc.title}\n\n${doc.body}\n`], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'shared-document.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('clear').onclick = () => {
  controller?.abort(); serial++; sources = []; scenarioID = ''; candidates = []; state.invalidate();
  for (const id of ['notes', 'files', 'manual-text', 'title', 'body']) $(id).value = '';
  $('cancel').disabled = true; stale(); renderSources(); renderCandidates(); status('새 작업을 시작합니다.');
};
async function connect() {
  try {
    const health = await api('/health'); mode = health.mode;
    $('mode').textContent = mode === 'demo' ? '시연 · 모델 호출 없음' : '실제 엔진 · 모델 연결';
    $('connection').textContent = mode === 'demo' ? '준비된 가상 사례로 화면 흐름을 시험합니다. 후보는 사전 작성된 것이며 출력은 템플릿입니다. 직접 입력 자료의 자동 분석은 실제 엔진에서 시험하세요.' : '분석·재작성·검토를 실제 모델로 실행합니다. 승인한 표현을 직접 확인하세요.';
    scenarios = await api('/v1/scenarios');
    for (const scenario of scenarios) { const option = document.createElement('option'); option.value = scenario.id; option.textContent = scenario.name; $('scenario').append(option); }
    if (scenarios.length) $('scenario').value = scenarios[0].id;
  } catch (error) {
    $('mode').textContent = '엔진 연결 실패'; $('connection').textContent = `웹 화면은 실행 중입니다. 엔진 연결 실패: ${error.message}. 엔진을 시작한 후 새로고침하세요.`;
  }
}
connect();
