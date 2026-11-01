// 작업 만들기 구역. 서버 카탈로그의 실제 선택지만 쓰고, 원자료 등록/추가/교체/해제와
// 수동 후보, 분석 시작·상태 조회·취소를 한 작업 판본(snapshot)에 맞춰 진행한다.

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import type { SessionInfo } from '../session-client.ts';
import type { Candidate } from '../disclosure-contract.ts';
import { FileField } from './FileField.tsx';
import type { TaskFlowApi } from './hooks/useTaskFlow.ts';
import { TaskAnalysisSection } from './TaskAnalysisSection.tsx';

const GOAL_LABELS: Record<string, string> = {
  default: '기본',
  observations_only: '관찰만',
  ask_for_diagnostics: '진단 정보 요청',
};

const LANGUAGE_LABELS: Record<string, string> = {
  ko: '한국어',
  en: '영어',
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '크기 정보 없음';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KiB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MiB`;
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
  const purposeRef = useRef<HTMLSelectElement | null>(null);
  const recipientRef = useRef<HTMLInputElement | null>(null);
  const audienceRef = useRef<HTMLSelectElement | null>(null);
  const filesRef = useRef<HTMLInputElement | null>(null);
  const addFilesRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const field = task.invalidField;
    if (field === 'internalTitle') titleRef.current?.focus();
    else if (field === 'purposeId') purposeRef.current?.focus();
    else if (field === 'recipientId') recipientRef.current?.focus();
    else if (field === 'audience') audienceRef.current?.focus();
    else if (field === 'files') filesRef.current?.focus();
  }, [task.invalidField]);

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
  const showIntake = catalog !== null;
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

          {task.catalogBusy && <p className="hint">작업 설정을 불러오는 중입니다…</p>}
          {task.catalogProblem !== '' && (
            <div className="hint">
              <p role="status">{task.catalogProblem}</p>
              <button className="button" type="button" onClick={() => { task.reloadCatalog(); }}>설정 다시 불러오기</button>
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
                  <input
                    id="task-recipient"
                    name="recipientId"
                    type="text"
                    required
                    maxLength={256}
                    ref={recipientRef}
                    value={task.form.recipientId}
                    aria-invalid={task.invalidField === 'recipientId' ? 'true' : undefined}
                    aria-describedby="task-create-hint task-status"
                    onChange={(event): void => { task.setField('recipientId', event.currentTarget.value); }}
                  />
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
              disabled={!canSubmit || !showIntake}
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
        <TaskAnalysisSection task={task} csrfToken={csrfToken} environment={environment} candidates={candidates} />
      )}
    </>
  );
}
