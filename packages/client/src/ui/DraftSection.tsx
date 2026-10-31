// 공유 초안 영역. 서버의 compose/review job, 현재 artifact와 실제 파일 bytes, DocAST 편집,
// 조건을 만족할 때의 사람 의미 검토, 확정 뒤 저장된 동일 bytes 다운로드를 실제 API로 연결한다.
// 모델·파일 문자열은 React 텍스트로만 표시하며 HTML로 실행하지 않는다.
import type { JSX } from 'react';
import type { Evidence, Snapshot } from '../disclosure-contract.ts';
import type { ArtifactReviewView } from '../artifacts-client.ts';
import { phaseLabel } from '../task-browser-client.ts';
import type { ArtifactsApi } from './hooks/useArtifacts.ts';

const JOB_LABELS: Record<string, string> = {
  compose: '작성',
  review: '검토',
};

const JOB_STATUS_LABELS: Record<string, string> = {
  running: '실행 중',
  cancel_requested: '취소 요청됨',
  succeeded: '성공',
  failed: '실패',
  cancelled: '취소됨',
  stale: '무효',
};

const REVIEW_LABELS: Record<ArtifactReviewView['result'], string> = {
  pass: '통과',
  needs_changes: '수정 필요',
  needs_decision: '추가 공개 결정 필요',
  error: '검토 오류',
};

const HUMAN_REVIEW_CODES: Record<string, true> = { MODEL_TIMEOUT: true, MODEL_UNAVAILABLE: true };

function shortHash(hash: string): string {
  if (hash === '') return '없음';
  return hash.length > 16 ? `${hash.slice(0, 16)}…` : hash;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

function reviewLabel(review: ArtifactReviewView | null): string {
  return review === null ? '기록 없음' : REVIEW_LABELS[review.result];
}

export type DraftSectionPart = 'compose' | 'review' | 'files';

export function DraftSection(props: { workflow: ArtifactsApi; part: DraftSectionPart }): JSX.Element {
  const workflow = props.workflow;
  const { task, artifact, job, exportInfo, file } = workflow;
  const humanReviewApplies = artifact !== null && artifact.reviewErrorCode !== null &&
    HUMAN_REVIEW_CODES[artifact.reviewErrorCode] === true;
  const alreadyFinalized = exportInfo !== null && artifact !== null && exportInfo.artifactId === artifact.id &&
    exportInfo.artifactSetHash === artifact.artifactSetHash && task !== null && exportInfo.revision === task.revision;

  if (props.part === 'compose') return (
    <section className="draft panel" id="draft-workspace">
      <p className="hint">
        승인된 공개 선택으로 서버가 만든 실제 파일만 표시합니다. 파일 payload는 텍스트로만 보여 주며 HTML로 실행하지 않습니다.
      </p>

      <p className="status" role="status" aria-live="polite" id="draft-status">{workflow.message}</p>

      {task === null
        ? <p className="hint">{workflow.taskId === null ? '작업을 먼저 등록하거나 불러오세요.' : '작업 정보를 불러오는 중입니다.'}</p>
        : (
          <p className="meta">
            작업 {shortId(task.id)} · 판본 {task.revision} · 단계 {phaseLabel(task.phase)}
            {artifact === null ? '' : ` · 초안 ${shortId(artifact.id)} (판본 ${artifact.revision})`}
          </p>
        )}

      {workflow.broadcastMessage === ''
        ? null
        : (
          <div className="action">
            <p className="hint">{workflow.broadcastMessage}</p>
            <button className="button" type="button" onClick={workflow.reload} disabled={workflow.busy || workflow.taskId === null}>
              작업 다시 불러오기
            </button>
          </div>
        )}

      {workflow.goalNotice === '' ? null : <p className="hint">{workflow.goalNotice}</p>}

      <div className="draft__actions">
        <div className="action">
          <button
            className="button"
            id="generate-document"
            type="button"
            onClick={workflow.compose}
            disabled={workflow.composeBlockReason !== ''}
            aria-describedby="generate-document-reason"
          >
            공유 초안 생성
          </button>
          <p className="hint" id="generate-document-reason">
            {workflow.composeBlockReason === ''
              ? '현재 승인된 공개 사실로 새 초안을 만들고 자동 검토를 함께 실행합니다.'
              : workflow.composeBlockReason}
          </p>
        </div>

        {job === null
          ? null
          : (
            <div className="action">
              <p className="hint">
                {JOB_LABELS[job.kind] ?? job.kind} job · {JOB_STATUS_LABELS[job.status] ?? job.status} · 입력 판본 {job.inputRevision}
                {job.errorCode === null ? '' : ` · 오류 ${job.errorCode}`}
              </p>
              {(job.status === 'running' || job.status === 'cancel_requested') && (
                <button
                  className="button"
                  type="button"
                  onClick={workflow.cancel}
                  disabled={workflow.busy || job.status === 'cancel_requested'}
                  aria-describedby="draft-job-cancel-reason"
                >
                  {job.status === 'cancel_requested' ? '취소 요청됨' : 'job 취소'}
                </button>
              )}
              <p className="hint" id="draft-job-cancel-reason">
                취소는 서버에 요청만 접수하며, 모델 실행이 멈춘 뒤 상태가 취소로 바뀝니다.
              </p>
            </div>
          )}
      </div>
    </section>
  );

  if (props.part === 'files') return (
    <section className="draft panel" id="draft-files">
      <div className="draft__actions">
        {artifact === null
          ? (
            <>
              <div className="draft__sheet">
                <p className="draft__empty" id="draft-state">
                  {task === null ? '아직 공유 초안이 없습니다.' : '아직 이 작업의 공유 초안이 없습니다. 공개 결정을 저장한 뒤 초안을 생성하세요.'}
                </p>
              </div>
              <div className="action">
                <button
                  className="button"
                  id="finalize-document"
                  type="button"
                  onClick={workflow.finalize}
                  disabled
                  aria-describedby="finalize-document-reason"
                >
                  이 파일들로 확정
                </button>
                <p className="hint" id="finalize-document-reason">확정할 초안이 없습니다. 먼저 공유 초안을 만들고 검토를 거치세요.</p>
              </div>
            </>
          )
          : (
            <div className="draft__sheet">
              <p className="meta">
                현재 초안 여부: {artifact.isCurrent ? '현재 판본과 일치' : '현재 판본과 불일치'}
                {' · '}확정 가능: {artifact.finalizable ? '서버 판정 가능' : '서버 판정 불가'}
              </p>
              {artifact.isCurrent
                ? null
                : <p className="hint">공개 결정·규칙이나 작업 판본이 바뀌어 이 초안은 확정·다운로드 대상이 아닙니다. 새 초안을 만들어야 합니다.</p>}
              {artifact.hardErrors.length === 0
                ? null
                : <p className="hint">파일 검사 오류: {artifact.hardErrors.join(', ')}</p>}

              <h3>실제 공개 파일</h3>
              {artifact.files.length === 0
                ? <p className="hint">서버가 이 초안의 공개 파일을 만들지 못했습니다.</p>
                : (
                  <div className="preview__scroll">
                    <table className="preview__table">
                      <thead>
                        <tr>
                          <th scope="col">경로</th>
                          <th scope="col">형식</th>
                          <th scope="col">크기</th>
                          <th scope="col">SHA-256</th>
                          <th scope="col">내용</th>
                        </tr>
                      </thead>
                      <tbody>
                        {artifact.files.map((entry) => (
                          <tr key={entry.path}>
                            <td>{entry.path}</td>
                            <td>{entry.mediaType}</td>
                            <td>{`${entry.size.toLocaleString('ko-KR')} bytes`}</td>
                            <td>{shortHash(entry.sha256)}</td>
                            <td>
                              <button
                                className="button button--small"
                                type="button"
                                onClick={() => { workflow.openFile(entry.path); }}
                                disabled={workflow.fileBusy}
                              >
                                내용 보기
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              <p className="hint">내부 확인용 bytes이며 확정 다운로드와 별개입니다. 확정 뒤 내려받는 파일만 불변 파일 집합입니다.</p>

              {file === null
                ? null
                : (
                  <div className="custom">
                    <p className="meta">{file.path} · 실제 서버 bytes</p>
                    <div className="documents"><pre>{file.text}</pre></div>
                    <div className="actions">
                      <button className="button button--small" type="button" onClick={workflow.closeFile}>내용 닫기</button>
                    </div>
                  </div>
                )}

              <details className="block--fold" id="draft-technical">
                <summary className="hint">기술 정보 전체 보기</summary>
                <div className="fold__body">
                  <ul className="plain-list">
                    <li>초안 ID: {artifact.id}</li>
                    <li>작업 판본: {artifact.revision}</li>
                    <li>문서 hash: {artifact.documentHash}</li>
                    <li>파일 집합 hash: {artifact.artifactSetHash === '' ? '없음' : artifact.artifactSetHash}</li>
                    <li>검토 대상 hash: {artifact.reviewTargetHash === null ? '없음' : artifact.reviewTargetHash}</li>
                  </ul>
                </div>
              </details>

              <h3>최종 확인</h3>
              <p className="hint">
                확정하면 지금 파일 그대로의 ZIP과 개별 파일을 내려받습니다. 확정 뒤 작업 판본·결정·규칙이 바뀌면 서버가 다운로드를 거부합니다.
              </p>
              {alreadyFinalized
                ? <p className="hint">현재 초안은 이미 확정되었습니다. 아래 내보내기에서 동일 bytes를 다시 내려받을 수 있습니다.</p>
                : (
                  <div className="option">
                    <input
                      type="checkbox"
                      id="finalize-confirm"
                      checked={workflow.finalizeConfirmed}
                      onChange={(event) => { workflow.setFinalizeConfirmed(event.target.checked); }}
                    />
                    <label htmlFor="finalize-confirm">현재 파일 목록과 형식·크기를 확인했고 이 파일들로 확정합니다.</label>
                  </div>
                )}
              <div className="action">
                <button
                  className="button"
                  id="finalize-document"
                  type="button"
                  onClick={workflow.finalize}
                  disabled={workflow.finalizeBlockReason !== '' || alreadyFinalized}
                  aria-describedby="finalize-document-reason"
                >
                  이 파일들로 확정
                </button>
                <p className="hint" id="finalize-document-reason">
                  {alreadyFinalized
                    ? '이미 이 파일 집합으로 확정했습니다. 새 판본이 필요하면 편집하거나 다시 작성하세요.'
                    : (workflow.finalizeBlockReason === '' ? '서버 확정 조건을 만족했습니다.' : workflow.finalizeBlockReason)}
                </p>
              </div>

              {exportInfo === null
                ? null
                : (
                  <div className="candidate__reusable">
                    <h3>확정 내보내기</h3>
                    <p className="meta">
                      export {shortId(exportInfo.id)} · 판본 {exportInfo.revision} · ZIP SHA-256 {shortHash(exportInfo.archiveSha256)}
                    </p>
                    <div className="actions">
                      <button
                        className="button"
                        type="button"
                        onClick={workflow.downloadArchive}
                        disabled={workflow.downloadBlockReason !== '' || workflow.downloadBusy !== null}
                        aria-describedby="download-block-reason"
                      >
                        패키지(ZIP) 다운로드
                      </button>
                    </div>
                    {artifact === null || artifact.files.length === 0
                      ? null
                      : (
                        <div className="preview__scroll">
                          <table className="preview__table">
                            <thead>
                              <tr>
                                <th scope="col">확정 파일</th>
                                <th scope="col">크기</th>
                                <th scope="col">다운로드</th>
                              </tr>
                            </thead>
                            <tbody>
                              {artifact.files.map((entry) => (
                                <tr key={entry.path}>
                                  <td>{entry.path}</td>
                                  <td>{`${entry.size.toLocaleString('ko-KR')} bytes`}</td>
                                  <td>
                                    <button
                                      className="button"
                                      type="button"
                                      onClick={() => { workflow.downloadFile(entry.path); }}
                                      disabled={workflow.downloadBlockReason !== '' || workflow.downloadBusy !== null}
                                    >
                                      개별 파일
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    <p className="hint" id="download-block-reason">
                      {workflow.downloadBlockReason === ''
                        ? '서버가 저장한 확정 bytes를 그대로 내려받습니다. 다시 렌더링하지 않습니다.'
                        : workflow.downloadBlockReason}
                    </p>
                  </div>
                )}
            </div>
          )}
      </div>
    </section>
  );

  return (
    <section className="draft panel" id="draft-review">
      {artifact === null
        ? (
          <div className="draft__sheet">
            <h3>검토</h3>
            <p className="hint">
              자동 검토와 사람 의미 검토는 공유 초안이 있어야 열립니다. 초안 작성 단계에서 초안을 먼저 만드세요.
            </p>
          </div>
        )
        : null}
      <div className="draft__actions">
        {artifact === null
          ? null
          : (
            <div className="draft__sheet">
              <h3>자동 검토</h3>
              <p className="hint">
                {artifact.review === null
                  ? (artifact.reviewErrorCode === null
                    ? '자동 검토 기록이 없습니다. 이 초안은 아직 검토되지 않았습니다.'
                    : `자동 검토가 실패했습니다. (${artifact.reviewErrorCode})`)
                  : `검토 결과 ${reviewLabel(artifact.review)} · 이슈 ${artifact.review.issues.length}개`}
              </p>
              {artifact.humanReview === null
                ? null
                : (
                  <p className="hint">
                    사람 의미 검토 기록 · 대상 hash {shortHash(artifact.humanReview.targetHash)} · 사유: {artifact.humanReview.fallbackReason}
                  </p>
                )}
              <div className="actions">
                <button
                  className="button"
                  type="button"
                  onClick={workflow.reReview}
                  disabled={workflow.reviewBlockReason !== ''}
                  aria-describedby="draft-review-reason"
                >
                  현재 파일 재검토
                </button>
              </div>
              <p className="hint" id="draft-review-reason">
                {workflow.reviewBlockReason === ''
                  ? '현재 파일 집합 hash로 실제 모델 검토를 다시 실행합니다.'
                  : workflow.reviewBlockReason}
              </p>

              <details className="block--fold" id="draft-docast-editor">
                <summary><h3>DocAST 직접 편집</h3></summary>
                <div className="fold__body">
                  <p className="hint">
                    허용 블록의 text·items·fact_ids만 고칠 수 있습니다. 저장하면 새 판본과 새 artifact가 만들어지고 실제 자동 검토를 다시 거칩니다.
                    이전 판본의 검토는 새 파일에 쓰이지 않으며, 공개 선택 자체는 바뀌지 않습니다.
                  </p>
                  <div className="field">
                    <label htmlFor="draft-docast">draft.v1 JSON</label>
                    <textarea
                      id="draft-docast"
                      value={workflow.draftText}
                      onChange={(event) => { workflow.setDraftText(event.target.value); }}
                      rows={18}
                      spellCheck={false}
                      aria-invalid={workflow.draftError !== ''}
                      aria-describedby="draft-docast-error"
                      disabled={workflow.artifact === null}
                    />
                  </div>
                  <p className="hint" id="draft-docast-error" aria-live="polite">
                    {workflow.draftError === ''
                      ? (workflow.draftDirty ? '저장하지 않은 편집이 있습니다.' : '편집 내용이 없으면 현재 DocAST 그대로입니다.')
                      : workflow.draftError}
                  </p>
                  <div className="actions">
                    <button
                      className="button"
                      type="button"
                      onClick={workflow.saveEdit}
                      disabled={workflow.editBlockReason !== ''}
                      aria-describedby="draft-edit-reason"
                    >
                      편집 저장 후 재검토
                    </button>
                  </div>
                  <p className="hint" id="draft-edit-reason">
                    {workflow.editBlockReason === ''
                      ? '저장하면 현재 작업 판본에 새 초안 판본을 만들고 검토를 시작합니다.'
                      : workflow.editBlockReason}
                  </p>
                </div>
              </details>

              {(humanReviewApplies || artifact.humanReview !== null) && (
                <div className="candidate__reusable">
                  <h3>사람 의미 검토</h3>
                  <p className="hint">
                    자동 검토가 모델 실패(MODEL_TIMEOUT·MODEL_UNAVAILABLE)로 끝난 현재 파일에만 기록할 수 있습니다.
                    판본·필수 검사·미결정·위조된 파일 오류는 이 기록으로도 계속 차단됩니다.
                  </p>
                  {artifact.humanReview !== null
                    ? <p className="hint">이미 사람 의미 검토가 기록되었습니다. 새 검토가 필요하면 파일을 편집하거나 다시 작성하세요.</p>
                    : (
                      <>
                        <fieldset>
                          <legend>확인 항목</legend>
                          <div className="option">
                            <input
                              type="checkbox"
                              id="human-review-files"
                              checked={workflow.checklist.reviewed_all_files}
                              onChange={(event) => {
                                workflow.setChecklist({ ...workflow.checklist, reviewed_all_files: event.target.checked });
                              }}
                            />
                            <label htmlFor="human-review-files">모든 공개 파일의 실제 내용을 확인했습니다.</label>
                          </div>
                          <div className="option">
                            <input
                              type="checkbox"
                              id="human-review-facts"
                              checked={workflow.checklist.approved_facts_only}
                              onChange={(event) => {
                                workflow.setChecklist({ ...workflow.checklist, approved_facts_only: event.target.checked });
                              }}
                            />
                            <label htmlFor="human-review-facts">승인된 사실만 포함되어 있다고 확인했습니다.</label>
                          </div>
                          <div className="option">
                            <input
                              type="checkbox"
                              id="human-review-uncertainty"
                              checked={workflow.checklist.uncertainty_preserved}
                              onChange={(event) => {
                                workflow.setChecklist({ ...workflow.checklist, uncertainty_preserved: event.target.checked });
                              }}
                            />
                            <label htmlFor="human-review-uncertainty">미확인·불확실 표시가 유지된 것을 확인했습니다.</label>
                          </div>
                        </fieldset>
                        <div className="field">
                          <label htmlFor="human-review-reason">검토 사유</label>
                          <textarea
                            id="human-review-reason"
                            rows={3}
                            value={workflow.fallbackReason}
                            onChange={(event) => { workflow.setFallbackReason(event.target.value); }}
                            aria-describedby="human-review-reason-hint"
                          />
                        </div>
                        <p className="hint" id="human-review-reason-hint">무엇을 직접 확인했는지 적습니다. 서버는 이 사유를 기록하며 검사를 대신 통과시키지 않습니다.</p>
                        <div className="actions">
                          <button
                            className="button"
                            type="button"
                            onClick={workflow.recordHumanReview}
                            disabled={workflow.humanReviewBlockReason !== ''}
                            aria-describedby="human-review-block"
                          >
                            사람 의미 검토 기록
                          </button>
                        </div>
                        <p className="hint" id="human-review-block">
                          {workflow.humanReviewBlockReason === ''
                            ? '세 항목과 사유가 서버 조건을 만족하면 검토 기록이 만들어집니다.'
                            : workflow.humanReviewBlockReason}
                        </p>
                      </>
                    )}
                </div>
              )}
            </div>
          )}
      </div>
    </section>
  );
}

export function EvidencePanel(props: { snapshot: Snapshot | null; workflow: ArtifactsApi }): JSX.Element {
  const { snapshot, workflow } = props;
  const artifact = workflow.artifact;
  const candidates = snapshot === null ? [] : snapshot.candidates;
  const evidenceById = new Map<string, Evidence>();
  if (snapshot !== null) for (const evidence of snapshot.evidence) evidenceById.set(evidence.id, evidence);

  return (
    <details className="block--fold" id="review-evidence">
      <summary><h2>내부 근거와 검토</h2></summary>
      <div className="fold__body">
        <p className="hint">
          내부 참고용입니다. 공유 파일에는 포함되지 않습니다. 원자료 발췌문은 서버가 원문 bytes를 내려주지 않아 표시하지 않고 근거 위치만 보여 줍니다.
        </p>

        <h3>근거</h3>
        {candidates.length === 0
          ? <p className="hint">공개 결정 후보를 아직 불러오지 못했습니다.</p>
          : (
            <ul className="plain-list">
              {candidates.map((candidate) => {
                const linked = (candidate.evidence_ids ?? [])
                  .map((id) => evidenceById.get(id))
                  .filter((evidence): evidence is Evidence => evidence !== undefined);
                return (
                  <li key={candidate.id}>
                    <p className="meta">
                      후보 {candidate.id} · {candidate.kind} · {candidate.required ? '필수' : '선택'} · 판단 {candidate.uncertainty}
                    </p>
                    <p>{candidate.statement}</p>
                    <p className="hint">
                      {linked.length === 0
                        ? '연결된 근거가 없습니다.'
                        : `근거 ${linked.length}개: ${linked.map((evidence) => {
                          const locator = evidence.locator;
                          const parts: string[] = [locator.kind];
                          if (locator.column !== undefined) parts.push(locator.column);
                          if (locator.pointer !== undefined) parts.push(locator.pointer);
                          if (locator.row !== undefined) parts.push(`행 ${locator.row}`);
                          return `${parts.join(' ')} (${evidence.start}-${evidence.end})`;
                        }).join(' / ')}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

        <h3>검토</h3>
        {artifact === null
          ? <p className="hint">검토 기록을 표시할 초안이 없습니다.</p>
          : (
            <>
              {artifact.review === null
                ? (
                  <p className="hint">
                    {artifact.reviewErrorCode === null
                      ? '자동 검토 기록이 없습니다.'
                      : `자동 검토가 실패했습니다. (${artifact.reviewErrorCode})`}
                  </p>
                )
                : (
                  <>
                    <p className="hint">
                      자동 검토 {reviewLabel(artifact.review)} · 이슈 {artifact.review.issues.length}개 · 검토 대상 hash {shortHash(artifact.reviewTargetHash ?? '')}
                    </p>
                    <ul className="plain-list">
                      {artifact.review.issues.map((issue, index) => (
                        <li key={`${issue.reasonCode}-${index.toString()}`}>
                          <p className="meta">
                            대상 {issue.targetKind}{issue.blockId === null ? '' : `/${issue.blockId}`} · 사유 코드 {issue.reasonCode}
                          </p>
                          <p className="hint">
                            승인 사실 {issue.approvedFactIds.length === 0 ? '없음' : issue.approvedFactIds.join(', ')}
                            {' · '}관련 후보 {issue.candidateIds.length === 0 ? '없음' : issue.candidateIds.join(', ')}
                          </p>
                          {issue.action === null ? null : <p className="hint">요청 조치: {issue.action}</p>}
                          <p className="hint">내부 설명: {issue.internalExplanation}</p>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              {artifact.humanReview === null
                ? null
                : (
                  <div>
                    <p className="meta">사람 의미 검토 기록 · 대상 hash {shortHash(artifact.humanReview.targetHash)}</p>
                    <p className="hint">사유: {artifact.humanReview.fallbackReason}</p>
                  </div>
                )}
            </>
          )}

        <h3>이력</h3>
        <p className="hint">
          서버가 초안 이력 목록 경로를 제공하지 않아 이전 판본 목록은 표시하지 않습니다. 현재 초안의 판본과 hash만 위에 표시합니다.
        </p>

        <h3>스킬 등록</h3>
        <p className="hint">
          이 서버 API에는 분석 결과를 스킬로 등록하는 경로가 없습니다. 재사용 규칙은 공개 결정의 규칙 영역에서 별도로 저장합니다.
        </p>
      </div>
    </details>
  );
}
