// SafeHandoff 파일 분석 화면.
// 실제 연결: POST /api/analysis 하나뿐이다. 이 화면은 파일 선택·목적/수신처·승인 환경 확인 동의를
// 모아 전송하고, 응답의 내부 근거와 후보 제안을 표시만 한다. 결과를 task 후보·공개 허가·공유
// 초안으로 바꾸지 않으며 서버에 저장하지 않는다. 상태·전송 경계는 analysis-state.ts가 맡는다.
//
// 표시 규칙:
// - 파일명·모델 문장·sha256·JSON 포인터 같은 외부 입력은 모두 textContent로만 넣는다.
// - 상태 갱신 때 목적·수신처 입력값, 선택한 파일, 포커스를 갈아치우지 않는다. 다시 그리는 것은
//   파일 목록·안내 문구·버튼 활성 상태·결과 본문뿐이다.
// - 실제 모델 주소나 사내·로컬 여부는 GET /api/core로 확인할 수 없다. 확인했다고 표시하지 않고
//   사용자가 운영 설정을 확인한 뒤 동의해야만 요청이 나간다.

import { AnalysisWorkspace } from './analysis-state.js';
import type {
  AnalysisCandidate,
  AnalysisConflict,
  AnalysisEvidence,
  AnalysisResult,
  AnalysisSource,
} from './analysis-state.js';

type MountOptions = {
  purposeInput: HTMLInputElement;
  recipientInput: HTMLInputElement;
  analyzeButton: HTMLButtonElement;
  analyzeReason: HTMLElement;
  cancelButton: HTMLButtonElement;
  results: HTMLElement;
};

// 서버 계약의 상한이다. 클라이언트는 이 값으로 검증을 복제하지 않고 안내 문구에만 쓴다.
const MAX_FILES = 100;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const EXCERPT_LIMIT = 600;

const KIND_LABELS: Record<string, string> = {
  observation: '관측',
  constraint: '제약',
  hypothesis: '가설',
  unknown: '미확인',
  identifier: '식별자',
};

const UNCERTAINTY_LABELS: Record<string, string> = {
  observed: '관측됨',
  reported: '전달받음',
  inferred: '추론됨',
  unknown: '확실성 미상',
};

const RELEVANCE_LABELS: Record<string, string> = {
  required: '목적상 필요(모델 추천, 확정 필수 아님)',
  optional: '목적상 선택(모델 추천)',
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function line<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  value: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = make(tag, className);
  node.textContent = value;
  return node;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '크기 미상';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}MiB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KiB`;
  return `${value}B`;
}

function orUnknown(value: string | number | undefined): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '응답에 없음';
}

function locatorText(evidence: AnalysisEvidence): string {
  const locator = evidence.locator;
  const range = `바이트 ${evidence.start}–${evidence.end}`;
  if (locator.kind === 'csv_cell') {
    return `${range} · CSV 행 ${orUnknown(locator.row)} · 열 ${orUnknown(locator.column)}`;
  }
  if (locator.kind === 'json_pointer') {
    const pointer = locator.pointer ? locator.pointer : '루트(빈 포인터)';
    return `${range} · JSON 포인터 ${pointer}`;
  }
  return range;
}

// 근거 범위는 UTF-8 바이트 오프셋이다. 원본 바이트가 이 결과에 남아 있을 때만 발췌를 만든다.
function excerptText(source: AnalysisSource | undefined, evidence: AnalysisEvidence): { text: string; truncated: boolean } | null {
  if (!source) return null;
  const { start, end } = evidence;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end < start || end > source.bytes.length) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(source.bytes.subarray(start, end));
  } catch { return null; }
  if (text.length > EXCERPT_LIMIT) return { text: `${text.slice(0, EXCERPT_LIMIT)}…`, truncated: true };
  return { text, truncated: false };
}

export function mountAnalysis(root: HTMLElement, options: MountOptions): { workspace: AnalysisWorkspace } {
  const workspace = new AnalysisWorkspace(() => { render(); });

  // -- 입력 영역 --
  const form = make('div', 'analysis');
  const fileField = make('div', 'field');
  const fileLabel = line('label', '원자료 파일');
  fileLabel.htmlFor = 'analysis-file-input';
  const fileInput = make('input');
  fileInput.type = 'file';
  fileInput.id = 'analysis-file-input';
  fileInput.name = 'analysis-file-input';
  fileInput.multiple = true;
  fileInput.accept = '.txt,.log,.md,.csv,.json';
  fileInput.setAttribute('aria-describedby', 'analysis-limit analysis-scope analysis-problem');

  const limitNote = line(
    'p',
    `지원 형식은 txt·log·md·csv·json(UTF-8)입니다. 선택은 ${MAX_FILES}개 이하, 파일당 ${formatBytes(MAX_FILE_BYTES)}, 합계 ${formatBytes(MAX_TOTAL_BYTES)}까지 보냅니다. ` +
      '크기·형식 검사를 통과해도 근거 최대 100개(텍스트의 비어 있지 않은 줄, CSV 데이터 셀 등)를 넘으면 분석이 거부됩니다.',
    'hint',
  );
  limitNote.id = 'analysis-limit';

  const scopeNote = line(
    'p',
    '파일은 분석 요청 본문으로만 쓰이고 서버에 저장되지 않습니다. 아래 내부 메모 저장과는 별개 기능입니다. 파일 선택만으로는 전송되지 않습니다.',
    'hint',
  );
  scopeNote.id = 'analysis-scope';

  fileField.append(fileLabel, fileInput, limitNote, scopeNote);

  const fileListSection = make('div', 'analysis__files');
  const fileListHeading = line('h3', '선택한 파일');
  const fileSummary = line('p', '아직 선택한 파일이 없습니다.', 'hint');
  const fileList = make('ul', 'plain-list');
  fileListSection.append(fileListHeading, fileSummary, fileList);

  const consentOption = make('div', 'option option--consent');
  const consentInput = make('input');
  consentInput.type = 'checkbox';
  consentInput.id = 'analysis-consent';
  consentInput.setAttribute('aria-describedby', 'analysis-consent-note analysis-problem');
  const consentLabel = line(
    'label',
    '운영 설정에서 이 분석에 쓰이는 모델이 승인된 사내 또는 로컬 분석 환경임을 확인한 뒤 동의합니다.',
  );
  consentLabel.htmlFor = 'analysis-consent';
  consentOption.append(consentInput, consentLabel);

  const consentNote = line(
    'p',
    '이 화면은 실제 모델 주소와 사내·로컬 여부를 확인할 수 없습니다. GET /api/core는 구현·연결·준비 상태만 알려줍니다. ' +
      '확인 없이 체크하면 승인되지 않은 환경으로 자료가 전송될 수 있습니다. 파일·목적·수신처를 바꾸면 동의가 해제됩니다.',
    'hint',
  );
  consentNote.id = 'analysis-consent-note';

  const problemNote = line('p', '', 'status analysis__problem');
  problemNote.id = 'analysis-problem';

  form.append(fileField, fileListSection, consentOption, consentNote, problemNote);
  root.replaceChildren(form);

  // -- 결과 영역 --
  const resultHead = make('div', 'analysis-results__head');
  const resultHeading = line('h2', '분석 결과 (내부)');
  resultHeading.id = 'analysis-results-heading';
  const resultScope = line(
    'p',
    '이 영역은 내부 참고용이며 저장되지 않습니다. 공개 결정·공유 초안·task 후보로 반영되지 않고 공개 허가도 아닙니다. ' +
      '후보 참조(local_key)와 근거 ID는 이 응답 안에서만 쓰는 임시 값입니다.',
    'hint',
  );
  const resultLegend = line(
    'p',
    '근거의 시작·끝 값은 원문의 UTF-8 바이트 위치이며 글자 위치가 아닙니다. CSV 행 번호는 머리글을 1행으로 세고, JSON 포인터 루트는 빈 문자열로 표시됩니다.',
    'hint',
  );
  resultHead.append(resultHeading, resultScope, resultLegend);

  const resultStatus = line('p', '', 'status');
  resultStatus.setAttribute('role', 'status');
  resultStatus.setAttribute('aria-live', 'polite');
  resultStatus.setAttribute('aria-atomic', 'true');
  const resultBody = make('div', 'analysis-results__body');

  options.results.replaceChildren(resultHead, resultStatus, resultBody);

  let renderedResult: AnalysisResult | null | undefined;
  let renderedCurrent: boolean | null = null;
  // 결과와 함께 온 메시지. 입력이 바뀌면 state는 메시지를 지우지 않으므로, 이 값과 같은 메시지는
  // 이전 결과의 설명으로 보고 '이전 입력 결과' 안내를 우선한다.
  let resultMessage: string | null = null;
  let renderedFiles = '';

  // -- 렌더 --
  function setInvalid(input: HTMLElement, invalid: boolean): void {
    if (invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function renderFileList(): void {
    const files = workspace.files;
    const total = files.reduce((sum, file) => sum + file.size, 0);
    fileSummary.textContent = files.length
      ? `${files.length}개 · 합계 ${formatBytes(total)} · 합계 한도 ${formatBytes(MAX_TOTAL_BYTES)}`
      : '아직 선택한 파일이 없습니다.';
    // 목적·수신처를 입력할 때마다 목록 DOM을 다시 만들지 않는다.
    const key = files.map(file => `${file.name}:${file.size}:${file.lastModified}`).join('\n');
    if (key === renderedFiles) return;
    renderedFiles = key;
    fileList.replaceChildren(
      ...files.map(file => line('li', `${file.name} — ${formatBytes(file.size)}`)),
    );
  }

  function renderPrerequisites(): void {
    const missing: string[] = [];
    if (workspace.files.length === 0) missing.push('파일');
    if (!workspace.purpose.trim()) missing.push('전달 목적');
    if (!workspace.recipient.trim()) missing.push('수신처');
    if (!workspace.consent) missing.push('승인 환경 확인 동의');
    const ready = missing.length === 0;

    options.analyzeButton.disabled = workspace.busy || !ready;
    options.cancelButton.disabled = !workspace.busy;
    if (workspace.busy) options.analyzeButton.setAttribute('aria-busy', 'true');
    else options.analyzeButton.removeAttribute('aria-busy');

    options.analyzeReason.textContent = workspace.busy
      ? '분석 요청을 보냈습니다. 응답이 오거나 취소할 때까지 기다립니다. 완료되면 아래 분석 결과에 표시됩니다.'
      : workspace.problem && workspace.problem.field !== 'request'
        ? workspace.problem.message
        : ready
          ? '분석을 시작하면 입력의 형식·한도를 확인합니다. 결과는 공개 허가가 아닙니다.'
          : `${missing.join(' · ')} 항목이 준비되어야 분석을 요청할 수 있습니다.`;
  }

  function statusText(): string {
    if (workspace.busy) return '분석 요청을 보냈습니다. 모델 응답을 기다리는 중입니다(취소 가능).';
    if (workspace.result && !workspace.resultIsCurrent && workspace.message === resultMessage) {
      return '이전 입력으로 받은 결과를 표시하고 있습니다. 현재 입력으로 다시 분석하면 갱신됩니다.';
    }
    if (workspace.message) return workspace.message;
    if (workspace.problem) return workspace.problem.message;
    if (workspace.result) {
      return workspace.resultIsCurrent
        ? '분석이 끝났습니다. 아래에 이번 입력의 내부 근거와 후보 제안을 표시했습니다.'
        : '이전 입력으로 받은 결과입니다. 현재 선택한 입력으로 다시 분석해야 갱신됩니다.';
    }
    return '아직 분석 결과가 없습니다. 파일·목적·수신처를 준비하고 분석을 요청하면 이 자리에 표시됩니다.';
  }

  function evidenceNode(evidence: AnalysisEvidence, sources: readonly AnalysisSource[]): HTMLElement {
    const source = sources.find(item => item.id === evidence.source_version_id);
    const article = make('article', 'analysis-evidence__item');
    const meta = line(
      'p',
      `근거 ${evidence.id} · 원본 ${source ? source.display_name : evidence.source_version_id} · ${locatorText(evidence)}` +
        ` · 원문 sha256 ${evidence.evidence_sha256.length > 12 ? `${evidence.evidence_sha256.slice(0, 12)}…` : evidence.evidence_sha256}`,
      'evidence__meta',
    );
    const excerpt = excerptText(source, evidence);
    if (excerpt && excerpt.text === '') {
      // CSV 빈 셀처럼 start === end인 근거는 정상이다. 근거 없음과 섞이지 않도록 빈 값으로 표시한다.
      article.append(meta, line('p', '발췌가 빈 값입니다(빈 셀·빈 줄). 근거 위치 자체는 위 바이트 범위 그대로입니다.', 'hint'));
    } else if (excerpt) {
      const pre = line('pre', excerpt.text, 'analysis-evidence__excerpt');
      article.append(meta, pre);
      if (excerpt.truncated) article.append(line('p', '발췌가 길어 표시용으로 줄였습니다. 근거 범위 자체는 위 바이트 위치 그대로입니다.', 'hint'));
    } else {
      article.append(meta, line('p', '원문에서 이 범위의 발췌를 표시할 수 없어 위치 정보만 표시합니다.', 'hint'));
    }
    return article;
  }

  function candidateNode(candidate: AnalysisCandidate, conflicts: readonly AnalysisConflict[]): HTMLElement {
    const article = make('article', 'analysis-candidate');
    article.append(
      line(
        'p',
        `제안 참조 ${candidate.local_key} · ${KIND_LABELS[candidate.kind] ?? candidate.kind} · ${UNCERTAINTY_LABELS[candidate.uncertainty] ?? candidate.uncertainty}`,
        'meta',
      ),
      line('p', candidate.statement, 'analysis-candidate__statement'),
      line('p', `목적 관련성: ${candidate.purpose_relevance}`, 'hint'),
      line('p', `모델 추천: ${RELEVANCE_LABELS[candidate.relevance] ?? candidate.relevance}`, 'hint'),
      line(
        'p',
        candidate.evidence_ids.length
          ? `인용 근거: ${candidate.evidence_ids.join(', ')}`
          : '인용 근거: 응답에 근거 참조가 없습니다.',
        'hint',
      ),
    );
    const related = conflicts.filter(conflict => conflict.local_keys.includes(candidate.local_key));
    for (const conflict of related) {
      const others = conflict.local_keys.filter(key => key !== candidate.local_key);
      article.append(
        line(
          'p',
          `충돌 표시: ${conflict.reason}${others.length ? ` (다른 후보 ${others.join(', ')})` : ''}`,
          'hint',
        ),
      );
    }
    return article;
  }

  function conflictNode(conflict: AnalysisConflict): HTMLElement {
    const article = make('article', 'analysis-conflict');
    article.append(
      line('p', `관련 후보: ${conflict.local_keys.join(', ')}`, 'meta'),
      line('p', conflict.reason, 'analysis-conflict__reason'),
    );
    return article;
  }

  function buildBody(result: AnalysisResult | null): HTMLElement[] {
    if (!result) {
      return [
        line(
          'p',
          '분석을 실행하면 이 자리에 내부 근거와 후보 제안이 표시됩니다. 표시된 내용은 저장되지 않고 공개 결정에도 쓰이지 않습니다.',
          'hint',
        ),
      ];
    }

    const nodes: HTMLElement[] = [];
    if (!workspace.resultIsCurrent) {
      nodes.push(
        line(
          'p',
          '이전 입력의 결과입니다. 파일·목적·수신처를 바꾸면 이전 결과는 그대로 남고, 다시 분석해야 새 결과가 나옵니다.',
          'status analysis-results__stale',
        ),
      );
    }

    const { evidence, proposals, sources, task } = result;
    nodes.push(
      line(
        'p',
        `결과 조건 — 전달 목적 “${task.purpose}” · 수신처 “${task.recipient}” · 파일 ${sources.length}개`,
        'hint',
      ),
      line(
        'p',
        `근거 ${evidence.length}개 · 후보 ${proposals.candidates.length}개 · 충돌 ${proposals.conflicts.length}건`,
        'hint',
      ),
    );

    if (evidence.length === 0 && proposals.candidates.length === 0) {
      nodes.push(
        line(
          'p',
          '분석 응답에 근거와 후보가 모두 0건입니다. 오류가 아니라 이 입력에서 제안할 내용이 없었다는 뜻입니다.',
          'status',
        ),
      );
    }

    if (evidence.length > 0) {
      nodes.push(line('h3', `내부 근거 ${evidence.length}개`), line('p', '파일 원문에서 잘라낸 위치와 발췌입니다. 내부 참고용이며 공유 대상이 아닙니다.', 'hint'));
      const list = make('div', 'analysis-evidence');
      for (const item of evidence) list.append(evidenceNode(item, sources));
      nodes.push(list);
    }

    if (proposals.candidates.length > 0) {
      nodes.push(
        line('h3', `후보 제안 ${proposals.candidates.length}개`),
        line(
          'p',
          '후보 종류·확실성·목적 관련성은 모델의 제안입니다. “목적상 필요”는 모델의 필수 추천일 뿐 확정 필수나 공개 허용이 아닙니다.',
          'hint',
        ),
      );
      const list = make('div', 'analysis-candidates');
      for (const candidate of proposals.candidates) list.append(candidateNode(candidate, proposals.conflicts));
      nodes.push(list);
    }

    if (proposals.conflicts.length > 0) {
      nodes.push(
        line('h3', `충돌 ${proposals.conflicts.length}건`),
        line('p', '후보끼리 양립하기 어렵다는 표시입니다. 어느 쪽이 맞는지는 이 화면이 정하지 않습니다.', 'hint'),
      );
      const list = make('div', 'analysis-conflicts');
      for (const conflict of proposals.conflicts) list.append(conflictNode(conflict));
      nodes.push(list);
    }

    return nodes;
  }

  function renderResults(): void {
    const result = workspace.result;
    const current = workspace.resultIsCurrent;
    let rebuild = false;
    if (result !== renderedResult) {
      renderedResult = result;
      resultMessage = result ? workspace.message : null;
      rebuild = true;
    }
    if (current !== renderedCurrent) {
      renderedCurrent = current;
      rebuild = true;
    }
    resultStatus.textContent = statusText();
    if (rebuild) resultBody.replaceChildren(...buildBody(result));
  }

  function render(): void {
    renderFileList();
    setInvalid(fileInput, workspace.problem?.field === 'files');
    setInvalid(options.purposeInput, workspace.problem?.field === 'purpose');
    setInvalid(options.recipientInput, workspace.problem?.field === 'recipient');
    setInvalid(consentInput, workspace.problem?.field === 'consent');
    consentInput.checked = workspace.consent;
    problemNote.textContent = workspace.problem ? workspace.problem.message : '';
    renderPrerequisites();
    renderResults();
  }

  // -- 이벤트 --
  fileInput.addEventListener('change', () => {
    workspace.setFiles(Array.from(fileInput.files ?? []));
  });

  const syncContext = (): void => {
    workspace.setContext(options.purposeInput.value, options.recipientInput.value);
  };
  options.purposeInput.addEventListener('input', syncContext);
  options.recipientInput.addEventListener('input', syncContext);

  consentInput.addEventListener('change', () => {
    workspace.setConsent(consentInput.checked);
  });

  options.analyzeButton.addEventListener('click', () => {
    if (workspace.busy) return;
    void workspace.run();
  });

  options.cancelButton.addEventListener('click', () => {
    if (!workspace.busy) return;
    workspace.cancel();
  });

  // 브라우저가 복원한 목적·수신처가 있으면 상태에도 반영한다. 동의는 항상 꺼진 상태로 시작한다.
  syncContext();
  render();
  // 폼 값 복원은 load 이후에 끝나는 브라우저도 있어 한 번 더 맞춘다. 값이 같으면 아무 일도 없다.
  window.addEventListener('load', syncContext);
  return { workspace };
}
