// 공개 결정 화면. 작업 ID 조회 → 후보별 결정 → 전체 적용 순서로 그린다.
// 상태·전송은 useDisclosures 훅이 맡고, 이 컴포넌트는 표시와 입력만 담당한다.

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';

import type { Snapshot } from '../disclosure-state.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';
import { scopeSummary, writeNoteText } from '../disclosure-format.ts';
import { CandidateCard } from './CandidateCard.tsx';
import { DisclosureBatch } from './DisclosureBatch.tsx';
import { useFocusFallback } from './hooks/useFocusFallback.ts';

let mountCounter = 0;

function Summary(props: { workspace: DisclosuresApi; snapshot: Snapshot }): JSX.Element {
  const { workspace, snapshot } = props;
  return (
    <div className="disclosures__summary">
      <h3>조회한 작업</h3>
      <p className="status">
        {`작업 ${snapshot.id} · revision ${snapshot.revision} · 후보 ${snapshot.candidates.length}개`}
      </p>
      <p className="hint">{`범위: ${scopeSummary(snapshot.scope)}`}</p>
      <button
        className="button"
        type="button"
        data-role="reload"
        disabled={workspace.busy}
        onClick={() => { void workspace.loadTask(snapshot.id); }}
      >
        작업 다시 조회
      </button>
    </div>
  );
}

export function DisclosuresSection(props: { workspace: DisclosuresApi; taskId: string | null }): JSX.Element {
  const { workspace } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 상태 변경으로 버튼이 사라질 때 되돌릴 초점 key. useFocusFallback이 렌더 뒤 한 번만 쓴다.
  const focusFallbackKey = useRef<string | null>(null);
  useFocusFallback(containerRef, focusFallbackKey);

  const [uid] = useState(() => {
    mountCounter += 1;
    return `disclosures-${mountCounter}`;
  });
  // 후보 ID는 임의 문자열이므로 HTML id·radio name에 그대로 쓰지 않고 화면 안에서만 쓰는 토큰으로 바꾼다.
  const candidateTokens = useRef(new Map<string, string>());
  const [taskId, setTaskId] = useState(props.taskId ?? '');
  const [localLookupError, setLocalLookupError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  function candidateToken(id: string): string {
    const existing = candidateTokens.current.get(id);
    if (existing !== undefined) return existing;
    const token = `c${candidateTokens.current.size + 1}`;
    candidateTokens.current.set(id, token);
    return token;
  }

  function submitLookup(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const id = taskId.trim();
    if (!id) {
      setLocalLookupError('작업 ID를 입력하세요. 조회할 ID가 없으면 후보를 표시할 수 없습니다.');
      inputRef.current?.focus();
      return;
    }
    setTaskId(id);
    setLocalLookupError('');
    void workspace.loadTask(id);
  }

  // 작업 흐름에서 이미 고른 작업은 다시 입력받지 않는다. 바뀔 때만 서버에서 읽는다.
  useEffect(() => {
    const id = props.taskId;
    if (id === null || id === '') return;
    setTaskId(id);
    if (workspace.snapshot?.id === id) return;
    void workspace.loadTask(id);
  }, [props.taskId]);

  const message = localLookupError || workspace.message;
  const writeReason = workspace.writeBlockReason;
  const snapshot = workspace.snapshot;
  const hintId = `${uid}-task-hint`;
  const writeNoteId = `${uid}-write-note`;

  return (
    <div className="block" ref={containerRef}>
      <div className="disclosures">
        <h3>후보별 공개 결정</h3>
        <p className="hint">
          후보마다 허용·제외·보류 중 하나를 고르고 한 번에 저장합니다. 미리보기와 결정은 서버가 계산합니다.
        </p>
        <details className="fold">
          <summary>작업 ID로 직접 조회</summary>
          <div className="fold__body">
        <form
          className="disclosures__lookup"
          noValidate
          data-role="lookup"
          aria-busy={workspace.busy ? 'true' : 'false'}
          onSubmit={submitLookup}
        >
          <div className="field">
            <label htmlFor={`${uid}-task`}>작업 ID</label>
            <input
              id={`${uid}-task`}
              ref={inputRef}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={taskId}
              data-focus-key="task-id"
              aria-describedby={hintId}
              aria-invalid={localLookupError ? 'true' : undefined}
              onChange={event => {
                setTaskId(event.currentTarget.value);
                setLocalLookupError('');
              }}
            />
          </div>
          <button className="button" type="submit" disabled={workspace.busy} aria-describedby={hintId}>
            작업 조회
          </button>
          <p className="hint" id={hintId}>
            {'조회는 GET /api/v1/tasks/{id}이며 쓰기 요청이 아닙니다. 응답이 오류면 아래 상태 문구에 그대로 표시합니다.'}
          </p>
        </form>
          </div>
        </details>
        <p className="status" role="status" aria-live="polite" data-role="message">
          {message}
        </p>
        <div className="disclosures__write">
          <p className="hint" id={writeNoteId} data-role="write-note">
            {writeNoteText(writeReason)}
          </p>
          {writeReason
            ? (
              <p className="hint">
                조회(GET)에도 세션이 필요합니다. 쓰기는 인증된 세션과 CSRF 토큰이 모두 있어야 서버에서 처리합니다.
              </p>
            )
            : null}
        </div>
        {!snapshot
          ? (
            <div className="disclosures__empty">
              <p className="status">아직 조회한 작업이 없습니다. 위에 작업 ID를 입력해 조회하세요.</p>
              <p className="hint">
                조회에는 인증된 세션이 필요합니다. API 비활성·미인증·작업 부재는 서버 오류 코드로 구분합니다.
              </p>
            </div>
          )
          : (
            <>
              <Summary workspace={workspace} snapshot={snapshot} />
              {snapshot.candidates.length === 0
                ? (
                  <div className="disclosures__empty">
                    <p className="status">이 작업에는 후보가 없습니다.</p>
                    <p className="hint">
                      자료 분석이 아직 실행되지 않았거나 후보가 설치되지 않았습니다. 후보는 서버만 만들 수 있고 이 화면은 빈 목록을 그대로 표시합니다.
                    </p>
                  </div>
                )
                : (
                  <div className="candidates">
                    {snapshot.candidates.map((candidate, index) => (
                      <CandidateCard
                        key={candidate.id}
                        workspace={workspace}
                        snapshot={snapshot}
                        candidate={candidate}
                        index={index}
                        writeReason={writeReason}
                        uid={uid}
                        token={candidateToken(candidate.id)}
                        setFocusFallback={key => { focusFallbackKey.current = key; }}
                      />
                    ))}
                  </div>
                )}
              <DisclosureBatch workspace={workspace} snapshot={snapshot} uid={uid} />
            </>
          )}
      </div>
    </div>
  );
}
