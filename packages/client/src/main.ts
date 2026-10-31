// SafeHandoff 작업 화면 동작.
// 실제 서버에 연결된 API는 GET/POST /api/documents, GET /api/core, POST /api/analysis다.
// 로컬 접속 영역은 session-client.ts로 POST·GET /api/v1/session을 호출해 CSRF 토큰을 받고,
// 그 토큰을 공개 결정 영역에 넘겨 쓰기를 연다. 토큰은 메모리에만 두고 저장하지 않는다.
// 공개 결정 영역은 disclosure-view.ts에서 후보별로 렌더한다. 실제 성공 응답 없이 완료를 표시하지 않는다.
// 파일 분석 영역은 analysis-view.ts가 맡고 결과를 task 후보·공개 허가로 바꾸지 않는다.

import { mountAnalysis } from './analysis-view.js';
import { mountDisclosures } from './disclosure-view.js';
import { openSession, restoreSession, sessionFailureMessage } from './session-client.js';
import type { SessionInfo } from './session-client.js';
import { toWireSources } from './analysis-state.js';
import type { WireSource } from './analysis-state.js';
import { cancelAnalysis, createTask, readAnalysisJob, replaceSources, startAnalysis, taskFailureMessage } from './task-client.js';

interface DocumentRecord { id: string; text: string; createdAt: string }
type LoadResult = 'ok' | 'failed';

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`UI 계약 위반: 필수 요소 #${id}를 찾을 수 없습니다.`);
  return element as T;
}

const modeLabel = required<HTMLSpanElement>('mode-label');
const connectionLabel = required<HTMLSpanElement>('connection-label');
const runtimeStatus = required<HTMLParagraphElement>('runtime-status');
const runtimeRefresh = required<HTMLButtonElement>('runtime-refresh');
const saveForm = required<HTMLFormElement>('save-form');
const textArea = required<HTMLTextAreaElement>('text');
const saveButton = required<HTMLButtonElement>('save');
const saveStatus = required<HTMLParagraphElement>('status');
const refreshButton = required<HTMLButtonElement>('refresh');
const documentsRegion = required<HTMLDivElement>('documents');
const documentsStatus = required<HTMLParagraphElement>('documents-status');
const disclosureMount = required<HTMLElement>('disclosure-mount');
const sessionForm = required<HTMLFormElement>('session-form');
const sessionToken = required<HTMLInputElement>('session-token');
const sessionConnect = required<HTMLButtonElement>('session-connect');
const sessionStatus = required<HTMLParagraphElement>('session-status');
const taskForm = required<HTMLFormElement>('task-form');
const taskPurpose = required<HTMLInputElement>('task-purpose');
const taskRecipient = required<HTMLInputElement>('task-recipient');
const taskFiles = required<HTMLInputElement>('task-files');
const taskSubmit = required<HTMLButtonElement>('task-submit');
const taskStatus = required<HTMLParagraphElement>('task-status');
const analyzeStart = required<HTMLButtonElement>('analyze-start');
const analyzeCancel = required<HTMLButtonElement>('analyze-cancel');

// 서버 API가 없는 동작은 어떤 경우에도 활성화하지 않는다.
// 클릭 핸들러를 붙이지 않으므로 성공 토스트나 가짜 결과가 생기지 않는다.
// 자료 분석 버튼은 analysis-view가 입력·동의 상태에 따라 직접 관리한다.
for (const id of ['generate-document', 'finalize-document', 'register-skill']) {
  required<HTMLButtonElement>(id).disabled = true;
}

const workspace = mountDisclosures(disclosureMount);

mountAnalysis(required<HTMLElement>('analysis-mount'), {
  purposeInput: required<HTMLInputElement>('purpose'),
  recipientInput: required<HTMLInputElement>('recipient'),
  analyzeButton: required<HTMLButtonElement>('analyze'),
  analyzeReason: required<HTMLElement>('analyze-reason'),
  cancelButton: required<HTMLButtonElement>('analysis-cancel'),
  results: required<HTMLElement>('analysis-results'),
});

function setBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

function errorMessage(status: number, code: string): string {
  if (status === 400) return '내용이 비어 있거나 형식이 올바르지 않습니다. 입력을 확인하세요.';
  if (status === 413) return '내용이 너무 큽니다. 길이를 줄여 다시 저장하세요.';
  if (status === 415) return '요청 형식이 거부되었습니다. 화면을 새로 고친 뒤 다시 시도하세요.';
  if (status === 502) return '서버에 연결하지 못했습니다. 실행 상태를 확인하세요.';
  if (status >= 500) return '서버가 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.';
  return code ? `요청에 실패했습니다(${code}).` : '요청에 실패했습니다.';
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body.error === 'string' ? body.error : '';
  } catch { return ''; }
}

function parseRecords(value: unknown): DocumentRecord[] | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.text !== 'string' || typeof record.createdAt !== 'string') return null;
  }
  return value as DocumentRecord[];
}

let documentsLoaded = false;
let documentsRequest: Promise<LoadResult> | null = null;

function renderDocuments(records: DocumentRecord[]): void {
  documentsRegion.replaceChildren();
  for (const record of records) {
    const article = document.createElement('article');
    const time = document.createElement('time');
    const created = new Date(record.createdAt);
    if (Number.isNaN(created.getTime())) time.textContent = record.createdAt;
    else {
      time.dateTime = record.createdAt;
      time.textContent = created.toLocaleString('ko-KR', { timeZoneName: 'short' });
    }
    const content = document.createElement('pre');
    content.textContent = record.text;
    article.append(time, content);
    documentsRegion.append(article);
  }
}

function loadDocuments(): Promise<LoadResult> {
  if (!documentsRequest) {
    documentsRequest = fetchDocuments().finally(() => { documentsRequest = null; });
  }
  return documentsRequest;
}

async function fetchDocuments(): Promise<LoadResult> {
  setBusy(refreshButton, true);
  documentsStatus.textContent = '저장된 문서를 조회하는 중입니다…';
  const staleNote = documentsLoaded ? ' 아래 목록은 이전 조회 결과입니다.' : '';
  try {
    const response = await fetch('/api/documents');
    if (!response.ok) {
      const code = await readErrorCode(response);
      documentsStatus.textContent = documentsLoaded
        ? `목록 갱신에 실패했습니다(${errorMessage(response.status, code)})${staleNote}`
        : `문서 목록을 조회하지 못했습니다. ${errorMessage(response.status, code)}`;
      return 'failed';
    }
    const result = await response.json() as { documents?: unknown };
    const records = parseRecords(result.documents);
    if (!records) {
      documentsStatus.textContent = `목록 응답 형식이 올바르지 않아 표시하지 않았습니다.${staleNote}`;
      return 'failed';
    }
    renderDocuments(records);
    documentsLoaded = true;
    documentsStatus.textContent = records.length
      ? `저장된 문서 ${records.length}건을 표시했습니다.`
      : '저장된 내부 텍스트가 없습니다.';
    return 'ok';
  } catch {
    documentsStatus.textContent = documentsLoaded
      ? `목록 갱신에 실패했습니다.${staleNote}`
      : '문서 목록을 조회하지 못했습니다. 서버에 연결할 수 없습니다.';
    return 'failed';
  } finally {
    setBusy(refreshButton, false);
  }
}

let saving = false;

saveForm.addEventListener('submit', (event: SubmitEvent) => {
  event.preventDefault();
  if (saving) return;
  const submitted = textArea.value;
  if (!submitted.trim()) {
    saveStatus.textContent = '저장할 텍스트가 비어 있습니다. 내부 메모로 남길 내용을 입력하세요.';
    textArea.setAttribute('aria-invalid', 'true');
    textArea.focus();
    return;
  }
  void runSave(submitted);
});

textArea.addEventListener('input', () => {
  if (textArea.getAttribute('aria-invalid') !== 'true') return;
  textArea.removeAttribute('aria-invalid');
  saveStatus.textContent = '';
});

async function runSave(submitted: string): Promise<void> {
  saving = true;
  setBusy(saveButton, true);
  saveForm.setAttribute('aria-busy', 'true');
  saveStatus.textContent = '내부 텍스트를 저장하는 중입니다…';
  try {
    const response = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: submitted }),
    });
    if (!response.ok) {
      const code = await readErrorCode(response);
      saveStatus.textContent = `저장하지 못했습니다. ${errorMessage(response.status, code)} 입력한 내용은 그대로 남아 있습니다.`;
      return;
    }
    // 요청 중에 사용자가 새로 쓴 내용은 지우지 않는다.
    if (textArea.value === submitted) {
      textArea.value = '';
      textArea.removeAttribute('aria-invalid');
    }
    saveStatus.textContent = '내부 텍스트를 저장했습니다. 목록을 다시 조회합니다…';
    // 저장 전에 시작한 조회를 마친 뒤, 저장 이후 목록을 새로 요청한다.
    if (documentsRequest) await documentsRequest;
    const loaded = await loadDocuments();
    saveStatus.textContent = loaded === 'ok'
      ? '내부 텍스트를 저장했습니다. 저장 목록을 갱신했습니다.'
      : '내부 텍스트 저장은 완료되었습니다. 다만 저장 목록 갱신에 실패했습니다(저장 실패 아님).';
  } catch {
    saveStatus.textContent = '저장하지 못했습니다. 서버에 연결할 수 없습니다. 입력한 내용은 그대로 남아 있습니다.';
  } finally {
    saving = false;
    setBusy(saveButton, false);
    saveForm.removeAttribute('aria-busy');
  }
}

refreshButton.addEventListener('click', () => {
  void loadDocuments();
});

function showRuntimeUnknown(reason: string): void {
  modeLabel.textContent = '확인 불가 — 실제/개발용 여부 표시 안 함';
  connectionLabel.textContent = '연결 확인 불가';
  runtimeStatus.textContent = `실행 환경을 확인하지 못했습니다. ${reason} 실제 모델인지 개발용 예시인지 추정해 표시하지 않습니다.`;
}

let runtimeBusy = false;

async function checkRuntime(): Promise<void> {
  if (runtimeBusy) return;
  runtimeBusy = true;
  setBusy(runtimeRefresh, true);
  runtimeStatus.textContent = '실행 환경을 확인하는 중입니다…';
  try {
    const response = await fetch('/api/core');
    if (!response.ok) {
      showRuntimeUnknown(errorMessage(response.status, await readErrorCode(response)));
      return;
    }
    const info = await response.json() as Record<string, unknown>;
    if (info.implementation === 'real') {
      modeLabel.textContent = '실제 모델';
    } else if (info.implementation === 'fake') {
      modeLabel.textContent = '개발용 예시 응답 — 실제 모델 실행 아님';
    } else {
      showRuntimeUnknown('응답의 실행 구현 값이 real 또는 fake가 아닙니다.');
      return;
    }
    if (info.connection === 'direct') connectionLabel.textContent = '직접 연결';
    else if (info.connection === 'simulated') connectionLabel.textContent = '시뮬레이션 연결';
    else connectionLabel.textContent = '연결 표기 확인 불가';

    const readyText = info.ready === true ? '준비됨' : info.ready === false ? '준비되지 않음' : '준비 상태 미표시';
    const readyNote = info.implementation === 'fake'
      ? '실제 모델은 호출하지 않습니다.'
      : '설정 상태이며 모델 호출 성공을 뜻하지 않습니다.';
    runtimeStatus.textContent = `작성 코어: ${readyText}. ${readyNote}`;
  } catch {
    showRuntimeUnknown('서버에 연결할 수 없습니다.');
  } finally {
    runtimeBusy = false;
    setBusy(runtimeRefresh, false);
  }
}

runtimeRefresh.addEventListener('click', () => { void checkRuntime(); });

void checkRuntime();
void loadDocuments();

// 로컬 접속. 세션이 열려야 공개 결정 영역의 쓰기가 열린다.
let csrfToken: string | null = null;
// 마지막으로 만든 작업과 분석 job. 작업 판본이 바뀌면 이전 job은 무효가 된다.
let currentTask: { id: string; revision: number } | null = null;
let analysisJob: { id: string; revision: number } | null = null;

function applySession(session: SessionInfo, restored: boolean): void {
  workspace.setCsrfToken(session.csrfToken);
  csrfToken = session.csrfToken;
  taskSubmit.disabled = false;
  taskStatus.textContent = '목적·수신처와 원자료를 넣고 작업을 만드세요.';
  sessionToken.value = '';
  sessionToken.removeAttribute('aria-invalid');
  const at = new Date(session.expiresAt);
  const expiry = Number.isNaN(at.getTime())
    ? '만료 시각 확인 불가'
    : at.toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const environment = session.environment;
  const providerNote = environment?.providerOrigin
    ? `분석 provider ${environment.providerOrigin}`
    : '분석 provider 주소 미표시';
  const approvalNote = environment?.approvalStatus === 'operator_confirmation_required'
    ? ' 모델 연결 승인은 운영자가 확인해야 합니다.'
    : '';
  const blocked = workspace.writeBlockReason;
  const writeNote = blocked === '' ? ' 공개 결정 쓰기가 열렸습니다.' : ` ${blocked}`;
  sessionStatus.textContent = `${restored ? '이전 세션을 확인했습니다' : '세션을 열었습니다'}. 만료 ${expiry}. ${providerNote}.${approvalNote}${writeNote}`;
}

let sessionBusy = false;

async function connectSession(): Promise<void> {
  if (sessionBusy) return;
  const submitted = sessionToken.value;
  sessionBusy = true;
  setBusy(sessionConnect, true);
  sessionForm.setAttribute('aria-busy', 'true');
  sessionStatus.textContent = '세션을 여는 중입니다…';
  try {
    const result = await openSession(fetch, submitted);
    if (!result.ok) {
      sessionStatus.textContent = sessionFailureMessage(result.failure);
      if (result.failure.kind === 'invalid_token') {
        sessionToken.setAttribute('aria-invalid', 'true');
        sessionToken.focus();
      }
      return;
    }
    applySession(result.session, false);
  } finally {
    sessionBusy = false;
    setBusy(sessionConnect, false);
    sessionForm.removeAttribute('aria-busy');
  }
}

sessionForm.addEventListener('submit', (event: SubmitEvent) => {
  event.preventDefault();
  void connectSession();
});

sessionToken.addEventListener('input', () => {
  if (sessionToken.getAttribute('aria-invalid') !== 'true') return;
  sessionToken.removeAttribute('aria-invalid');
  sessionStatus.textContent = '';
});

async function restoreLocalSession(): Promise<void> {
  const result = await restoreSession(fetch);
  if (result.ok) {
    applySession(result.session, true);
    return;
  }
  sessionStatus.textContent = result.failure.kind === 'no_session'
    ? '아직 세션이 없습니다. 운영자 토큰을 입력해 세션을 시작하세요.'
    : sessionFailureMessage(result.failure);
}

void restoreLocalSession();

// 작업 만들기. 세션의 CSRF 토큰이 있어야 하며, 만든 작업은 공개 결정 영역이 바로 조회한다.
let taskBusy = false;

function rejectTaskField(input: HTMLInputElement, message: string): void {
  taskStatus.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

async function runTaskCreate(): Promise<void> {
  if (taskBusy) return;
  const token = csrfToken;
  if (!token) {
    taskStatus.textContent = '세션을 먼저 여세요. 작업 생성과 원자료 등록은 인증된 세션에서만 됩니다.';
    return;
  }
  const purpose = taskPurpose.value.trim();
  const recipient = taskRecipient.value.trim();
  if (purpose === '') {
    rejectTaskField(taskPurpose, '전달 목적을 입력하세요.');
    return;
  }
  if (recipient === '') {
    rejectTaskField(taskRecipient, '수신처를 입력하세요.');
    return;
  }
  const files = Array.from(taskFiles.files ?? []);
  taskBusy = true;
  setBusy(taskSubmit, true);
  taskForm.setAttribute('aria-busy', 'true');
  taskStatus.textContent = '원자료를 읽는 중입니다…';
  try {
    let sources: WireSource[];
    try {
      sources = await toWireSources(files, crypto.subtle);
    } catch (error) {
      taskStatus.textContent = error instanceof Error ? error.message : '원자료를 읽지 못했습니다.';
      return;
    }
    taskStatus.textContent = '작업을 만드는 중입니다…';
    const created = await createTask(fetch, token, { purpose, recipient });
    if (!created.ok) {
      taskStatus.textContent = taskFailureMessage(created.failure);
      return;
    }
    taskStatus.textContent = '원자료를 등록하는 중입니다…';
    const registered = await replaceSources(fetch, token, created.value.id, created.value.revision, sources);
    if (!registered.ok) {
      taskStatus.textContent = `작업 ${created.value.id}은(는) 만들어졌지만 원자료 등록에 실패했습니다. ${taskFailureMessage(registered.failure)}`;
      return;
    }
    taskFiles.value = '';
    currentTask = { id: registered.value.id, revision: registered.value.revision };
    analyzeStart.disabled = false;
    taskStatus.textContent = `작업 ${created.value.id}을(를) 만들고 원자료 ${sources.length}개를 판본 ${registered.value.revision}에 등록했습니다. 분석 시작을 누르면 후보를 만듭니다.`;
    await workspace.loadTask(registered.value.id);
  } finally {
    taskBusy = false;
    setBusy(taskSubmit, false);
    taskForm.removeAttribute('aria-busy');
  }
}

taskForm.addEventListener('submit', (event: SubmitEvent) => {
  event.preventDefault();
  void runTaskCreate();
});

for (const input of [taskPurpose, taskRecipient]) {
  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') !== 'true') return;
    input.removeAttribute('aria-invalid');
    taskStatus.textContent = '';
  });
}

// 분석 job. 시작한 뒤 상태를 폴링하고, 끝나면 작업을 다시 조회해 후보를 표시한다.
let analysisBusy = false;

const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

async function runAnalysis(): Promise<void> {
  const task = currentTask;
  const token = csrfToken;
  if (analysisBusy || !task || !token) return;
  analysisBusy = true;
  setBusy(analyzeStart, true);
  analyzeCancel.hidden = false;
  setBusy(analyzeCancel, false);
  try {
    taskStatus.textContent = '분석 job을 시작하는 중입니다…';
    const started = await startAnalysis(fetch, token, task.id, task.revision);
    if (!started.ok) {
      taskStatus.textContent = taskFailureMessage(started.failure);
      return;
    }
    analysisJob = { id: started.value.id, revision: started.value.revision };
    currentTask = { id: task.id, revision: started.value.revision };
    taskStatus.textContent = '분석 job이 실행 중입니다…';
    const waitStart = Date.now();
    for (;;) {
      await sleep(800);
      const polled = await readAnalysisJob(fetch, token, task.id, started.value.id);
      if (!polled.ok) {
        taskStatus.textContent = taskFailureMessage(polled.failure);
        return;
      }
      const job = polled.value;
      const seconds = Math.round((Date.now() - waitStart) / 1000);
      if (job.status === 'running') {
        if (seconds > 180) {
          taskStatus.textContent = '3분이 지났지만 분석이 끝나지 않았습니다. 분석 취소를 누르거나 상태를 다시 확인하세요.';
          return;
        }
        taskStatus.textContent = `분석 job이 실행 중입니다… ${seconds}초`;
        continue;
      }
      analysisJob = null;
      if (job.status === 'succeeded') {
        taskStatus.textContent = '분석이 끝났습니다. 공개 결정 영역에서 후보를 확인하세요.';
        currentTask = { id: task.id, revision: job.revision };
        await workspace.loadTask(task.id);
        return;
      }
      taskStatus.textContent = job.status === 'failed'
        ? `분석이 실패했습니다.${job.errorCode === null ? '' : ` (${job.errorCode})`} 원자료와 분석 모델 설정을 확인하세요.`
        : job.status === 'cancelled'
          ? '분석이 취소되었습니다. 다시 시작할 수 있습니다.'
          : '원자료가 바뀌어 분석 결과가 무효가 되었습니다. 원자료를 다시 등록한 뒤 시작하세요.';
      return;
    }
  } finally {
    analysisBusy = false;
    analyzeCancel.hidden = true;
    setBusy(analyzeStart, false);
  }
}

async function cancelJob(): Promise<void> {
  const task = currentTask;
  const job = analysisJob;
  const token = csrfToken;
  if (!task || !job || !token) return;
  setBusy(analyzeCancel, true);
  const result = await cancelAnalysis(fetch, token, task.id, job.id, job.revision);
  analyzeCancel.hidden = true;
  taskStatus.textContent = result.ok
    ? result.value.cancelled ? '분석 취소를 요청했습니다. 실행이 멈추면 상태가 취소로 바뀝니다.' : '이미 끝난 분석이라 취소되지 않았습니다.'
    : taskFailureMessage(result.failure);
}

analyzeStart.addEventListener('click', () => { void runAnalysis(); });
analyzeCancel.addEventListener('click', () => { void cancelJob(); });
