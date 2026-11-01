// 현재 선택을 한 번에 저장한다. 제외할 필수 정보는 적용 전에 표시한다.

import type { JSX } from 'react';

import type { Disposition, Snapshot } from '../disclosure-state.ts';
import { validSavedDecisions } from '../disclosure-selectors.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';

export function DisclosureBatch(props: { workspace: DisclosuresApi; snapshot: Snapshot; uid: string }): JSX.Element {
  const { workspace, snapshot, uid } = props;
  const chosen: Record<Disposition, number> = { allow: 0, exclude: 0, defer: 0 };
  for (const candidate of snapshot.candidates) {
    const disposition = workspace.drafts.get(candidate.id)?.disposition ?? null;
    if (disposition) chosen[disposition] += 1;
  }
  const saved: Record<Disposition, number> = { allow: 0, exclude: 0, defer: 0 };
  for (const decision of validSavedDecisions(snapshot).values()) saved[decision.disposition] += 1;
  const chosenTotal = chosen.allow + chosen.exclude + chosen.defer;
  const savedTotal = saved.allow + saved.exclude + saved.defer;
  const excludedRequired = snapshot.candidates.filter(candidate =>
    candidate.required && workspace.drafts.get(candidate.id)?.disposition === 'exclude');
  const blocked = workspace.batchBlockReason;
  const reason = chosenTotal === 0 && savedTotal > 0 ? '저장된 결정을 바꾸려면 후보의 결정 바꾸기·철회를 여세요.' : blocked;
  return (
    <section className="batch">
      <h3>결정 저장</h3>
      <p className="status" data-role="batch-counts">
        {`후보 ${snapshot.candidates.length}개 · 저장됨 허용 ${saved.allow} · 제외 ${saved.exclude} · 보류 ${saved.defer}`}
        {chosenTotal > 0 ? ` · 이번에 저장할 결정 ${chosenTotal}개` : ''}
      </p>
      {excludedRequired.length === 0
        ? null
        : (
          <div className="notice notice--warn" data-role="scope-reduction-detail">
            <ul className="plain-list">
              {excludedRequired.map(candidate => <li key={candidate.id}>{candidate.statement}</li>)}
            </ul>
          </div>
        )}
      <div className="action">
        <button
          className="button button--solid"
          type="button"
          data-role="apply"
          disabled={blocked !== '' || workspace.busy}
          aria-describedby={`${uid}-apply-reason`}
          onClick={() => { void workspace.apply(); }}
        >
          {chosenTotal > 0 ? `결정 ${chosenTotal}개 저장` : '결정 저장'}
        </button>
        <p className="hint" id={`${uid}-apply-reason`} data-role="apply-reason">
          {reason || '저장은 한 번에 처리됩니다. 하나라도 거부되면 아무것도 저장되지 않습니다.'}
        </p>
      </div>
      <p className="hint" data-role="generate-condition">
        {workspace.canGenerate
          ? '초안을 만들 수 있습니다. 다음 단계로 이동하세요.'
          : '초안을 만들려면 허용 결정이 1개 이상 있고 필수 후보가 모두 허용으로 저장돼야 합니다.'}
      </p>
    </section>
  );
}
