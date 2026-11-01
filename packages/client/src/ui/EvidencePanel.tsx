import type { JSX } from 'react';
import type { Evidence, Snapshot } from '../disclosure-contract.ts';
import { DISPOSITION_LABELS, kindLabel, orderCandidates, UNCERTAINTY_LABELS } from '../disclosure-format.ts';
import type { ArtifactsApi } from './hooks/useArtifacts.ts';

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
