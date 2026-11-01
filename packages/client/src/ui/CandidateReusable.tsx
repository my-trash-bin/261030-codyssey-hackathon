// 재사용 기준 저장 체크박스. 정확한 값·승인 발췌·선택 필드 표현은 저장할 수 없다.

import type { JSX } from 'react';

import type { Candidate, Draft } from '../disclosure-state.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';
import { REUSABLE_FORBIDDEN } from '../disclosure-format.ts';

export function CandidateReusable(props: {
  workspace: DisclosuresApi;
  candidate: Candidate;
  draft: Draft;
  uid: string;
  token: string;
}): JSX.Element {
  const { workspace, candidate, draft, uid, token } = props;
  const kind = draft.representation?.kind ?? null;
  const forbidden = kind !== null && REUSABLE_FORBIDDEN.includes(kind);
  const id = `${uid}-reusable-${token}`;
  return (
    <div className="candidate__reusable">
      <div className="option">
        <input
          type="checkbox"
          id={id}
          checked={draft.reusable && !forbidden}
          disabled={forbidden || !draft.representation}
          data-focus-key={`reusable:${candidate.id}`}
          aria-describedby={`${id}-help`}
          onChange={event => workspace.setReusable(candidate.id, event.currentTarget.checked)}
        />
        <label htmlFor={id}>재사용 기준으로 저장</label>
      </div>
      <p className="hint" id={`${id}-help`}>
        {forbidden
          ? '이 표현(정확한 값·승인 발췌·선택 필드)은 재사용 기준으로 저장할 수 없습니다.'
          : draft.representation
            ? '결정을 저장할 때 함께 저장합니다.'
            : '표현 방식을 먼저 고르세요.'}
      </p>
    </div>
  );
}
