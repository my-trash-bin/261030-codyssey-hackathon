// 공유 초안 영역. 서버의 compose/review job, 현재 artifact와 실제 파일 bytes, DocAST 편집,
// 조건을 만족할 때의 사람 의미 검토, 확정 뒤 저장된 동일 bytes 다운로드를 실제 API로 연결한다.
// 모델·파일 문자열은 React 텍스트로만 표시하며 HTML로 실행하지 않는다.
import type { JSX } from 'react';
import type { Candidate, Evidence, Snapshot } from '../disclosure-contract.ts';
import type { ArtifactFileMeta, ArtifactReviewView, ArtifactView, DraftDocument } from '../artifacts-client.ts';
import { DISPOSITION_LABELS, kindLabel, orderCandidates, UNCERTAINTY_LABELS } from '../disclosure-format.ts';
import type { ArtifactsApi } from './hooks/useArtifacts.ts';
import { modelErrorText } from './hooks/useArtifacts.ts';
import { ReviewSources } from './SourceViews.tsx';

const REVIEW_LABELS: Record<ArtifactReviewView['result'], string> = {
  pass: '통과',
  needs_changes: '수정 필요',
  needs_decision: '추가 공개 결정 필요',
  error: '검토 오류',
};

const REASON_LABELS: Record<string, string> = {
  UNAPPROVED_DISCLOSURE: '승인하지 않은 내용 공개',
  UNSUPPORTED_CAUSAL_CLAIM: '근거 없는 원인 단정',
  MISSING_REQUIRED_FACT: '필수 사실 누락',
  SOURCE_CONFLICT: '자료 간 충돌',
  UNCERTAINTY_REMOVED: '불확실 표현 삭제',
  INCORRECT_PROJECTION: '공개 표현과 다른 값',
  UNAPPROVED_REFERENCE: '승인하지 않은 참조',
  NEEDS_DISCLOSURE_DECISION: '공개 결정 필요',
};

const HUMAN_REVIEW_CODES: Record<string, true> = { MODEL_TIMEOUT: true, MODEL_UNAVAILABLE: true };

function shortHash(hash: string): string {
  if (hash === '') return '없음';
  return hash.length > 16 ? `${hash.slice(0, 16)}…` : hash;
}

function fileKind(mediaType: string): string {
  if (mediaType.startsWith('text/csv')) return '표(CSV)';
  if (mediaType.startsWith('text/markdown')) return '문서(Markdown)';
  if (mediaType.startsWith('application/json')) return '파일 목록(JSON)';
  return mediaType;
}

// 사람이 읽을 파일을 앞에 두고 무결성 목록은 맨 뒤로 보낸다.
function orderedFiles(files: readonly ArtifactFileMeta[]): ArtifactFileMeta[] {
  return [...files].sort((a, b) => Number(a.path === 'manifest.json') - Number(b.path === 'manifest.json'));
}

function reviewSummary(artifact: ArtifactView): { text: string; tone: 'ok' | 'warn' | 'error' } {
  if (artifact.review !== null) {
    const tone = artifact.review.result === 'pass' ? 'ok' : artifact.review.result === 'error' ? 'error' : 'warn';
    const count = artifact.review.issues.length;
    return { text: `자동 검토 ${REVIEW_LABELS[artifact.review.result]}${count > 0 ? ` · 지적 ${count}건` : ''}`, tone };
  }
  if (artifact.reviewErrorCode !== null) {
    return { text: `자동 검토 실패: ${modelErrorText(artifact.reviewErrorCode)}`, tone: 'error' };
  }
  return { text: '아직 자동 검토를 하지 않았습니다.', tone: 'warn' };
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// 초안 문장을 읽기 전용으로 그린다. 표 값은 이 응답에 없으므로 어느 파일로 공유되는지만 알린다.
function DraftDocumentView(props: { draft: DraftDocument }): JSX.Element {
  let tableNumber = 0;
  return (
    <div className="doc-preview" data-role="draft-document">
      {props.draft.blocks.map((block, index) => {
        const key = `${asText(block.block_id) || block.type}-${index.toString()}`;
        if (block.type === 'heading') {
          const level = typeof block.level === 'number' ? block.level : 2;
          return <p className={`doc-preview__heading${level <= 2 ? ' doc-preview__heading--top' : ''}`} key={key}>{asText(block.text)}</p>;
        }
        if (block.type === 'paragraph') return <p key={key}>{asText(block.text)}</p>;
        if (block.type === 'list' && Array.isArray(block.items)) {
          return (
            <ul key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{asText((item as Record<string, unknown>).text)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'table_ref') {
          tableNumber += 1;
          return <p className="doc-preview__note" key={key}>{`[표 ${tableNumber.toString()}: 파일 확인 단계의 CSV로 함께 공유됩니다]`}</p>;
        }
        if (block.type === 'excerpt_ref') return <p className="doc-preview__note" key={key}>[승인한 발췌]</p>;
        if (block.type === 'asset_ref') return <p className="doc-preview__note" key={key}>[첨부 파일]</p>;
        return null;
      })}
    </div>
  );
}

function ReviewIssues(props: { review: ArtifactReviewView }): JSX.Element | null {
  if (props.review.issues.length === 0) return null;
  return (
    <ul className="issue-list" data-role="review-issues">
      {props.review.issues.map((issue, index) => (
        <li className="issue" key={`${issue.reasonCode}-${index.toString()}`}>
          <p className="issue__title">{REASON_LABELS[issue.reasonCode] ?? issue.reasonCode}</p>
          <p className="issue__body">{issue.internalExplanation}</p>
          {issue.action === null ? null : <p className="hint">요청 조치: {issue.action}</p>}
          <p className="hint">{issue.targetKind === 'block' && issue.blockId !== null ? `대상 블록 ${issue.blockId}` : '대상: 문서 전체'}</p>
        </li>
      ))}
    </ul>
  );
}

export type DraftSectionPart = 'compose' | 'review' | 'files';

export function DraftSection(props: {
  workflow: ArtifactsApi;
  part: DraftSectionPart;
  pendingDecisions?: readonly Candidate[];
  onGoToDecision?: () => void;
}): JSX.Element {
  const workflow = props.workflow;
  const { task, artifact, job, exportInfo, file } = workflow;
  const humanReviewApplies = artifact !== null && artifact.reviewErrorCode !== null &&
    HUMAN_REVIEW_CODES[artifact.reviewErrorCode] === true;
  const alreadyFinalized = exportInfo !== null && artifact !== null && exportInfo.artifactId === artifact.id &&
    exportInfo.artifactSetHash === artifact.artifactSetHash && task !== null && exportInfo.revision === task.revision;
  const jobRunning = job !== null && (job.status === 'running' || job.status === 'cancel_requested');

  const syncNotice = workflow.broadcastMessage === ''
    ? null
    : (
      <div className="action">
        <p className="hint">{workflow.broadcastMessage}</p>
        <button className="button" type="button" onClick={workflow.reload} disabled={workflow.busy || workflow.taskId === null}>
          작업 다시 불러오기
        </button>
      </div>
    );

  if (props.part === 'compose') return (
    <section className="draft panel" id="draft-workspace">
      <p className="status" role="status" aria-live="polite" id="draft-status">{workflow.message}</p>
      {syncNotice}
      {workflow.goalNotice === '' ? null : <p className="hint">{workflow.goalNotice}</p>}

      {artifact === null
        ? null
        : (
          <>
            <h3>만들어진 초안</h3>
            <p className={`status status--${reviewSummary(artifact).tone}`}>{reviewSummary(artifact).text}</p>
            <DraftDocumentView draft={artifact.draft} />
          </>
        )}

      <div className="action">
        <button
          className={`button${artifact === null ? ' button--solid' : ''}`}
          id="generate-document"
          type="button"
          onClick={workflow.compose}
          disabled={workflow.composeBlockReason !== ''}
          aria-describedby="generate-document-reason"
        >
          {artifact === null ? '공유 초안 생성' : '초안 새로 만들기'}
        </button>
        <p className="hint" id="generate-document-reason">
          {workflow.composeBlockReason !== ''
            ? workflow.composeBlockReason
            : artifact === null
              ? '승인한 공개 사실로 초안을 만들고 자동 검토까지 실행합니다.'
              : '새로 만들면 지금 초안을 대체합니다.'}
        </p>
      </div>

      {jobRunning
        ? (
          <div className="action">
            <button
              className="button"
              type="button"
              onClick={workflow.cancel}
              disabled={workflow.busy || job.status === 'cancel_requested'}
            >
              {job.status === 'cancel_requested' ? '취소 요청됨' : '작업 취소'}
            </button>
            <p className="hint">모델 실행이 멈춘 뒤 취소로 바뀝니다.</p>
          </div>
        )
        : null}
    </section>
  );

  if (props.part === 'files') {
    const pending = orderCandidates(props.pendingDecisions ?? []);
    const finalizedBefore = task?.phase === 'finalized' && !alreadyFinalized;
    return (
      <section className="draft panel" id="draft-files">
        {syncNotice}
        {artifact === null
          ? <p className="status" id="draft-state">아직 공유 초안이 없습니다. 초안 작성 단계에서 먼저 만드세요.</p>
          : (
            <>
              {artifact.isCurrent
                ? null
                : <p className="status status--warn">공개 결정이나 규칙이 바뀌어 이 초안은 확정할 수 없습니다. 초안을 다시 만드세요.</p>}

              <h3>공유할 파일</h3>
              {artifact.files.length === 0
                ? <p className="hint">자동 검토를 통과하면 공개 파일이 만들어집니다. 검토 단계에서 지적 사항을 확인하세요.</p>
                : (
                  <div className="preview__scroll">
                    <table className="preview__table">
                      <thead>
                        <tr>
                          <th scope="col">파일</th>
                          <th scope="col">종류</th>
                          <th scope="col">크기</th>
                          <th scope="col">SHA-256</th>
                          <th scope="col">내용</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderedFiles(artifact.files).map((entry) => (
                          <tr key={entry.path}>
                            <td>{entry.path}</td>
                            <td>{fileKind(entry.mediaType)}</td>
                            <td>{`${entry.size.toLocaleString('ko-KR')} B`}</td>
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

              {file === null
                ? null
                : (
                  <div className="file-view">
                    <p className="meta">{file.path}</p>
                    <pre className="file-view__text">{file.text}</pre>
                    <button className="button button--small" type="button" onClick={workflow.closeFile}>내용 닫기</button>
                  </div>
                )}

              <details className="fold fold--plain" id="draft-technical">
                <summary>기술 정보</summary>
                <div className="fold__body">
                  <ul className="plain-list">
                    <li>초안 ID: {artifact.id}</li>
                    <li>작업 판본: {artifact.revision}</li>
                    <li>문서 해시: {artifact.documentHash}</li>
                    <li>파일 집합 해시: {artifact.artifactSetHash === '' ? '없음' : artifact.artifactSetHash}</li>
                    <li>검토 대상 해시: {artifact.reviewTargetHash === null ? '없음' : artifact.reviewTargetHash}</li>
                  </ul>
                </div>
              </details>

              {pending.length === 0
                ? null
                : (
                  <div className="notice notice--warn" data-role="pending-decisions">
                    <p className="status">{`확정하려면 후보 ${pending.length.toString()}개를 먼저 허용이나 제외로 정해야 합니다.`}</p>
                    <ul className="plain-list">
                      {pending.map((candidate) => <li key={candidate.id}>{candidate.statement}</li>)}
                    </ul>
                    <p className="hint">결정을 저장하면 작업 판본이 바뀌므로 초안을 다시 만들어야 합니다.</p>
                    <button className="button" type="button" onClick={props.onGoToDecision}>공개 결정으로 이동</button>
                  </div>
                )}

              {alreadyFinalized
                ? null
                : (
                  <>
                    <h3>확정</h3>
                    {finalizedBefore
                      ? <p className="hint" data-role="finalized-before">이 작업은 이미 확정했습니다. 내려받기 정보는 새로고침하면 사라지므로, 같은 파일로 다시 확정하면 같은 내용을 내려받을 수 있습니다.</p>
                      : <p className="hint">확정 뒤 작업 판본이나 공개 결정이 바뀌면 서버가 다운로드를 거부합니다.</p>}
                    {artifact.finalizable
                      ? (
                        <div className="option">
                          <input
                            type="checkbox"
                            id="finalize-confirm"
                            checked={workflow.finalizeConfirmed}
                            onChange={(event) => { workflow.setFinalizeConfirmed(event.target.checked); }}
                          />
                          <label htmlFor="finalize-confirm">파일 목록과 내용을 확인했고 이 파일들로 확정합니다.</label>
                        </div>
                      )
                      : null}
                    <div className="action">
                      <button
                        className="button button--solid"
                        id="finalize-document"
                        type="button"
                        onClick={workflow.finalize}
                        disabled={workflow.finalizeBlockReason !== ''}
                        aria-describedby="finalize-document-reason"
                      >
                        {finalizedBefore ? '같은 파일로 다시 확정' : '이 파일들로 확정'}
                      </button>
                      <p className="hint" id="finalize-document-reason">{workflow.finalizeBlockReason}</p>
                    </div>
                  </>
                )}

              {exportInfo === null
                ? null
                : (
                  <div className="notice notice--ok" data-role="export">
                    <h3>확정 완료</h3>
                    <p className="hint">{`ZIP SHA-256 ${shortHash(exportInfo.archiveSha256)} · 판본 ${exportInfo.revision.toString()}`}</p>
                    <button
                      className="button button--solid"
                      type="button"
                      onClick={workflow.downloadArchive}
                      disabled={workflow.downloadBlockReason !== '' || workflow.downloadBusy !== null}
                      aria-describedby="download-block-reason"
                    >
                      패키지(ZIP) 다운로드
                    </button>
                    <ul className="download-list">
                      {orderedFiles(artifact.files).map((entry) => (
                        <li key={entry.path}>
                          <span>{entry.path}</span>
                          <button
                            className="button button--small"
                            type="button"
                            aria-label={`${entry.path} 내려받기`}
                            onClick={() => { workflow.downloadFile(entry.path); }}
                            disabled={workflow.downloadBlockReason !== '' || workflow.downloadBusy !== null}
                          >
                            내려받기
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="hint" id="download-block-reason">
                      {workflow.downloadBlockReason === ''
                        ? '확정한 그대로의 파일을 내려받습니다. 외부 전달은 직접 하세요.'
                        : workflow.downloadBlockReason}
                    </p>
                  </div>
                )}
            </>
          )}
      </section>
    );
  }

  if (artifact === null) return (
    <section className="draft panel" id="draft-review">
      {syncNotice}
      <p className="status">공유 초안이 있어야 검토할 수 있습니다. 초안 작성 단계에서 먼저 만드세요.</p>
    </section>
  );

  const summary = reviewSummary(artifact);
  return (
    <section className="draft panel" id="draft-review">
      {syncNotice}
      <h3>자동 검토</h3>
      <p className={`status status--${summary.tone}`} data-role="review-summary">{summary.text}</p>
      {artifact.review === null ? null : <ReviewIssues review={artifact.review} />}
      {artifact.humanReview === null
        ? null
        : <p className="hint">{`사람 의미 검토 기록: ${artifact.humanReview.fallbackReason}`}</p>}

      <ReviewSources taskId={workflow.taskId} revision={task?.revision ?? null} />

      <h3>초안 문장</h3>
      <DraftDocumentView draft={artifact.draft} />

      {artifact.files.length === 0
        ? (
          <div className="notice notice--warn" data-role="recompose">
            <p className="status">자동 검토를 통과하지 못해 공개 파일이 아직 없습니다.</p>
            <p className="hint">문서를 고쳐 다시 검토하거나 초안을 새로 만드세요. 공개 결정을 바꿔야 한다면 공개 결정 단계로 돌아가세요.</p>
            <button
              className="button button--solid"
              type="button"
              onClick={workflow.compose}
              disabled={workflow.composeBlockReason !== ''}
            >
              초안 새로 만들기
            </button>
            {workflow.composeBlockReason === '' ? null : <p className="hint">{workflow.composeBlockReason}</p>}
          </div>
        )
        : null}

      <div className="action">
        <button
          className="button"
          type="button"
          onClick={workflow.reReview}
          disabled={workflow.reviewBlockReason !== ''}
          aria-describedby="draft-review-reason"
        >
          다시 검토
        </button>
        <p className="hint" id="draft-review-reason">
          {workflow.reviewBlockReason === '' ? '현재 초안으로 모델 검토를 다시 실행합니다.' : workflow.reviewBlockReason}
        </p>
      </div>

      <details className="fold" id="draft-docast-editor">
        <summary>문서 구조 직접 편집</summary>
        <div className="fold__body">
          <p className="hint">
            허용된 블록의 글, 항목, 사실 참조만 고칠 수 있습니다. 저장하면 새 판본이 만들어지고 자동 검토를 다시 거칩니다. 공개 결정은 바뀌지 않습니다.
          </p>
          <div className="field">
            <label htmlFor="draft-docast">문서 구조(JSON)</label>
            <textarea
              id="draft-docast"
              value={workflow.draftText}
              onChange={(event) => { workflow.setDraftText(event.target.value); }}
              rows={18}
              spellCheck={false}
              aria-invalid={workflow.draftError !== ''}
              aria-describedby="draft-docast-error"
            />
          </div>
          <p className="hint" id="draft-docast-error" aria-live="polite">
            {workflow.draftError === ''
              ? (workflow.draftDirty ? '저장하지 않은 편집이 있습니다.' : '')
              : workflow.draftError}
          </p>
          <div className="action">
            <button
              className="button"
              type="button"
              onClick={workflow.saveEdit}
              disabled={workflow.editBlockReason !== ''}
              aria-describedby="draft-edit-reason"
            >
              편집 저장 후 다시 검토
            </button>
            <p className="hint" id="draft-edit-reason">{workflow.editBlockReason}</p>
          </div>
        </div>
      </details>

      {(humanReviewApplies || artifact.humanReview !== null) && (
        <div className="notice" data-role="human-review">
          <h3>사람 의미 검토</h3>
          {artifact.humanReview !== null
            ? <p className="hint">사람 의미 검토를 기록했습니다. 내용을 고치면 다시 검토해야 합니다.</p>
            : (
              <>
                <p className="hint">
                  모델 연결 실패나 시간 초과로 자동 검토가 끝나지 못했습니다. 직접 확인한 내용을 남기면 확정할 수 있습니다. 판본이나 미결정 후보로 막힌 경우는 이 기록으로 풀리지 않습니다.
                </p>
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
                <p className="hint" id="human-review-reason-hint">무엇을 직접 확인했는지 적습니다.</p>
                <div className="action">
                  <button
                    className="button button--solid"
                    type="button"
                    onClick={workflow.recordHumanReview}
                    disabled={workflow.humanReviewBlockReason !== ''}
                    aria-describedby="human-review-block"
                  >
                    사람 의미 검토 기록
                  </button>
                  <p className="hint" id="human-review-block">{workflow.humanReviewBlockReason}</p>
                </div>
              </>
            )}
        </div>
      )}
    </section>
  );
}

export function EvidencePanel(props: { snapshot: Snapshot | null; workflow: ArtifactsApi }): JSX.Element {
  const { snapshot } = props;
  const candidates = snapshot === null ? [] : orderCandidates(snapshot.candidates);
  const evidenceById = new Map<string, Evidence>();
  if (snapshot !== null) for (const evidence of snapshot.evidence) evidenceById.set(evidence.id, evidence);

  return (
    <details className="block--fold block--fold--internal" id="review-evidence">
      <summary>
        <h2>내부 근거</h2>
        <span className="chip chip--internal">내부용</span>
      </summary>
      <div className="fold__body">
        <p className="hint">공유 파일에는 포함되지 않습니다. 원문은 다시 내려오지 않아 근거 위치만 보여 줍니다.</p>
        {candidates.length === 0
          ? <p className="hint">아직 후보가 없습니다.</p>
          : (
            <ul className="plain-list">
              {candidates.map((candidate) => {
                const linked = (candidate.evidence_ids ?? [])
                  .map((id) => evidenceById.get(id))
                  .filter((evidence): evidence is Evidence => evidence !== undefined);
                const decision = snapshot === null
                  ? undefined
                  : Object.values(snapshot.decisions).find((item) => item.candidate_id === candidate.id && !item.revoked);
                return (
                  <li key={candidate.id}>
                    <p>{candidate.statement}</p>
                    <p className="hint">
                      {`${kindLabel(candidate.kind)} · ${candidate.required ? '필수' : '선택'} · ${UNCERTAINTY_LABELS[candidate.uncertainty] ?? candidate.uncertainty}`}
                      {decision ? ` · ${DISPOSITION_LABELS[decision.disposition]}` : ''}
                    </p>
                    <p className="hint">
                      {linked.length === 0
                        ? '연결된 근거가 없습니다.'
                        : `근거 ${linked.length.toString()}개: ${linked.map((evidence) => {
                          const locator = evidence.locator;
                          if (locator.column !== undefined && locator.row !== undefined) return `${locator.column} 열 ${locator.row.toString()}행`;
                          if (locator.pointer !== undefined) return locator.pointer;
                          return `${evidence.start.toString()}–${evidence.end.toString()}바이트`;
                        }).join(' · ')}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </details>
  );
}
