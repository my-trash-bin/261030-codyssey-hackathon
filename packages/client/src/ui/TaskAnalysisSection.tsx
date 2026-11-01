import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import type { SessionInfo } from '../session-client.ts';
import { CANDIDATE_KINDS, CANDIDATE_RELEVANCES, CANDIDATE_UNCERTAINTIES } from '../task-client.ts';
import type { Candidate } from '../disclosure-contract.ts';
import { KIND_LABELS, UNCERTAINTY_LABELS } from '../disclosure-format.ts';
import { ModelConnection } from './ModelConnection.tsx';
import { AnalysisSources } from './SourceViews.tsx';
import type { TaskFlowApi } from './hooks/useTaskFlow.ts';
const RELEVANCE_LABELS: Record<string, string> = { required: '필수', optional: '선택' };
const ANALYSIS_ERROR_LABELS: Record<string, string> = { MODEL_UNAVAILABLE: '모델에 연결하지 못했습니다', MODEL_TIMEOUT: '모델 응답 시간이 초과됐습니다', MODEL_INVALID_RESPONSE: '모델 응답이 형식에 맞지 않습니다', MODEL_BUDGET_EXCEEDED: '자료가 커서 모델 호출 한도를 넘었습니다' };
const JOB_LABELS: Record<string, string> = { running: '실행 중', cancel_requested: '취소 요청 접수', succeeded: '완료', failed: '실패', cancelled: '취소됨', stale: '무효' };
export function TaskAnalysisSection(props: { task: TaskFlowApi; csrfToken: string | null; environment?: SessionInfo['environment']; candidates: readonly Candidate[] }): JSX.Element {
 const { task, csrfToken, environment, candidates } = props; const job = task.job;
 const kindRef = useRef<HTMLSelectElement | null>(null), uncertaintyRef = useRef<HTMLSelectElement | null>(null), statementRef = useRef<HTMLTextAreaElement | null>(null), relevanceRef = useRef<HTMLSelectElement | null>(null), purposeRelevanceRef = useRef<HTMLInputElement | null>(null), userNoteRef = useRef<HTMLTextAreaElement | null>(null), evidenceBoxRef = useRef<HTMLDivElement | null>(null);
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
 return (
        <section className="panel" id="task-analysis">
          <ModelConnection csrfToken={csrfToken} origin={environment?.providerOrigin ?? null} />
          <h3>분석</h3>
          <div className="actions">
            <button
              className="button button--solid"
              id="analyze-start"
              type="button"
              disabled={!task.canStart}
              aria-busy={task.analysisBusy ? 'true' : undefined}
              aria-describedby="task-status"
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
              <p className="hint">분석 모델: {environment?.providerOrigin ?? '연결 정보를 확인하세요.'}</p>
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

 );
}
