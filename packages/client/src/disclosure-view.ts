import { DisclosureWorkspace } from './disclosure-state.js';
import type {
  Candidate,
  Disposition,
  Draft,
  Evidence,
  Mode,
  Preview,
  Representation,
  SavedDecision,
  Scope,
  Snapshot,
  Source,
} from './disclosure-state.js';

import { MODE_LABELS, DISPOSITION_LABELS, KIND_LABELS, REPRESENTATION_LABELS, PURPOSE_LABELS, REUSABLE_FORBIDDEN, make, line, shortId, kindLabel, representationLabel, asRecord, readString, scopeSummary, purposeName, collapse, decodeBase64Text, interpretationText, emptyDraft, isEditable, findFocusable } from './disclosure-dom.ts';
import type { MountOptions, FocusState, DecodedText } from './disclosure-dom.ts';
import { createEvidenceRenderer } from './disclosure-evidence.ts';
let mountCounter = 0;

export function mountDisclosures(root: HTMLElement, options: MountOptions = {}): DisclosureWorkspace {
  mountCounter += 1;
  const uid = `disclosures-${mountCounter}`;
  const { buildEvidence, buildConflict } = createEvidenceRenderer();
  // 후보 ID는 임의 문자열이므로 HTML id·radio name에 그대로 쓰지 않고 화면 안에서만 쓰는 토큰으로 바꾼다.
  const candidateTokens = new Map<string, string>();

  function candidateToken(id: string): string {
    const existing = candidateTokens.get(id);
    if (existing !== undefined) return existing;
    const token = `c${candidateTokens.size + 1}`;
    candidateTokens.set(id, token);
    return token;
  }

  let workspace: DisclosureWorkspace | null = null;
  let taskId = '';
  let localLookupError = '';
  let renderScheduled = false;
  let mounted = true;
  // 상태 변경으로 버튼이 사라질 때 되돌릴 초점 key. render 직후 한 번만 쓴다.
  let focusFallbackKey: string | null = null;

  function requireWorkspace(): DisclosureWorkspace {
    if (!workspace) throw new Error('공개 결정 상태 계층이 아직 초기화되지 않았습니다.');
    return workspace;
  }

  function scheduleRender(): void {
    if (renderScheduled || !mounted) return;
    renderScheduled = true;
    queueMicrotask(() => {
      renderScheduled = false;
      if (!mounted) return;
      render();
    });
  }

  function captureFocus(): FocusState | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !root.contains(active)) return null;
    const key = active.dataset.focusKey;
    if (!key) return null;
    if (isEditable(active)) {
      return { key, node: active, start: active.selectionStart, end: active.selectionEnd };
    }
    return { key, node: null, start: null, end: null };
  }

  function captureScroll(): Map<string, number> {
    const positions = new Map<string, number>();
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-scroll-key]'))) {
      const key = node.dataset.scrollKey;
      if (key) positions.set(key, node.scrollLeft);
    }
    return positions;
  }

  function adoptFocusedEditable(next: HTMLElement, focus: FocusState | null): void {
    const node = focus?.node ?? null;
    if (!focus || !node) return;
    const target = findFocusable(next, focus.key);
    if (!target || target.tagName !== node.tagName) return;
    target.replaceWith(node);
  }

  function restoreFocus(focus: FocusState | null): void {
    const fallback = focusFallbackKey;
    focusFallbackKey = null;
    let target = focus ? findFocusable(root, focus.key) : null;
    // 제외 취소 버튼처럼 상태가 바뀌어 사라진 노드면 같은 후보의 제외 라디오로 되돌린다.
    let fromFallback = false;
    if (!target && fallback) {
      target = findFocusable(root, fallback);
      fromFallback = true;
    }
    if (!target) return;
    if (document.activeElement !== target) target.focus({ preventScroll: true });
    if (!focus || fromFallback) return;
    if (isEditable(target) && focus.start !== null) {
      const start = focus.start;
      const end = focus.end ?? start;
      try {
        target.setSelectionRange(start, end);
      } catch {
        // selectionRange를 지원하지 않는 입력 형식이면 커서 복원만 건너뛴다.
      }
    }
  }

  function restoreScroll(positions: Map<string, number>): void {
    if (positions.size === 0) return;
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-scroll-key]'))) {
      const key = node.dataset.scrollKey;
      if (!key) continue;
      const value = positions.get(key);
      if (value !== undefined) node.scrollLeft = value;
    }
  }

  function render(): void {
    if (!mounted) return;
    const active = document.activeElement;
    // 조건 입력 중에는 노드를 교체하지 않는다. 한글 조합과 커서가 끊기기 때문이다.
    // 대신 조건에 따라 즉시 달라지는 상태만 갱신한다.
    if (active instanceof HTMLTextAreaElement && active.dataset.focusKey?.startsWith('condition:')) {
      refreshLiveState();
      return;
    }
    const focus = captureFocus();
    const scroll = captureScroll();
    const next = build();
    adoptFocusedEditable(next, focus);
    root.replaceChildren(next);
    restoreScroll(scroll);
    restoreFocus(focus);
  }

  function findRole(role: string, candidateId?: string): HTMLElement | null {
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-role]'))) {
      if (node.dataset.role !== role) continue;
      if (candidateId !== undefined && node.dataset.candidateId !== candidateId) continue;
      return node;
    }
    return null;
  }

  function previewBlockReason(draft: Draft, writeReason: string): string | null {
    if (writeReason) return `쓰기 차단: ${writeReason}`;
    if (requireWorkspace().busy) return '다른 요청이 진행 중입니다. 끝난 뒤 다시 시도하세요.';
    if (!draft.representation) return '표현 방식을 먼저 고르세요.';
    if (draft.mode === 'D' && draft.interpretation !== 'supported') {
      return 'D는 조건 해석이 지원됨으로 끝나야 미리보기를 만들 수 있습니다.';
    }
    return null;
  }

  // 조건 입력 중 부분 갱신. 구조(버튼·표)는 바꾸지 않고 상태만 새로 쓴다.
  function refreshLiveState(): void {
    if (!workspace) return;
    const message = root.querySelector<HTMLElement>('[data-role="message"]');
    if (message) message.textContent = localLookupError || workspace.message;
    const snapshot = workspace.snapshot;
    if (!snapshot) return;
    for (const candidate of snapshot.candidates) {
      const draft = workspace.drafts.get(candidate.id);
      if (!draft) continue;
      const interpretation = findRole('interpretation', candidate.id);
      if (interpretation) interpretation.textContent = interpretationText(draft);
      const interpretButton = findRole('interpret', candidate.id);
      if (interpretButton instanceof HTMLButtonElement) {
        interpretButton.disabled = workspace.busy
          || Boolean(workspace.writeBlockReason)
          || !draft.condition.trim();
      }
      const refreshButton = findRole('refresh-interpretation', candidate.id);
      if (refreshButton instanceof HTMLButtonElement) {
        refreshButton.disabled = workspace.busy || Boolean(workspace.writeBlockReason);
      }
      const previewButton = findRole('preview', candidate.id);
      if (previewButton instanceof HTMLButtonElement) {
        previewButton.disabled = previewBlockReason(draft, workspace.writeBlockReason) !== null;
      }
      // 조건이 바뀌면 상태가 해석·미리보기를 폐기하므로 대응 노드도 즉시 정리한다.
      if (!draft.jobId || (draft.jobStatus !== 'queued' && draft.jobStatus !== 'running')) {
        findRole('refresh-interpretation', candidate.id)?.remove();
      }
      const representation = findRole('representation', candidate.id);
      if (representation) {
        if (draft.representation) {
          representation.textContent = `선택된 표현: ${representationLabel(draft.representation)}`;
        } else {
          representation.remove();
        }
      }
      if (!draft.preview) findRole('preview-result', candidate.id)?.remove();
      const previewReason = root.querySelector<HTMLElement>(
        `#${uid}-preview-reason-${candidateToken(candidate.id)}`,
      );
      if (previewReason) {
        const blocked = previewBlockReason(draft, workspace.writeBlockReason);
        previewReason.textContent = blocked ?? '미리보기를 요청할 수 있습니다. 요청은 결정을 저장하지 않습니다.';
      }
    }
    const apply = findRole('apply');
    if (apply instanceof HTMLButtonElement) {
      apply.disabled = workspace.batchBlockReason !== '' || workspace.busy;
    }
    const applyReason = findRole('apply-reason');
    if (applyReason) {
      applyReason.textContent = workspace.batchBlockReason || '한 배치로 모든 후보 결정을 저장할 수 있습니다.';
    }
    const writeNote = root.querySelector<HTMLElement>(`#${uid}-write-note`);
    if (writeNote) writeNote.textContent = writeNoteText(workspace.writeBlockReason);
  }

  function writeNoteText(reason: string): string {
    return reason
      ? `쓰기 차단: ${reason}`
      : '쓰기 차단 사유 없음(토큰 제공됨). 실제 API 응답을 확인한 뒤 상태를 갱신합니다.';
  }

  function build(): HTMLElement {
    const ws = requireWorkspace();
    const container = make('div', 'disclosures');
    container.append(line('h2', '공개 결정'));
    container.append(line(
      'p',
      '작업 ID로 task 집계를 조회한 뒤 후보마다 결정을 만듭니다. 미리보기와 결정은 서버가 계산·검증하며, 저장 뒤 화면은 task를 다시 조회해 표시합니다.',
      'hint',
    ));
    container.append(buildLookup(ws));
    container.append(buildMessage());
    container.append(buildWriteNote(ws.writeBlockReason));

    const snapshot = ws.snapshot;
    if (!snapshot) {
      const empty = make('div', 'disclosures__empty');
      empty.append(line('p', '아직 조회한 작업이 없습니다. 위에 작업 ID를 입력해 조회하세요.', 'status'));
      empty.append(line(
        'p',
        '조회에는 인증된 세션이 필요합니다. API 비활성·미인증·작업 부재는 서버 오류 코드로 구분합니다.',
        'hint',
      ));
      container.append(empty);
      return container;
    }

    container.append(buildSummary(snapshot, ws));
    if (snapshot.candidates.length === 0) {
      const empty = make('div', 'disclosures__empty');
      empty.append(line('p', '이 작업에는 후보가 없습니다.', 'status'));
      empty.append(line(
        'p',
        '자료 분석이 아직 실행되지 않았거나 후보가 설치되지 않았습니다. 후보는 서버만 만들 수 있고 이 화면은 빈 목록을 그대로 표시합니다.',
        'hint',
      ));
      container.append(empty);
    } else {
      const list = make('div', 'candidates');
      snapshot.candidates.forEach((candidate, index) => {
        list.append(buildCandidate(snapshot, candidate, index, ws.writeBlockReason, ws));
      });
      container.append(list);
    }
    container.append(buildBatch(snapshot, ws));
    return container;
  }

  function buildMessage(): HTMLElement {
    const message = localLookupError || (workspace ? workspace.message : '');
    const node = line('p', message, 'status');
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.dataset.role = 'message';
    return node;
  }

  function buildLookup(ws: DisclosureWorkspace): HTMLElement {
    const form = make('form', 'disclosures__lookup');
    form.noValidate = true;
    form.dataset.role = 'lookup';
    form.setAttribute('aria-busy', ws.busy ? 'true' : 'false');

    const field = make('div', 'field');
    const label = line('label', '작업 ID');
    label.htmlFor = `${uid}-task`;
    const input = make('input');
    input.id = `${uid}-task`;
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = taskId;
    input.dataset.focusKey = 'task-id';
    input.setAttribute('aria-describedby', `${uid}-task-hint`);
    if (localLookupError) input.setAttribute('aria-invalid', 'true');
    input.addEventListener('input', () => {
      taskId = input.value;
      input.removeAttribute('aria-invalid');
      localLookupError = '';
    });
    field.append(label, input);

    const submit = line('button', '작업 조회', 'button');
    submit.type = 'submit';
    submit.disabled = ws.busy;
    submit.setAttribute('aria-describedby', `${uid}-task-hint`);

    form.append(field, submit);
    const hint = line(
      'p',
      '조회는 GET /api/v1/tasks/{id}이며 쓰기 요청이 아닙니다. 응답이 오류면 아래 상태 문구에 그대로 표시합니다.',
      'hint',
    );
    hint.id = `${uid}-task-hint`;
    form.append(hint);

    form.addEventListener('submit', event => {
      event.preventDefault();
      const id = taskId.trim();
      if (!id) {
        localLookupError = '작업 ID를 입력하세요. 조회할 ID가 없으면 후보를 표시할 수 없습니다.';
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        render();
        return;
      }
      taskId = id;
      localLookupError = '';
      void ws.loadTask(id);
    });
    return form;
  }

  function buildWriteNote(reason: string): HTMLElement {
    const wrap = make('div', 'disclosures__write');
    const head = line('p', writeNoteText(reason), 'hint');
    head.id = `${uid}-write-note`;
    head.dataset.role = 'write-note';
    wrap.append(head);
    if (reason) {
      wrap.append(line(
        'p',
        '조회(GET)에도 세션이 필요합니다. 쓰기는 인증된 세션과 CSRF 토큰이 모두 있어야 서버에서 처리합니다.',
        'hint',
      ));
    }
    return wrap;
  }

  function buildSummary(snapshot: Snapshot, ws: DisclosureWorkspace): HTMLElement {
    const wrap = make('div', 'disclosures__summary');
    wrap.append(line('h3', '조회한 작업'));
    wrap.append(line(
      'p',
      `작업 ${snapshot.id} · revision ${snapshot.revision} · 후보 ${snapshot.candidates.length}개`,
      'status',
    ));
    wrap.append(line('p', `범위: ${scopeSummary(snapshot.scope)}`, 'hint'));
    const reload = line('button', '작업 다시 조회', 'button');
    reload.type = 'button';
    reload.dataset.role = 'reload';
    reload.disabled = ws.busy;
    reload.addEventListener('click', () => { void ws.loadTask(snapshot.id); });
    wrap.append(reload);
    return wrap;
  }

  function buildCandidate(
    snapshot: Snapshot,
    candidate: Candidate,
    index: number,
    writeReason: string,
    ws: DisclosureWorkspace,
  ): HTMLElement {
    const draft = ws.drafts.get(candidate.id) ?? emptyDraft();
    const fieldset = make('fieldset', 'candidate');
    fieldset.setAttribute('data-candidate-id', candidate.id);
    fieldset.append(line(
      'legend',
      `후보 ${index + 1} · ${kindLabel(candidate.kind)} · ${candidate.required ? '필수' : '선택'}`,
      'candidate__legend',
    ));
    fieldset.append(line('p', candidate.statement, 'candidate__statement'));
    fieldset.append(line('p', `후보 ID ${candidate.id}`, 'hint'));
    fieldset.append(line(
      'p',
      `불확실성: ${candidate.uncertainty || 'task 응답에 표시되지 않음'}`,
      'hint',
    ));

    // 충돌이 있으면 충돌 블록이 양쪽 후보의 근거를 모두 보여주므로 같은 목록을 두 번 그리지 않는다.
    const conflict = buildConflict(snapshot, candidate);
    if (conflict) fieldset.append(conflict);
    else fieldset.append(buildEvidence(snapshot, candidate.evidence_ids, '인용 근거'));
    fieldset.append(buildDisposition(snapshot, candidate, draft, ws));

    if (draft.disposition === 'allow') {
      fieldset.append(buildMode(candidate, draft, ws));
      if (draft.mode === 'D') fieldset.append(buildCondition(candidate, draft, writeReason, ws));
      fieldset.append(buildPreview(candidate, draft, writeReason, ws));
      fieldset.append(buildReusable(candidate, draft, ws));
    } else if (draft.disposition === 'exclude' || draft.disposition === 'defer') {
      fieldset.append(line(
        'p',
        `${DISPOSITION_LABELS[draft.disposition]} 결정에는 표현 방식이 없습니다.`,
        'hint',
      ));
    } else {
      fieldset.append(line('p', '결정을 고르면 표현 방식과 미리보기 자리가 열립니다.', 'hint'));
    }

    fieldset.append(buildSavedDecisions(snapshot, candidate, writeReason, ws));
    return fieldset;
  }

  function buildDisposition(
    snapshot: Snapshot,
    candidate: Candidate,
    draft: Draft,
    ws: DisclosureWorkspace,
  ): HTMLElement {
    const fieldset = make('fieldset', 'candidate__disposition');
    fieldset.append(line('legend', '결정'));
    fieldset.append(line(
      'p',
      '기본 상태는 허용 미선택입니다. 고르지 않은 후보는 배치에서 빠집니다.',
      'hint',
    ));
    const options: { value: Disposition | null; label: string; note: string }[] = [
      { value: null, label: '아직 결정하지 않음', note: '결정을 저장하지 않습니다.' },
      {
        value: 'allow',
        label: '허용 — 미리보기를 승인해 포함',
        note: '표현을 고르고 미리보기를 만든 뒤에만 배치에 넣을 수 있습니다.',
      },
      { value: 'exclude', label: '이번 결과에서 제외', note: '이 후보의 내용은 공유 결과에 포함하지 않습니다.' },
      { value: 'defer', label: '나중에 결정', note: '보류로 저장하고 이번 결과에는 포함하지 않습니다.' },
    ];
    const groupName = `${uid}-disposition-${candidateToken(candidate.id)}`;
    const requiredNoticeId = `${uid}-required-exclude-${candidateToken(candidate.id)}`;
    const showRequiredNotice = draft.disposition === 'exclude' && candidate.required;
    for (const option of options) {
      const key = option.value ?? 'none';
      const id = `${groupName}-${key}`;
      const row = make('div', 'option');
      const input = make('input');
      input.type = 'radio';
      input.name = groupName;
      input.id = id;
      input.value = key;
      input.checked = draft.disposition === option.value;
      input.dataset.focusKey = `disposition:${candidate.id}:${key}`;
      if (option.value === 'exclude' && showRequiredNotice) {
        input.setAttribute('aria-describedby', requiredNoticeId);
      }
      input.addEventListener('change', () => {
        if (input.checked) ws.chooseDisposition(candidate.id, option.value);
      });
      const label = line('label', `${option.label} — ${option.note}`);
      label.htmlFor = id;
      row.append(input, label);
      fieldset.append(row);
    }
    if (showRequiredNotice) {
      fieldset.append(buildRequiredExclude(snapshot, candidate, requiredNoticeId, ws));
    }
    return fieldset;
  }

  // 필수 후보 제외는 목적·빠지는 정보·기존 동의 제약을 명시하고, 서버가 주지 않은 선정 사유를 채우지 않는다.
  function buildRequiredExclude(
    snapshot: Snapshot,
    candidate: Candidate,
    noticeId: string,
    ws: DisclosureWorkspace,
  ): HTMLElement {
    const wrap = make('div', 'required-exclude');
    wrap.id = noticeId;
    wrap.dataset.role = 'required-exclude';
    wrap.dataset.candidateId = candidate.id;
    const purpose = purposeName(snapshot.scope);
    const target = purpose
      ? `현재 작업 목적 ${purpose}의 공유 결과와 근거에서`
      : 'task 응답에 목적이 없어 목적을 표시할 수 없지만, 이번 공유 결과와 근거에서';
    wrap.append(line(
      'p',
      `필수 후보를 이번 결과에서 제외합니다. ${target} 다음 정보가 빠집니다: “${candidate.statement}”`,
      'status',
    ));
    wrap.append(line(
      'p',
      '이 정보가 필수로 분류된 구체적인 이유는 제공되지 않았습니다. 위의 근거를 확인하고, 정보를 빼고 공유하려면 아래에서 범위 축소에 동의하세요.',
      'hint',
    ));
    wrap.append(line(
      'p',
      '제외를 유지하면 아래 전체 적용의 범위 축소 동의로 이 결정을 그대로 저장할 수 있습니다.',
      'hint',
    ));
    const cancelHelpId = `${noticeId}-cancel-help`;
    const cancel = line('button', '제외 취소', 'button');
    cancel.type = 'button';
    cancel.dataset.role = 'exclude-cancel';
    cancel.dataset.candidateId = candidate.id;
    cancel.dataset.focusKey = `exclude-cancel:${candidate.id}`;
    cancel.setAttribute('aria-describedby', cancelHelpId);
    cancel.addEventListener('click', () => {
      // 버튼이 사라진 뒤 같은 후보의 제외 라디오로 초점을 되돌린다.
      focusFallbackKey = `disposition:${candidate.id}:exclude`;
      ws.chooseDisposition(candidate.id, null);
    });
    wrap.append(cancel);
    const cancelHelp = line(
      'p',
      '제외 취소는 이 후보를 미선택으로 되돌립니다. 미선택은 허용으로 자동 선택되지 않으며, 제외한 필수 후보 목록과 범위 축소 동의 대상에서도 빠집니다.',
      'hint',
    );
    cancelHelp.id = cancelHelpId;
    wrap.append(cancelHelp);
    return wrap;
  }

  function buildMode(candidate: Candidate, draft: Draft, ws: DisclosureWorkspace): HTMLElement {
    const fieldset = make('fieldset', 'candidate__mode');
    fieldset.append(line('legend', '표현 방식'));
    // 표현 선택 자체는 미리보기 요청이다. 결정 저장은 하지 않는다.
    const canRequest = ws.writeBlockReason === '';
    fieldset.append(line(
      'p',
      canRequest
        ? 'A·B를 고르면 서버에 미리보기를 요청합니다(결정 저장 아님). D는 조건 해석이 지원된 뒤에, C는 차단 상태라 요청하지 않습니다.'
        : 'A·B를 고르면 표현만 정해집니다. 지금은 쓰기 차단 사유가 있어 미리보기를 요청하지 않으며, D도 해석이 지원된 뒤에만 요청할 수 있습니다.',
      'hint',
    ));
    const reasons: Partial<Record<Mode, string>> = {
      C: 'C(선택 필드)는 이 화면의 서버 필드 목록·선택 연결이 아직 없어 사용할 수 없습니다.',
    };
    if (candidate.kind !== 'series') {
      reasons.B = `이 후보의 종류는 ${kindLabel(candidate.kind)}입니다. B는 series 후보에만 쓸 수 있어 차단합니다.`;
    }
    const groupName = `${uid}-mode-${candidateToken(candidate.id)}`;
    for (const mode of ['A', 'B', 'C', 'D'] as Mode[]) {
      const reason = reasons[mode];
      const id = `${groupName}-${mode}`;
      const row = make('div', 'option');
      const input = make('input');
      input.type = 'radio';
      input.name = groupName;
      input.id = id;
      input.value = mode;
      input.checked = draft.mode === mode;
      input.disabled = Boolean(reason);
      input.dataset.focusKey = `mode:${candidate.id}:${mode}`;
      if (reason) input.setAttribute('aria-describedby', `${id}-reason`);
      input.addEventListener('change', () => {
        if (!input.checked) return;
        ws.chooseMode(candidate.id, mode);
        if (mode !== 'A' && mode !== 'B') return;
        const chosen = ws.drafts.get(candidate.id);
        if (!chosen?.representation) return;
        if (ws.writeBlockReason !== '') return;
        void ws.preview(candidate.id);
      });
      const label = line('label', MODE_LABELS[mode]);
      label.htmlFor = id;
      row.append(input, label);
      fieldset.append(row);
      if (reason) {
        const note = line('p', reason, 'hint');
        note.id = `${id}-reason`;
        fieldset.append(note);
      }
    }
    if (draft.mode === 'D' && draft.interpretation !== 'supported') {
      fieldset.append(line(
        'p',
        'D는 조건 해석이 지원(supported)으로 끝나야 미리보기를 만들 수 있습니다.',
        'hint',
      ));
    }
    if (draft.representation) {
      const label = line('p', `선택된 표현: ${representationLabel(draft.representation)}`, 'meta');
      label.dataset.role = 'representation';
      label.dataset.candidateId = candidate.id;
      fieldset.append(label);
    }
    return fieldset;
  }

  function buildCondition(
    candidate: Candidate,
    draft: Draft,
    writeReason: string,
    ws: DisclosureWorkspace,
  ): HTMLElement {
    const wrap = make('div', 'custom');
    const textareaId = `${uid}-condition-${candidateToken(candidate.id)}`;
    const field = make('div', 'field');
    const label = line('label', '직접 입력 조건');
    label.htmlFor = textareaId;
    const textarea = make('textarea');
    textarea.id = textareaId;
    textarea.rows = 4;
    textarea.value = draft.condition;
    textarea.dataset.focusKey = `condition:${candidate.id}`;
    textarea.setAttribute('aria-describedby', `${textareaId}-help`);
    textarea.addEventListener('input', () => {
      ws.setCondition(candidate.id, textarea.value);
    });
    field.append(label, textarea);
    wrap.append(field);

    const help = line(
      'p',
      '조건을 바꾸면 기존 해석과 미리보기가 폐기됩니다. 이 문장은 공개 승인이 아닙니다.',
      'hint',
    );
    help.id = `${textareaId}-help`;
    wrap.append(help);

    const action = make('div', 'action');
    const interpretButton = line('button', '조건 해석 요청', 'button');
    interpretButton.type = 'button';
    interpretButton.dataset.role = 'interpret';
    interpretButton.dataset.candidateId = candidate.id;
    interpretButton.disabled = Boolean(writeReason) || ws.busy || !draft.condition.trim();
    interpretButton.setAttribute('aria-describedby', `${uid}-write-note`);
    interpretButton.addEventListener('click', () => { void ws.interpret(candidate.id); });
    action.append(interpretButton);

    if (draft.jobId && (draft.jobStatus === 'queued' || draft.jobStatus === 'running')) {
      const lookup = line('button', '해석 결과 조회', 'button');
      lookup.type = 'button';
      lookup.dataset.role = 'refresh-interpretation';
      lookup.dataset.candidateId = candidate.id;
      lookup.disabled = Boolean(writeReason) || ws.busy;
      lookup.setAttribute('aria-describedby', `${uid}-write-note`);
      lookup.addEventListener('click', () => { void ws.refreshInterpretation(candidate.id); });
      action.append(lookup);
    }
    wrap.append(action);

    wrap.append(line(
      'p',
      writeReason
        ? `쓰기 차단: ${writeReason}`
        : draft.condition.trim()
          ? '해석은 job(interpret_disclosure)으로 요청하며 결과를 자동으로 반복 조회하지 않습니다.'
          : '조건을 입력하세요.',
      'hint',
    ));

    const status = line('p', interpretationText(draft), 'status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.dataset.role = 'interpretation';
    status.dataset.candidateId = candidate.id;
    wrap.append(status);

    wrap.append(line(
      'p',
      draft.jobId
        ? `해석 job ${draft.jobId} · 상태 ${draft.jobStatus ?? '미확인'}`
        : '해석 요청 기록이 없습니다.',
      'hint',
    ));
    if (draft.message) wrap.append(line('p', draft.message, 'hint'));
    return wrap;
  }

  function buildProjectionTable(preview: Preview, candidateId: string): HTMLElement | null {
    const { columns, rows } = preview.projection;
    if (!columns || !rows) return null;
    const scroll = make('div', 'preview__scroll');
    scroll.dataset.scrollKey = `preview:${candidateId}`;
    const table = make('table', 'preview__table');
    const head = make('thead');
    const headRow = make('tr');
    for (const column of columns) {
      const cell = line('th', column);
      cell.scope = 'col';
      headRow.append(cell);
    }
    head.append(headRow);
    table.append(head);

    const body = make('tbody');
    if (rows.length === 0) {
      const row = make('tr');
      const cell = line('td', '표 행이 없습니다.');
      cell.colSpan = Math.max(columns.length, 1);
      row.append(cell);
      body.append(row);
    } else {
      for (const values of rows) {
        const row = make('tr');
        for (let index = 0; index < columns.length; index += 1) {
          row.append(line('td', values[index] ?? ''));
        }
        body.append(row);
      }
    }
    table.append(body);
    scroll.append(table);
    return scroll;
  }

  function buildPreview(
    candidate: Candidate,
    draft: Draft,
    writeReason: string,
    ws: DisclosureWorkspace,
  ): HTMLElement {
    const wrap = make('div', 'candidate__preview');
    wrap.dataset.role = 'preview-block';
    wrap.dataset.candidateId = candidate.id;
    wrap.append(line('h3', '공개 미리보기'));
    wrap.append(line(
      'p',
      '미리보기는 서버가 계산한 결과입니다. 이 화면은 응답의 표와 해시를 그대로 표시하며 직접 계산하지 않습니다.',
      'hint',
    ));

    const blocked = previewBlockReason(draft, writeReason);
    const reasonId = `${uid}-preview-reason-${candidateToken(candidate.id)}`;
    const action = make('div', 'action');
    const button = line('button', '미리보기 만들기', 'button');
    button.type = 'button';
    button.dataset.role = 'preview';
    button.dataset.candidateId = candidate.id;
    button.disabled = blocked !== null;
    button.setAttribute('aria-describedby', `${uid}-write-note ${reasonId}`);
    button.addEventListener('click', () => { void ws.preview(candidate.id); });
    action.append(button);
    wrap.append(action);

    const reason = line(
      'p',
      blocked ?? '미리보기를 요청할 수 있습니다. 요청은 결정을 저장하지 않습니다.',
      'hint',
    );
    reason.id = reasonId;
    wrap.append(reason);

    const preview = draft.preview;
    if (preview) wrap.append(buildProjection(preview, ws.snapshot?.revision ?? null, candidate.id));
    return wrap;
  }

  function buildProjection(preview: Preview, revision: number | null, candidateId: string): HTMLElement {
    const wrap = make('div', 'preview');
    wrap.dataset.role = 'preview-result';
    wrap.dataset.candidateId = candidateId;
    wrap.append(line(
      'p',
      `미리보기 ${preview.preview_id} · 입력 revision ${preview.input_revision} · 표현 ${representationLabel(preview.representation)}`,
      'meta',
    ));
    if (revision !== null && preview.input_revision !== revision) {
      wrap.append(line(
        'p',
        `현재 task revision ${revision}과 달라 이 미리보기는 무효입니다. 다시 만든 뒤 적용하세요.`,
        'status',
      ));
    }
    wrap.append(line('p', preview.projection.statement, 'candidate__statement'));

    const table = buildProjectionTable(preview, candidateId);
    if (table) {
      wrap.append(table);
    } else {
      wrap.append(line('p', '응답에 표가 없어 표시할 계산값이 없습니다.', 'hint'));
    }

    const rawExcerpt = preview.projection.excerpt;
    if (rawExcerpt !== undefined) {
      const excerpt = decodeBase64Text(rawExcerpt);
      wrap.append(line(
        'p',
        excerpt.ok ? `발췌: "${collapse(excerpt.text)}"` : `발췌 표시 불가: ${excerpt.reason}`,
        excerpt.ok ? 'evidence__excerpt' : 'hint',
      ));
    }
    wrap.append(line('p', `projection_sha256(서버 반환값): ${preview.projection_sha256}`, 'hint'));
    return wrap;
  }

  function buildReusable(candidate: Candidate, draft: Draft, ws: DisclosureWorkspace): HTMLElement {
    const wrap = make('div', 'candidate__reusable');
    const kind = draft.representation?.kind ?? null;
    const forbidden = kind !== null && REUSABLE_FORBIDDEN.includes(kind);
    const id = `${uid}-reusable-${candidateToken(candidate.id)}`;

    const row = make('div', 'option');
    const input = make('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = draft.reusable && !forbidden;
    input.disabled = forbidden || !draft.representation;
    input.dataset.focusKey = `reusable:${candidate.id}`;
    input.setAttribute('aria-describedby', `${id}-help`);
    input.addEventListener('change', () => ws.setReusable(candidate.id, input.checked));
    const label = line('label', '재사용 기준으로 저장');
    label.htmlFor = id;
    row.append(input, label);
    wrap.append(row);

    const help = line(
      'p',
      forbidden
        ? '이 표현(정확한 값·승인 발췌·선택 필드)은 재사용 기준으로 저장할 수 없습니다.'
        : draft.representation
          ? '재사용 기준은 결정 배치에 함께 저장됩니다.'
          : '표현 방식을 먼저 고르세요.',
      'hint',
    );
    help.id = `${id}-help`;
    wrap.append(help);
    return wrap;
  }

  function decisionMeta(decision: SavedDecision): string {
    const parts = [
      `표현 ${representationLabel(decision.representation)}`,
      `projection_sha256 ${decision.projection_sha256}`,
      `만료 ${decision.expires_at ?? '없음'}`,
    ];
    if (decision.supersedes_id) parts.push(`대체한 결정 ${decision.supersedes_id}`);
    return parts.join(' · ');
  }

  function buildSavedDecisions(
    snapshot: Snapshot,
    candidate: Candidate,
    writeReason: string,
    ws: DisclosureWorkspace,
  ): HTMLElement {
    const wrap = make('div', 'candidate__decisions');
    const decisions = Object.values(snapshot.decisions)
      .filter(decision => decision.candidate_id === candidate.id);
    wrap.append(line('h3', `저장된 결정 (${decisions.length})`));
    if (decisions.length === 0) {
      wrap.append(line('p', '저장된 결정이 없습니다.', 'hint'));
      return wrap;
    }
    for (const decision of decisions) {
      const block = make('div', 'decision');
      block.append(line(
        'p',
        `${DISPOSITION_LABELS[decision.disposition]} · ${decision.revoked ? '철회됨' : '유효'} · 결정 ${decision.id}`,
        'status',
      ));
      block.append(line('p', decisionMeta(decision), 'hint'));

      const revoke = line('button', '결정 철회', 'button');
      revoke.type = 'button';
      revoke.dataset.role = 'revoke';
      revoke.dataset.decisionId = decision.id;
      revoke.disabled = decision.revoked || Boolean(writeReason) || ws.busy;
      revoke.setAttribute('aria-describedby', `${uid}-write-note`);
      revoke.addEventListener('click', () => { void ws.revoke(decision.id); });
      block.append(revoke);

      if (writeReason) {
        block.append(line('p', `쓰기 차단: ${writeReason}`, 'hint'));
      } else if (decision.revoked) {
        block.append(line('p', '이미 철회된 결정입니다. 과거 허용이 자동으로 되살아나지는 않습니다.', 'hint'));
      } else {
        block.append(line('p', '철회는 단일 요청이며 성공 뒤 task를 다시 조회해 확인합니다.', 'hint'));
      }
      wrap.append(block);
    }
    return wrap;
  }

  function buildBatch(snapshot: Snapshot, ws: DisclosureWorkspace): HTMLElement {
    const wrap = make('section', 'batch');
    wrap.append(line('h3', '전체 적용(결정 배치)'));

    const counts: Record<Disposition | 'none', number> = { allow: 0, exclude: 0, defer: 0, none: 0 };
    for (const candidate of snapshot.candidates) {
      const disposition = ws.drafts.get(candidate.id)?.disposition ?? null;
      if (disposition) counts[disposition] += 1;
      else counts.none += 1;
    }
    wrap.append(line(
      'p',
      `후보 ${snapshot.candidates.length}개 · 허용 ${counts.allow} · 제외 ${counts.exclude} · 보류 ${counts.defer} · 미선택 ${counts.none}`,
      'status',
    ));

    const scopeId = `${uid}-scope-reduction`;
    const scopeRow = make('div', 'option');
    const scopeInput = make('input');
    scopeInput.type = 'checkbox';
    scopeInput.id = scopeId;
    scopeInput.checked = ws.acceptScopeReduction;
    scopeInput.dataset.focusKey = 'scope-reduction';
    scopeInput.setAttribute('aria-describedby', `${scopeId}-help`);
    scopeInput.addEventListener('change', () => ws.setScopeReduction(scopeInput.checked));
    const scopeLabel = line('label', '필수 후보를 제외해 범위를 줄이는 데 동의합니다.');
    scopeLabel.htmlFor = scopeId;
    scopeRow.append(scopeInput, scopeLabel);
    wrap.append(scopeRow);

    // 동의 대상은 지금 제외한 필수 후보의 실제 ID·문장이다. 후보별 긴 안내와 달리 이 목록은 동의 대상만 보여준다.
    const excludedRequired = snapshot.candidates.filter(candidate =>
      candidate.required && ws.drafts.get(candidate.id)?.disposition === 'exclude');
    const scopeHelp = make('div', 'scope-reduction__detail');
    scopeHelp.id = `${scopeId}-help`;
    scopeHelp.dataset.role = 'scope-reduction-detail';
    const purpose = purposeName(snapshot.scope);
    scopeHelp.append(line(
      'p',
      `현재 작업 목적: ${purpose || 'task 응답에 목적 없음'}`,
      'meta',
    ));
    if (excludedRequired.length === 0) {
      scopeHelp.append(line(
        'p',
        '제외한 필수 후보가 없습니다. 이 상태에서는 범위 축소 동의가 필요하지 않습니다.',
        'hint',
      ));
    } else {
      scopeHelp.append(line(
        'p',
        `동의 대상: 이번 결과에서 제외하는 필수 후보 ${excludedRequired.length}개`,
        'hint',
      ));
      const list = make('ul', 'scope-reduction__list');
      for (const candidate of excludedRequired) {
        list.append(line('li', `후보 ID ${candidate.id} — “${candidate.statement}”`));
      }
      scopeHelp.append(list);
      scopeHelp.append(line(
        'p',
        '이 필수 후보들을 이번 공유 결과에서 빼는 결정을 저장하려면 동의가 필요합니다.',
        'hint',
      ));
    }
    wrap.append(scopeHelp);

    const blocked = ws.batchBlockReason;
    const action = make('div', 'action');
    const apply = line('button', '전체 적용', 'button button--solid');
    apply.type = 'button';
    apply.dataset.role = 'apply';
    apply.disabled = blocked !== '' || ws.busy;
    apply.setAttribute('aria-describedby', `${uid}-apply-reason`);
    apply.addEventListener('click', () => { void ws.apply(); });
    action.append(apply);
    const reason = line('p', blocked || '한 배치로 모든 후보 결정을 저장할 수 있습니다.', 'hint');
    reason.id = `${uid}-apply-reason`;
    reason.dataset.role = 'apply-reason';
    action.append(reason);
    wrap.append(action);

    wrap.append(line(
      'p',
      '결정은 한 번의 요청(최대 30개)으로 보냅니다. 하나라도 거부되면 배치 전체가 반영되지 않습니다.',
      'hint',
    ));
    const purposeRequired = purpose
      ? `현재 작업 목적 ${purpose}에 필요한 필수 후보도`
      : '현재 목적에 필요한 필수 후보도';
    const condition = ws.canGenerate
      ? `공개 초안 생성 조건: 충족 — 유효하게 저장된 공개 허용 결정이 최소 1개 있고, ${purposeRequired} 모두 유효한 허용으로 저장되어 있습니다. 초안 생성 기능은 이 화면에서 연결되지 않았습니다.`
      : `공개 초안 생성 조건: 미충족 — 저장된 공개 허용 결정이 최소 1개 있어야 하고, ${purposeRequired} 모두 유효한 허용으로 저장되어야 합니다. 아직 저장하지 않은 선택·미리보기와 제외·보류·미선택은 이 조건을 채우지 않으므로 빈 공유 문서를 완료로 보지 않습니다. 초안 생성 기능은 이 화면에서 연결되지 않았습니다.`;
    wrap.append(line('p', condition, 'hint'));

    return wrap;
  }

  const instance = new DisclosureWorkspace(scheduleRender, options);
  workspace = instance;
  render();
  return instance;
}
