// 공개 결정 화면. 후보별 결정 → 결정 저장 순서로 그린다. 작업은 1단계에서 고른 것을 그대로 쓴다.
// 상태·전송은 useDisclosures 훅이 맡고, 이 컴포넌트는 표시와 입력만 담당한다.

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import type { Snapshot } from '../disclosure-state.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';
import { orderCandidates, scopeSummary, writeNoteText } from '../disclosure-format.ts';
import type { ScopeNames } from '../disclosure-format.ts';
import { validSavedDecisions } from '../disclosure-selectors.ts';
import { CandidateCard } from './CandidateCard.tsx';
import { DisclosureBatch } from './DisclosureBatch.tsx';
import { useFocusFallback } from './hooks/useFocusFallback.ts';

let mountCounter = 0;

function Summary(props: { workspace: DisclosuresApi; snapshot: Snapshot; names: ScopeNames | null }): JSX.Element {
  const { workspace, snapshot, names } = props;
  return (
    <div className="disclosures__summary">
      <p className="hint">{scopeSummary(snapshot.scope, names)}</p>
      <button
        className="button button--small"
        type="button"
        data-role="reload"
        disabled={workspace.busy}
        onClick={() => { void workspace.loadTask(snapshot.id); }}
      >
        다시 불러오기
      </button>
    </div>
  );
}

export function DisclosuresSection(props: { workspace: DisclosuresApi; taskId: string | null; names: ScopeNames | null }): JSX.Element {
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

  function candidateToken(id: string): string {
    const existing = candidateTokens.current.get(id);
    if (existing !== undefined) return existing;
    const token = `c${candidateTokens.current.size + 1}`;
    candidateTokens.current.set(id, token);
    return token;
  }

  // 작업 흐름에서 이미 고른 작업은 다시 입력받지 않는다. 바뀔 때만 서버에서 읽는다.
  useEffect(() => {
    const id = props.taskId;
    if (id === null || id === '') return;
    if (workspace.snapshot?.id === id) return;
    void workspace.loadTask(id);
  }, [props.taskId]);

  const writeReason = workspace.writeBlockReason;
  const snapshot = workspace.snapshot;
  const writeNoteId = `${uid}-write-note`;
  const saved = snapshot === null ? new Map() : validSavedDecisions(snapshot);

  return (
    <div className="block" ref={containerRef}>
      <div className="disclosures">
        <p className="status" role="status" aria-live="polite" data-role="message" hidden={workspace.message === ''}>
          {workspace.message}
        </p>
        {/* 다른 버튼의 aria-describedby 대상이라 차단 사유가 없어도 요소는 남긴다. */}
        <p className="hint" id={writeNoteId} data-role="write-note" hidden={!writeReason}>
          {writeNoteText(writeReason)}
        </p>
        {!snapshot
          ? <p className="status">아직 고른 작업이 없습니다. 1단계에서 작업을 고르거나 만드세요.</p>
          : (
            <>
              <Summary workspace={workspace} snapshot={snapshot} names={props.names} />
              {snapshot.candidates.length === 0
                ? <p className="status">이 작업에는 후보가 없습니다. 2단계에서 자료를 분석하거나 수동 후보를 추가하세요.</p>
                : (
                  <div className="candidates">
                    {orderCandidates(snapshot.candidates).map((candidate, index) => (
                      <CandidateCard
                        key={candidate.id}
                        workspace={workspace}
                        snapshot={snapshot}
                        candidate={candidate}
                        index={index}
                        saved={saved.get(candidate.id)}
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
