// 전체 적용(결정 배치) 영역. 범위 축소 동의 대상은 지금 제외한 필수 후보의 실제 ID·문장만 보여준다.

import type { JSX } from 'react';

import type { Disposition, Snapshot } from '../disclosure-state.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';
import { purposeName } from '../disclosure-format.ts';

export function DisclosureBatch(props: { workspace: DisclosuresApi; snapshot: Snapshot; uid: string }): JSX.Element {
  const { workspace, snapshot, uid } = props;
  const counts: Record<Disposition | 'none', number> = { allow: 0, exclude: 0, defer: 0, none: 0 };
  for (const candidate of snapshot.candidates) {
    const disposition = workspace.drafts.get(candidate.id)?.disposition ?? null;
    if (disposition) counts[disposition] += 1;
    else counts.none += 1;
  }
  const scopeId = `${uid}-scope-reduction`;
  const excludedRequired = snapshot.candidates.filter(candidate =>
    candidate.required && workspace.drafts.get(candidate.id)?.disposition === 'exclude');
  const purpose = purposeName(snapshot.scope);
  const blocked = workspace.batchBlockReason;
  const purposeRequired = purpose
    ? `현재 작업 목적 ${purpose}에 필요한 필수 후보도`
    : '현재 목적에 필요한 필수 후보도';
  const condition = workspace.canGenerate
    ? `공개 초안 생성 조건: 충족 — 유효하게 저장된 공개 허용 결정이 최소 1개 있고, ${purposeRequired} 모두 유효한 허용으로 저장되어 있습니다. 아래 작성·파일 확인 구역에서 공유 초안을 만들 수 있습니다.`
    : `공개 초안 생성 조건: 미충족 — 저장된 공개 허용 결정이 최소 1개 있어야 하고, ${purposeRequired} 모두 유효한 허용으로 저장되어야 합니다. 아직 저장하지 않은 선택·미리보기와 제외·보류·미선택은 이 조건을 채우지 않으므로 빈 공유 문서를 완료로 보지 않습니다.`;
  return (
    <section className="batch">
      <h3>전체 적용(결정 배치)</h3>
      <p className="status">
        {`후보 ${snapshot.candidates.length}개 · 허용 ${counts.allow} · 제외 ${counts.exclude} · 보류 ${counts.defer} · 미선택 ${counts.none}`}
      </p>
      <div className="option">
        <input
          type="checkbox"
          id={scopeId}
          checked={workspace.acceptScopeReduction}
          data-focus-key="scope-reduction"
          aria-describedby={`${scopeId}-help`}
          onChange={event => workspace.setScopeReduction(event.currentTarget.checked)}
        />
        <label htmlFor={scopeId}>필수 후보를 제외해 범위를 줄이는 데 동의합니다.</label>
      </div>
      {/* 동의 대상은 지금 제외한 필수 후보의 실제 ID·문장이다. 후보별 긴 안내와 달리 이 목록은 동의 대상만 보여준다. */}
      <div className="scope-reduction__detail" id={`${scopeId}-help`} data-role="scope-reduction-detail">
        <p className="meta">{`현재 작업 목적: ${purpose || 'task 응답에 목적 없음'}`}</p>
        {excludedRequired.length === 0
          ? <p className="hint">제외한 필수 후보가 없습니다. 이 상태에서는 범위 축소 동의가 필요하지 않습니다.</p>
          : (
            <>
              <p className="hint">{`동의 대상: 이번 결과에서 제외하는 필수 후보 ${excludedRequired.length}개`}</p>
              <ul className="scope-reduction__list">
                {excludedRequired.map(candidate => (
                  <li key={candidate.id}>{`후보 ID ${candidate.id} — “${candidate.statement}”`}</li>
                ))}
              </ul>
              <p className="hint">이 필수 후보들을 이번 공유 결과에서 빼는 결정을 저장하려면 동의가 필요합니다.</p>
            </>
          )}
      </div>
      <div className="action">
        <button
          className="button button--solid"
          type="button"
          data-role="apply"
          disabled={blocked !== '' || workspace.busy}
          aria-describedby={`${uid}-apply-reason`}
          onClick={() => { void workspace.apply(); }}
        >
          전체 적용
        </button>
        <p className="hint" id={`${uid}-apply-reason`} data-role="apply-reason">
          {blocked || '한 배치로 모든 후보 결정을 저장할 수 있습니다.'}
        </p>
      </div>
      <p className="hint">
        결정은 한 번의 요청(최대 30개)으로 보냅니다. 하나라도 거부되면 배치 전체가 반영되지 않습니다.
      </p>
      <p className="hint">{condition}</p>
    </section>
  );
}
