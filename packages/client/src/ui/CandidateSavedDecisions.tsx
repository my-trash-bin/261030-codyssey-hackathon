// 후보에 이미 저장된 결정 목록과 철회 동작. 철회 성공 여부는 서버 응답 뒤 task 재조회로만 확인한다.
// 평소에는 철회 버튼만 보이고, 결정 기록과 식별자는 접어 둔다.

import type { JSX } from 'react';

import type { Candidate, SavedDecision, Snapshot } from '../disclosure-state.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';
import { DISPOSITION_LABELS, representationLabel } from '../disclosure-format.ts';

function decisionMeta(decision: SavedDecision): string {
  const parts = [
    `표현 ${representationLabel(decision.representation)}`,
    `만료 ${decision.expires_at ?? '없음'}`,
    `결정 ID ${decision.id}`,
    `미리보기 해시 ${decision.projection_sha256}`,
  ];
  if (decision.supersedes_id) parts.push(`대체한 결정 ${decision.supersedes_id}`);
  return parts.join(' · ');
}

export function CandidateSavedDecisions(props: {
  workspace: DisclosuresApi;
  snapshot: Snapshot;
  candidate: Candidate;
  writeReason: string;
  uid: string;
}): JSX.Element | null {
  const { workspace, snapshot, candidate, writeReason, uid } = props;
  const decisions = Object.values(snapshot.decisions)
    .filter(decision => decision.candidate_id === candidate.id);
  if (decisions.length === 0) return null;
  const live = decisions.filter(decision => !decision.revoked);
  return (
    <div className="candidate__decisions">
      {live.map(decision => (
        <button
          className="button button--small"
          type="button"
          key={decision.id}
          data-role="revoke"
          data-decision-id={decision.id}
          disabled={Boolean(writeReason) || workspace.busy}
          aria-describedby={`${uid}-write-note`}
          onClick={() => { void workspace.revoke(decision.id); }}
        >
          저장된 결정 철회
        </button>
      ))}
      <details className="fold fold--plain">
        <summary>{`결정 기록 ${decisions.length}건`}</summary>
        <div className="fold__body">
          {decisions.map(decision => (
            <div className="decision" key={decision.id}>
              <p className="status">{`${DISPOSITION_LABELS[decision.disposition]} · ${decision.revoked ? '철회됨' : '유효'}`}</p>
              <p className="hint">{decisionMeta(decision)}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
