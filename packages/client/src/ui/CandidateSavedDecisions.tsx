// 후보에 이미 저장된 결정 목록과 철회 동작. 철회 성공 여부는 서버 응답 뒤 task 재조회로만 확인한다.

import type { JSX } from 'react';

import type { Candidate, SavedDecision, Snapshot } from '../disclosure-state.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';
import { DISPOSITION_LABELS, representationLabel } from '../disclosure-format.ts';

function decisionMeta(decision: SavedDecision): string {
  const parts = [
    `표현 ${representationLabel(decision.representation)}`,
    `projection_sha256 ${decision.projection_sha256}`,
    `만료 ${decision.expires_at ?? '없음'}`,
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
}): JSX.Element {
  const { workspace, snapshot, candidate, writeReason, uid } = props;
  const decisions = Object.values(snapshot.decisions)
    .filter(decision => decision.candidate_id === candidate.id);
  return (
    <div className="candidate__decisions">
      <h3>{`저장된 결정 (${decisions.length})`}</h3>
      {decisions.length === 0
        ? <p className="hint">저장된 결정이 없습니다.</p>
        : decisions.map(decision => (
          <div className="decision" key={decision.id}>
            <p className="status">
              {`${DISPOSITION_LABELS[decision.disposition]} · ${decision.revoked ? '철회됨' : '유효'} · 결정 ${decision.id}`}
            </p>
            <p className="hint">{decisionMeta(decision)}</p>
            <button
              className="button"
              type="button"
              data-role="revoke"
              data-decision-id={decision.id}
              disabled={decision.revoked || Boolean(writeReason) || workspace.busy}
              aria-describedby={`${uid}-write-note`}
              onClick={() => { void workspace.revoke(decision.id); }}
            >
              결정 철회
            </button>
            {writeReason
              ? <p className="hint">{`쓰기 차단: ${writeReason}`}</p>
              : decision.revoked
                ? <p className="hint">이미 철회된 결정입니다. 과거 허용이 자동으로 되살아나지는 않습니다.</p>
                : <p className="hint">철회는 단일 요청이며 성공 뒤 task를 다시 조회해 확인합니다.</p>}
          </div>
        ))}
    </div>
  );
}
