// 작업 만들기 구역. 서버 카탈로그의 실제 선택지만 쓰고, 원자료 등록/추가/교체/해제와
// 수동 후보, 분석 동의·시작·재확인·취소를 한 작업 판본(snapshot)에 맞춰 진행한다.

import { useEffect, useRef } from 'react';
import type { ChangeEvent, FormEvent, JSX } from 'react';
import type { SessionInfo } from '../session-client.ts';
import { CANDIDATE_KINDS, CANDIDATE_RELEVANCES, CANDIDATE_UNCERTAINTIES } from '../task-client.ts';
import type { CatalogOption } from '../task-client.ts';
import type { TaskFlowApi } from './hooks/useTaskFlow.ts';

const KIND_LABELS: Record<string, string> = {
  observation: '관찰',
  constraint: '제약',
  hypothesis: '가설',
  unknown: '모르는 점',
  identifier: '식별자',
};

const UNCERTAINTY_LABELS: Record<string, string> = {
  observed: '관찰됨',
  reported: '전달받음',
  inferred: '추론함',
  unknown: '알 수 없음',
};

const RELEVANCE_LABELS: Record<string, string> = {
  required: '필수',
  optional: '선택',
};

const GOAL_LABELS: Record<string, string> = {
  default: '기본',
  observations_only: '관찰만',
  ask_for_diagnostics: '진단 정보 요청',
  reproduction_evidence: '재현 근거',
};

const LANGUAGE_LABELS: Record<string, string> = {
  ko: '한국어',
  en: '영어',
};

const AUDIENCE_LABELS: Record<string, string> = {
  public: '공개',
  named_external: '지정 외부 수신자',
};

const JOB_LABELS: Record<string, string> = {
  running: '실행 중',
  cancel_requested: '취소 요청 접수',
  succeeded: '완료',
  failed: '실패',
  cancelled: '취소됨',
  stale: '무효',
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '크기 정보 없음';
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 102.4) / 10} KiB`;
}

function templateNote(templates: readonly CatalogOption[]): string {
  if (templates.length === 0) return '서버 카탈로그에 양식이 없습니다. 양식 값 없이 진행합니다.';
  const list = templates.map((template) => `${template.displayName}(${template.id})`).join(', ');
  if (templates.length === 1) return `양식: ${list}. 서버가 지원하는 양식은 이 하나이며, 양식 값은 intake에 없는 필드라 전송하지 않습니다.`;
  return `서버 카탈로그 양식: ${list}. 현재 intake에는 양식 선택 필드가 없어 어느 값도 전송하지 않습니다.`;
}

/** 환경 값은 표시만 한다. 주소나 승인 문자열을 연결·승인 성공으로 해석하지 않는다. */
function environmentLines(environment: SessionInfo['environment'] | undefined): string[] {
  if (!environment) {
    return ['분석 환경 정보를 받지 못했습니다. 화면에서 승인 여부를 확인할 수 없습니다.'];
  }
  const origin = environment.providerOrigin === null ? '서버가 알리지 않음' : environment.providerOrigin;
  const approval = environment.approvalStatus === '' ? '값 없음' : environment.approvalStatus;
  const approved = environment.approvalStatus === 'operator_confirmation_required'
    ? '운영자가 직접 확인해야 합니다.'
    : '이 값을 승인으로 해석하지 않습니다.';
  const verified = environment.verifiedAt === null ? '없음' : environment.verifiedAt;
  return [
    `분석 provider origin: ${origin}`,
    '주소 표시는 승인·연결 성공의 증거가 아닙니다.',
    `승인 상태: ${approval} — ${approved}`,
    `확인 시각: ${verified} — 확인 시각은 승인 증거가 아닙니다.`,
  ];
}

export function TaskSection(props: {
  task: TaskFlowApi;
  csrfToken: string | null;
  environment?: SessionInfo['environment'];
}): JSX.Element {
  const { task, csrfToken, environment } = props;

  const titleRef = useRef<HTMLInputElement | null>(null);
  const projectRef = useRef<HTMLSelectElement | null>(null);
  const purposeRef = useRef<HTMLSelectElement | null>(null);
  const recipientRef = useRef<HTMLSelectElement | null>(null);
  const audienceRef = useRef<HTMLSelectElement | null>(null);
  const filesRef = useRef<HTMLInputElement | null>(null);
  const addFilesRef = useRef<HTMLInputElement | null>(null);
  const legacyPurposeRef = useRef<HTMLInputElement | null>(null);
  const legacyRecipientRef = useRef<HTMLInputElement | null>(null);

  const kindRef = useRef<HTMLSelectElement | null>(null);
  const uncertaintyRef = useRef<HTMLSelectElement | null>(null);
  const statementRef = useRef<HTMLTextAreaElement | null>(null);
  const relevanceRef = useRef<HTMLSelectElement | null>(null);
  const purposeRelevanceRef = useRef<HTMLInputElement | null>(null);
  const userNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const evidenceBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const field = task.invalidField;
    if (field === 'internalTitle') titleRef.current?.focus();
    else if (field === 'projectId') projectRef.current?.focus();
    else if (field === 'purposeId') purposeRef.current?.focus();
    else if (field === 'recipientId') recipientRef.current?.focus();
    else if (field === 'audience') audienceRef.current?.focus();
    else if (field === 'files') filesRef.current?.focus();
    else if (field === 'legacyPurpose') legacyPurposeRef.current?.focus();
    else if (field === 'legacyRecipient') legacyRecipientRef.current?.focus();
  }, [task.invalidField]);

  useEffect(() => {
    const field = task.manualInvalid;
    if (field === 'kind') kindRef.current?.focus();
    else if (field === 'uncertainty') uncertaintyRef.current?.focus();
    else if (field === 'statement') statementRef.current?.focus();
    else if (field === 'relevance') relevanceRef.current?.focus();
    else if (field === 'purposeRelevance') purposeRelevanceRef.current?.focus();
    else if (field === 'userNote') userNoteRef.current?.focus();
    else if (field === 'evidenceIds') evidenceBoxRef.current?.focus();
  }, [task.manualInvalid]);

  // 작업을 만들거나 교체한 뒤에는 선택한 파일 입력을 비운다.
  useEffect(() => {
    if (task.clearFilesSignal === 0) return;
    if (filesRef.current) filesRef.current.value = '';
  }, [task.clearFilesSignal]);

  useEffect(() => {
    if (task.clearAddSignal === 0) return;
    if (addFilesRef.current) addFilesRef.current.value = '';
  }, [task.clearAddSignal]);

  const catalog = task.catalog;
  const job = task.job;
  const showIntake = catalog !== null && !task.catalogNeedsSetup;
  const showLegacy = task.catalogNeedsSetup && task.form.useLegacy;
  const canSubmit = csrfToken !== null && !task.busy;
  const cacheIncomplete = task.addFiles.length > 0
    && task.sources.some((source) => source.included)
    && !task.canAddSources;

  return (
    <section className="session" id="task-create" aria-labelledby="task-create-heading">
      <h2 id="task-create-heading">작업 만들기</h2>
      <p className="hint" id="task-create-hint">
        서버 카탈로그의 프로젝트·목적·수신처로 작업을 만들고 원자료를 등록합니다.
        형식은 txt·log·md·csv·json(UTF-8){catalog?.limits ? `, 파일당 ${formatBytes(catalog.limits.sourceBytes)}, 합계 ${formatBytes(catalog.limits.sourceTotalBytes)}, ${catalog.limits.sources}개` : ', 파일당 256 KiB, 합계 1 MiB'}까지입니다.
      </p>

      {task.catalogBusy && <p className="hint">서버 카탈로그를 읽는 중입니다…</p>}
      {task.catalogProblem !== '' && (
        <div className="hint">
          <p role="status">{task.catalogProblem}</p>
          <button className="button" type="button" onClick={() => { task.reloadCatalog(); }}>카탈로그 다시 읽기</button>
        </div>
      )}
      {task.catalogNeedsSetup && (
        <div className="hint">
          <p>
            카탈로그에 프로젝트·수신처·목적이 모두 설정되지 않았습니다. 운영자가 서버 카탈로그를 설정해야 하며
            화면은 임의 기본값을 만들지 않습니다. 아래 파일 선택은 선택 작업의 원자료 교체에만 쓸 수 있습니다.
          </p>
          <div className="option option--consent">
            <input
              type="checkbox"
              id="task-legacy-mode"
              checked={task.form.useLegacy}
              onChange={(event): void => { task.setUseLegacy(event.currentTarget.checked); }}
            />
            <label htmlFor="task-legacy-mode">기존 목적·수신처 방식으로 작업 만들기</label>
          </div>
          <p id="task-legacy-note">
            기존 방식은 서버에 intake와 규칙 범위를 저장하지 않습니다. 이 작업으로는 재사용 규칙 저장이 지원되지 않으며,
            목적·수신처는 해시된 범위로만 남습니다.
          </p>
        </div>
      )}

      <form
        className="form"
        id="task-form"
        noValidate
        aria-busy={task.busy ? 'true' : undefined}
        onSubmit={(event: FormEvent<HTMLFormElement>): void => {
          event.preventDefault();
          task.create();
        }}
      >
        {showIntake && (
          <>
            <div className="field">
              <label htmlFor="task-title">작업 제목</label>
              <input
                id="task-title"
                name="internalTitle"
                type="text"
                autoComplete="off"
                maxLength={256}
                required
                aria-required="true"
                ref={titleRef}
                value={task.form.internalTitle}
                aria-invalid={task.invalidField === 'internalTitle' ? 'true' : undefined}
                aria-describedby="task-create-hint task-status"
                onChange={(event): void => { task.setField('internalTitle', event.currentTarget.value); }}
              />
            </div>
            <div className="field">
              <label htmlFor="task-project">프로젝트</label>
              <select
                id="task-project"
                name="projectId"
                required
                aria-required="true"
                ref={projectRef}
                value={task.form.projectId}
                aria-invalid={task.invalidField === 'projectId' ? 'true' : undefined}
                aria-describedby="task-create-hint task-status"
                onChange={(event): void => { task.setField('projectId', event.currentTarget.value); }}
              >
                <option value="">프로젝트를 선택하세요</option>
                {catalog?.projects.map((project) => <option key={project.id} value={project.id}>{project.displayName}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-purpose">전달 목적</label>
              <select
                id="task-purpose"
                name="purposeId"
                required
                aria-required="true"
                ref={purposeRef}
                value={task.form.purposeId}
                aria-invalid={task.invalidField === 'purposeId' ? 'true' : undefined}
                aria-describedby="task-create-hint task-status"
                onChange={(event): void => { task.setField('purposeId', event.currentTarget.value); }}
              >
                <option value="">전달 목적을 선택하세요</option>
                {catalog?.purposes.map((purpose) => <option key={purpose.id} value={purpose.id}>{purpose.displayName}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-recipient">수신처</label>
              <select
                id="task-recipient"
                name="recipientId"
                required
                aria-required="true"
                ref={recipientRef}
                value={task.form.recipientId}
                aria-invalid={task.invalidField === 'recipientId' ? 'true' : undefined}
                aria-describedby="task-create-hint task-status"
                onChange={(event): void => { task.setField('recipientId', event.currentTarget.value); }}
              >
                <option value="">수신처를 선택하세요</option>
                {catalog?.recipients.map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.displayName}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-audience">공개 범위</label>
              <select
                id="task-audience"
                name="audience"
                required
                aria-required="true"
                ref={audienceRef}
                value={task.form.audience}
                aria-invalid={task.invalidField === 'audience' ? 'true' : undefined}
                aria-describedby="task-create-hint task-status"
                onChange={(event): void => { task.setField('audience', event.currentTarget.value); }}
              >
                <option value="">공개 범위를 선택하세요</option>
                <option value="public">공개</option>
                <option value="named_external">지정 외부 수신자</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-goal">목표 변형 (선택)</label>
              <select
                id="task-goal"
                name="goalVariant"
                value={task.form.goalVariant}
                aria-describedby="task-create-hint task-status"
                onChange={(event): void => { task.setField('goalVariant', event.currentTarget.value); }}
              >
                <option value="">선택 안 함</option>
                {catalog?.goals.map((goal) => <option key={goal} value={goal}>{GOAL_LABELS[goal] ?? goal}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-language">출력 언어 (선택)</label>
              <select
                id="task-language"
                name="outputLanguage"
                value={task.form.outputLanguage}
                aria-describedby="task-create-hint task-status"
                onChange={(event): void => { task.setField('outputLanguage', event.currentTarget.value); }}
              >
                <option value="">선택 안 함</option>
                <option value="ko">{LANGUAGE_LABELS.ko}</option>
                <option value="en">{LANGUAGE_LABELS.en}</option>
              </select>
            </div>
            <p className="hint" id="task-template-note">{catalog ? templateNote(catalog.templates) : ''}</p>
          </>
        )}
        {showLegacy && (
          <>
            <div className="field">
              <label htmlFor="task-legacy-purpose">전달 목적 (기존 방식)</label>
              <input
                id="task-legacy-purpose"
                name="legacyPurpose"
                type="text"
                autoComplete="off"
                required
                aria-required="true"
                ref={legacyPurposeRef}
                value={task.form.legacyPurpose}
                aria-invalid={task.invalidField === 'legacyPurpose' ? 'true' : undefined}
                aria-describedby="task-legacy-note task-status"
                onChange={(event): void => { task.setField('legacyPurpose', event.currentTarget.value); }}
              />
            </div>
            <div className="field">
              <label htmlFor="task-legacy-recipient">수신처 (기존 방식)</label>
              <input
                id="task-legacy-recipient"
                name="legacyRecipient"
                type="text"
                autoComplete="off"
                required
                aria-required="true"
                ref={legacyRecipientRef}
                value={task.form.legacyRecipient}
                aria-invalid={task.invalidField === 'legacyRecipient' ? 'true' : undefined}
                aria-describedby="task-legacy-note task-status"
                onChange={(event): void => { task.setField('legacyRecipient', event.currentTarget.value); }}
              />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="task-files">원자료 파일</label>
          <input
            id="task-files"
            name="files"
            type="file"
            multiple
            accept=".txt,.log,.md,.csv,.json"
            ref={filesRef}
            aria-invalid={task.invalidField === 'files' ? 'true' : undefined}
            aria-describedby="task-create-hint task-files-note task-status"
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              task.setFiles(Array.from(event.currentTarget.files ?? []));
            }}
          />
          <p className="hint" id="task-files-note">
            새 작업은 이 파일들로 첫 원자료 판본을 만듭니다. 선택 작업이 있으면 아래의 원자료 교체에도 같은 선택을 씁니다.
            {task.files.length > 0 ? ` 선택 ${task.files.length}개: ${task.files.map((file) => file.name).join(', ')}` : ''}
          </p>
        </div>
        <button
          className="button button--solid"
          id="task-submit"
          type="submit"
          disabled={!canSubmit}
          aria-busy={task.busy ? 'true' : undefined}
          aria-describedby="task-create-hint task-status"
        >작업 만들기</button>
      </form>

      <h3>원자료</h3>
      {task.selected === null
        ? <p className="hint">작업을 만들거나 작업 목록에서 선택하면 서버에 저장된 원자료를 보여줍니다.</p>
        : (
          <>
            <p className="hint" id="task-selected-info">
              {`선택 작업 ${task.selected.id} · 판본 ${task.selected.revision}`}
              {task.taskPhase === null ? '' : ` · 단계 ${task.taskPhase}`}
            </p>
            {task.sourcesBusy ? <p className="hint">원자료 목록을 읽는 중입니다…</p> : null}
            {!task.sourcesBusy && task.sources.length === 0
              ? <p className="hint">서버에 등록된 원자료가 없습니다. 위에서 파일을 골라 교체하거나 아래에서 추가하세요.</p>
              : (
                <ul className="plain-list">
                  {task.sources.map((source) => (
                    <li key={source.id}>
                      {`${source.displayName} · ${source.format.toUpperCase()} · ${formatBytes(source.byteSize)} · v${source.version}`}
                      {' '}
                      {source.included
                        ? (
                          <button
                            className="button"
                            type="button"
                            disabled={task.removingSourceId !== null || task.busy}
                            aria-label={`원자료 ${source.displayName} 해제`}
                            onClick={() => { task.removeSource(source.sourceId); }}
                          >{task.removingSourceId === source.sourceId ? '해제 중…' : '해제'}</button>
                        )
                        : <span> (해제됨)</span>}
                    </li>
                  ))}
                </ul>
              )}
            <button
              className="button"
              type="button"
              disabled={task.replaceBusy || task.files.length === 0 || task.busy}
              aria-describedby="task-files-note task-status"
              onClick={() => { task.replaceSelectedSources(); }}
            >{task.replaceBusy ? '교체 중…' : '위에서 고른 파일로 원자료 교체'}</button>
            <div className="field">
              <label htmlFor="task-add-files">추가할 원자료 파일</label>
              <input
                id="task-add-files"
                type="file"
                multiple
                accept=".txt,.log,.md,.csv,.json"
                ref={addFilesRef}
                aria-describedby="task-add-note task-status"
                onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                  task.setAddFiles(Array.from(event.currentTarget.files ?? []));
                }}
              />
              <p className="hint" id="task-add-note">
                추가는 기존 원자료를 그대로 둔 채 새 파일을 덧붙입니다. 서버가 원자료 원문을 다시 내려주지 않으므로
                이 브라우저에서 올린 파일 내용이 남아 있을 때만 추가할 수 있습니다. 내용이 없으면 위 파일 선택으로 전체를 교체하세요.
                {cacheIncomplete ? ' 지금은 기존 원자료 내용이 없어 추가할 수 없습니다.' : ''}
              </p>
            </div>
            <button
              className="button"
              type="button"
              disabled={!task.canAddSources || task.removingSourceId !== null}
              aria-describedby="task-add-note task-status"
              onClick={() => { task.addSources(); }}
            >{task.removingSourceId === 'add' ? '추가 중…' : '원자료 추가'}</button>
          </>
        )}

      <h3>수동 후보</h3>
      {task.selected === null
        ? <p className="hint">작업을 선택하면 근거를 골라 수동 후보를 추가할 수 있습니다.</p>
        : (
          <div className="form" role="group" aria-labelledby="task-manual-heading">
            <p className="hint" id="task-manual-heading">
              수동 후보는 서버의 candidate 스키마 그대로 전송합니다. 근거를 고르거나 직접 메모 중 하나만 보냅니다.
            </p>
            <div className="field">
              <label htmlFor="task-manual-kind">후보 종류</label>
              <select
                id="task-manual-kind"
                ref={kindRef}
                required
                aria-required="true"
                value={task.manual.kind}
                aria-invalid={task.manualInvalid === 'kind' ? 'true' : undefined}
                aria-describedby="task-manual-heading task-status"
                onChange={(event): void => { task.setManualField('kind', event.currentTarget.value); }}
              >
                <option value="">후보 종류를 선택하세요</option>
                {CANDIDATE_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-manual-uncertainty">확실성</label>
              <select
                id="task-manual-uncertainty"
                ref={uncertaintyRef}
                required
                aria-required="true"
                value={task.manual.uncertainty}
                aria-invalid={task.manualInvalid === 'uncertainty' ? 'true' : undefined}
                aria-describedby="task-manual-heading task-status"
                onChange={(event): void => { task.setManualField('uncertainty', event.currentTarget.value); }}
              >
                <option value="">확실성을 선택하세요</option>
                {CANDIDATE_UNCERTAINTIES.map((value) => <option key={value} value={value}>{UNCERTAINTY_LABELS[value]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-manual-statement">후보 문장</label>
              <textarea
                id="task-manual-statement"
                ref={statementRef}
                required
                aria-required="true"
                maxLength={8192}
                value={task.manual.statement}
                aria-invalid={task.manualInvalid === 'statement' ? 'true' : undefined}
                aria-describedby="task-manual-heading task-status"
                onChange={(event): void => { task.setManualField('statement', event.currentTarget.value); }}
              />
            </div>
            <div className="field">
              <label htmlFor="task-manual-relevance">필수 여부</label>
              <select
                id="task-manual-relevance"
                ref={relevanceRef}
                required
                aria-required="true"
                value={task.manual.relevance}
                aria-invalid={task.manualInvalid === 'relevance' ? 'true' : undefined}
                aria-describedby="task-manual-heading task-status"
                onChange={(event): void => { task.setManualField('relevance', event.currentTarget.value); }}
              >
                <option value="">필수 여부를 선택하세요</option>
                {CANDIDATE_RELEVANCES.map((value) => <option key={value} value={value}>{RELEVANCE_LABELS[value]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-manual-purpose">목적과의 관련성</label>
              <input
                id="task-manual-purpose"
                type="text"
                maxLength={8192}
                required
                aria-required="true"
                ref={purposeRelevanceRef}
                value={task.manual.purposeRelevance}
                aria-invalid={task.manualInvalid === 'purposeRelevance' ? 'true' : undefined}
                aria-describedby="task-manual-heading task-status"
                onChange={(event): void => { task.setManualField('purposeRelevance', event.currentTarget.value); }}
              />
            </div>
            <fieldset className="field">
              <legend>근거 방식</legend>
              <div className="option option--consent">
                <input
                  type="radio"
                  id="task-manual-mode-evidence"
                  name="task-manual-mode"
                  checked={task.manualMode === 'evidence'}
                  onChange={() => { task.setManualMode('evidence'); }}
                />
                <label htmlFor="task-manual-mode-evidence">분석 근거 선택</label>
              </div>
              <div className="option option--consent">
                <input
                  type="radio"
                  id="task-manual-mode-note"
                  name="task-manual-mode"
                  checked={task.manualMode === 'note'}
                  onChange={() => { task.setManualMode('note'); }}
                />
                <label htmlFor="task-manual-mode-note">직접 메모</label>
              </div>
              {task.manualMode === 'evidence'
                ? (
                  task.evidenceOptions.length === 0
                    ? <p className="hint" id="task-manual-evidence-hint">분석을 마치면 선택할 근거가 생깁니다. 지금은 직접 메모를 고르세요.</p>
                    : (
                      <div
                        ref={evidenceBoxRef}
                        tabIndex={-1}
                        role="group"
                        aria-labelledby="task-manual-evidence-legend"
                        aria-invalid={task.manualInvalid === 'evidenceIds' ? 'true' : undefined}
                        aria-describedby="task-status"
                      >
                        <p className="hint" id="task-manual-evidence-legend">근거를 하나 이상 선택하세요.</p>
                        <ul className="plain-list">
                          {task.evidenceOptions.map((evidence) => (
                            <li key={evidence.id}>
                              <input
                                type="checkbox"
                                id={`task-evidence-${evidence.id}`}
                                checked={task.evidenceIds.includes(evidence.id)}
                                onChange={() => { task.toggleEvidence(evidence.id); }}
                              />
                              {' '}
                              <label htmlFor={`task-evidence-${evidence.id}`}>{evidence.label}</label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                )
                : (
                  <div className="field">
                    <label htmlFor="task-manual-note">직접 메모</label>
                    <textarea
                      id="task-manual-note"
                      ref={userNoteRef}
                      maxLength={8192}
                      value={task.manual.userNote}
                      aria-invalid={task.manualInvalid === 'userNote' ? 'true' : undefined}
                      aria-describedby="task-manual-heading task-status"
                      onChange={(event): void => { task.setManualField('userNote', event.currentTarget.value); }}
                    />
                    <p className="hint">직접 메모는 서버에 원자료(user_note)로 저장되며 이 자체로 외부 모델을 호출하지 않습니다.</p>
                  </div>
                )}
            </fieldset>
            <button
              className="button"
              type="button"
              disabled={task.manualBusy}
              aria-busy={task.manualBusy ? 'true' : undefined}
              aria-describedby="task-manual-heading task-status"
              onClick={() => { task.submitManual(); }}
            >{task.manualBusy ? '추가 중…' : '수동 후보 추가'}</button>
          </div>
        )}

      <h3>분석</h3>
      <div className="env" id="task-environment">
        {environmentLines(environment).map((line) => <p className="hint" key={line}>{line}</p>)}
      </div>
      <div className="option option--consent">
        <input
          type="checkbox"
          id="task-analysis-consent"
          checked={task.consent}
          aria-describedby="task-consent-note task-status"
          onChange={(event): void => { task.setConsent(event.currentTarget.checked); }}
        />
        <label htmlFor="task-analysis-consent">
          {`${environment?.providerOrigin ?? '서버가 알리지 않은 분석 환경'}으로 원자료가 전송되는 분석 실행에 동의합니다.`}
        </label>
      </div>
      <p className="hint" id="task-consent-note">
        원자료 등록·추가·교체·해제는 외부 모델을 호출하지 않습니다. 동의는 분석 시작에만 필요하며,
        파일·목적·수신처·원자료 판본이 바뀌면 자동으로 해제됩니다.
      </p>
      <div className="actions">
        <button
          className="button button--solid"
          id="analyze-start"
          type="button"
          disabled={!task.canStart}
          aria-busy={task.analysisBusy ? 'true' : undefined}
          aria-describedby="task-consent-note task-status"
          onClick={() => { task.startJob(); }}
        >분석 시작</button>
        <button
          className="button"
          id="analyze-recheck"
          type="button"
          disabled={task.selected === null || task.busy || task.analysisBusy}
          aria-describedby="task-status"
          onClick={() => { task.recheck(); }}
        >{task.busy ? '확인 중…' : '상태 재확인'}</button>
        <button
          className="button"
          id="analyze-cancel"
          type="button"
          hidden={job === null}
          disabled={task.cancelBusy}
          aria-busy={task.cancelBusy ? 'true' : undefined}
          aria-describedby="task-status"
          onClick={() => { task.cancelJob(); }}
        >{task.cancelBusy ? '취소 요청 중…' : '분석 취소'}</button>
      </div>
      {job === null ? null : (
        <p className="hint" id="task-job-state">
          {`분석 상태: ${JOB_LABELS[job.status] ?? job.status}${job.errorCode === null ? '' : ` (${job.errorCode})`}`}
        </p>
      )}
      <p className="status" id="task-status" role="status" aria-live="polite">
        {task.status !== ''
          ? task.status
          : task.selected === null
            ? '아직 고른 작업이 없습니다. 아래에서 작업을 만들거나 작업 목록에서 고르세요.'
            : '선택한 작업에 아직 실행한 명령이 없습니다. 원자료 등록·분석·수동 후보 추가 결과가 여기에 표시됩니다.'}
      </p>
    </section>
  );
}
