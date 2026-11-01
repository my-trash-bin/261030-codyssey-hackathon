// 작업 만들기 구역. 서버 카탈로그의 실제 선택지만 쓰고, 원자료 등록/추가/교체/해제와
// 수동 후보, 분석 동의·시작·재확인·취소를 한 작업 판본(snapshot)에 맞춰 진행한다.

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import type { SessionInfo } from '../session-client.ts';
import { CANDIDATE_KINDS, CANDIDATE_RELEVANCES, CANDIDATE_UNCERTAINTIES } from '../task-client.ts';
import type { Candidate } from '../disclosure-contract.ts';
import { KIND_LABELS, UNCERTAINTY_LABELS } from '../disclosure-format.ts';
import type { CatalogOption } from '../task-client.ts';
import { FileField } from './FileField.tsx';
import { AnalysisSources } from './SourceViews.tsx';
import type { TaskFlowApi } from './hooks/useTaskFlow.ts';

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

const ANALYSIS_ERROR_LABELS: Record<string, string> = {
  MODEL_UNAVAILABLE: '모델에 연결하지 못했습니다',
  MODEL_TIMEOUT: '모델 응답 시간이 초과됐습니다',
  MODEL_INVALID_RESPONSE: '모델 응답이 형식에 맞지 않습니다',
  MODEL_BUDGET_EXCEEDED: '자료가 커서 모델 호출 한도를 넘었습니다',
};

const LANGUAGE_LABELS: Record<string, string> = {
  ko: '한국어',
  en: '영어',
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
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KiB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MiB`;
}

function templateNote(templates: readonly CatalogOption[]): string {
  if (templates.length === 0) return '';
  return `문서 양식: ${templates.map((template) => template.displayName).join(', ')}`;
}

/** 환경 값은 표시만 한다. 주소나 승인 문자열을 연결·승인 성공으로 해석하지 않는다. */
function environmentLines(environment: SessionInfo['environment'] | undefined): string[] {
  if (!environment) {
    return ['분석 환경 정보를 받지 못했습니다. 화면에서 승인 여부를 확인할 수 없습니다.'];
  }
  const approval = environment.approvalStatus === '' ? '값 없음' : environment.approvalStatus;
  const verified = environment.verifiedAt === null ? '없음' : environment.verifiedAt;
  return [
    `승인 상태 값: ${approval}. 이 값을 승인으로 해석하지 않습니다.`,
    `확인 시각: ${verified}. 확인 시각은 승인 증거가 아닙니다.`,
    '주소 표시는 연결 성공의 증거가 아닙니다.',
  ];
}

export type TaskSectionPart = 'setup' | 'sources' | 'analysis';

export function TaskSection(props: {
  task: TaskFlowApi;
  csrfToken: string | null;
  environment?: SessionInfo['environment'];
  part: TaskSectionPart;
  candidates?: readonly Candidate[];
}): JSX.Element {
  const { task, csrfToken, environment, part, candidates = [] } = props;
  // 고른 작업이 있으면 새 작업 폼은 접어 둔다. 채워진 폼이 그 작업의 수정 화면처럼 보이지 않게 한다.
  const [setupOpen, setSetupOpen] = useState(task.selected === null);
  const hasSelected = task.selected !== null;
  useEffect(() => { setSetupOpen(!hasSelected); }, [hasSelected]);

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
    <>
      {part === 'setup' && (
        <details
          className="panel fold"
          id="task-create"
          open={setupOpen}
          onToggle={(event): void => { setSetupOpen(event.currentTarget.open); }}
        >
          <summary>새 작업 만들기</summary>
          <p className="hint" id="task-create-hint">
            형식은 txt·log·md·csv·json(UTF-8)이고, 파일당 {formatBytes(catalog?.limits?.sourceBytes ?? 262144)}, 합계 {formatBytes(catalog?.limits?.sourceTotalBytes ?? 1048576)}까지입니다. 파일을 골라도 분석을 시작하기 전에는 모델로 보내지 않습니다.
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
                프로젝트·수신처 목록이 서버에 설정되지 않았습니다. 운영자가 카탈로그를 설정해야 합니다.
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
                기존 방식으로 만든 작업은 재사용 규칙을 저장할 수 없습니다.
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
                <div className="field field--wide">
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
                  <label htmlFor="task-goal">문서 목표 (선택)</label>
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
                {catalog && catalog.templates.length > 0
                  ? <p className="hint field--wide" id="task-template-note">{templateNote(catalog.templates)}</p>
                  : null}
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
            <div className="field field--wide">
              <label htmlFor="task-files">원자료 파일</label>
              <FileField
                id="task-files"
                inputRef={filesRef}
                multiple
                accept=".txt,.log,.md,.csv,.json"
                invalid={task.invalidField === 'files'}
                describedBy="task-create-hint task-status"
                selectedNames={task.files.map((file) => file.name)}
                onFiles={task.setFiles}
              />
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
        </details>
      )}

      {part === 'sources' && (
        <section className="panel" id="task-sources">
          <h3>원자료</h3>
          {task.selected === null
            ? <p className="hint">작업을 고르면 원자료를 보여 줍니다.</p>
            : (
              <>
                {task.sourcesBusy ? <p className="hint">원자료 목록을 읽는 중입니다…</p> : null}
                {!task.sourcesBusy && task.sources.length === 0
                  ? <p className="status">등록된 원자료가 없습니다. 아래 원자료 바꾸기에서 파일을 올리세요.</p>
                  : (
                    <ul className="source-list">
                      {task.sources.map((source) => (
                        <li key={source.id}>
                          <span>{`${source.displayName} · ${source.format.toUpperCase()} · ${formatBytes(source.byteSize)}`}</span>
                          {source.included
                            ? (
                              <button
                                className="button button--small"
                                type="button"
                                disabled={task.removingSourceId !== null || task.busy}
                                aria-label={`원자료 ${source.displayName} 해제`}
                                onClick={() => { task.removeSource(source.sourceId); }}
                              >{task.removingSourceId === source.sourceId ? '해제 중…' : '해제'}</button>
                            )
                            : <span className="chip">해제됨</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                <details className="fold" id="task-source-change" open={task.sources.length === 0}>
                  <summary>원자료 바꾸기</summary>
                  <div className="fold__body">
                    <div className="field">
                      <label htmlFor="task-replace-files">전체 교체할 파일</label>
                      <FileField
                        id="task-replace-files"
                        inputRef={filesRef}
                        multiple
                        accept=".txt,.log,.md,.csv,.json"
                        describedBy="task-status"
                        selectedNames={task.files.map((file) => file.name)}
                        onFiles={task.setFiles}
                      />
                    </div>
                    <button
                      className="button"
                      type="button"
                      disabled={task.replaceBusy || task.files.length === 0 || task.busy}
                      aria-describedby="task-status"
                      onClick={() => { task.replaceSelectedSources(); }}
                    >{task.replaceBusy ? '교체 중…' : '이 파일로 전체 교체'}</button>
                    <div className="field">
                      <label htmlFor="task-add-files">덧붙일 파일</label>
                      <FileField
                        id="task-add-files"
                        inputRef={addFilesRef}
                        multiple
                        accept=".txt,.log,.md,.csv,.json"
                        describedBy="task-add-note task-status"
                        selectedNames={task.addFiles.map((file) => file.name)}
                        onFiles={task.setAddFiles}
                      />
                      <p className="hint" id="task-add-note">
                        덧붙이기는 이 브라우저에서 올린 원자료 내용이 남아 있을 때만 됩니다.
                        {cacheIncomplete ? ' 지금은 내용이 없어 덧붙일 수 없으니 전체 교체를 쓰세요.' : ''}
                      </p>
                    </div>
                    <button
                      className="button"
                      type="button"
                      disabled={!task.canAddSources || task.removingSourceId !== null}
                      aria-describedby="task-add-note task-status"
                      onClick={() => { task.addSources(); }}
                    >{task.removingSourceId === 'add' ? '추가 중…' : '파일 덧붙이기'}</button>
                  </div>
                </details>
              </>
            )}
        </section>
      )}

      {part === 'analysis' && (
        <section className="panel" id="task-analysis">
          <h3>분석</h3>
          <div className="option option--consent">
            <input
              type="checkbox"
              id="task-analysis-consent"
              checked={task.consent}
              aria-describedby="task-consent-note task-status"
              onChange={(event): void => { task.setConsent(event.currentTarget.checked); }}
            />
            <label htmlFor="task-analysis-consent">
              {`${environment?.providerOrigin ?? '서버가 알리지 않은 분석 환경'}으로 원자료를 보내 분석하는 데 동의합니다.`}
            </label>
          </div>
          <p className="hint" id="task-consent-note">
            이 주소가 승인된 사내·로컬 환경인지는 운영자가 직접 확인해야 합니다. 원자료나 목적이 바뀌면 동의는 자동으로 해제됩니다.
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
            >{candidates.length > 0 ? '다시 분석' : '분석 시작'}</button>
            <button
              className="button button--quiet"
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
              hidden={job === null || (job.status !== 'running' && job.status !== 'cancel_requested')}
              disabled={task.cancelBusy}
              aria-busy={task.cancelBusy ? 'true' : undefined}
              aria-describedby="task-status"
              onClick={() => { task.cancelJob(); }}
            >{task.cancelBusy ? '취소 요청 중…' : '분석 취소'}</button>
          </div>
          {job === null ? null : (
            <p className="status" id="task-job-state">
              {`분석 상태: ${JOB_LABELS[job.status] ?? job.status}${job.errorCode === null ? '' : ` · ${ANALYSIS_ERROR_LABELS[job.errorCode] ?? '오류'} (${job.errorCode})`}`}
            </p>
          )}
          <details className="fold fold--plain" id="task-environment">
            <summary>분석 환경 자세히</summary>
            <div className="fold__body env">
              {environmentLines(environment).map((line) => <p className="hint" key={line}>{line}</p>)}
            </div>
          </details>

          <AnalysisSources
            taskId={task.selected?.id ?? null}
            revision={task.selected?.revision ?? null}
            candidates={candidates}
          />

          <details className="fold" id="task-manual">
          <summary>수동 후보 추가</summary>
          <div className="fold__body">
          {task.selected === null
            ? <p className="hint">작업을 선택하면 근거를 골라 수동 후보를 추가할 수 있습니다.</p>
            : (
              <div className="form" role="group" aria-labelledby="task-manual-heading">
                <p className="hint" id="task-manual-heading">
                  분석에서 놓친 내용을 직접 후보로 넣습니다. 근거를 고르거나 직접 메모를 남기세요.
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
                        <label htmlFor="task-manual-note">메모 내용</label>
                        <textarea
                          id="task-manual-note"
                          ref={userNoteRef}
                          maxLength={8192}
                          value={task.manual.userNote}
                          aria-invalid={task.manualInvalid === 'userNote' ? 'true' : undefined}
                          aria-describedby="task-manual-heading task-status"
                          onChange={(event): void => { task.setManualField('userNote', event.currentTarget.value); }}
                        />
                        <p className="hint">직접 메모는 내부 원자료로 저장되며 모델을 호출하지 않습니다.</p>
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
          </div>
          </details>
        </section>
      )}
    </>
  );
}
