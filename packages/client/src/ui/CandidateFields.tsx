// C(선택 필드)의 필드 목록과 체크박스. 목록은 서버 GET 응답이 정본이고 화면은 그대로 그린다.
// 선택은 필드 이름을 key로 두는 map이라 빈 JSON pointer("")도 잃지 않는다.

import type { JSX } from 'react';

import type { Candidate, Draft } from '../disclosure-state.ts';
import { SELECTED_FIELDS_TRANSFORM } from '../disclosure-contract.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';

export function CandidateFields(props: {
  workspace: DisclosuresApi;
  candidate: Candidate;
  draft: Draft;
  uid: string;
  token: string;
}): JSX.Element {
  const { workspace, candidate, draft, uid, token } = props;
  const entry = workspace.fields.get(candidate.id) ?? null;
  const selected = entry ? entry.fields.filter(field => draft.selection.get(field) === true) : [];
  const listId = `${uid}-fields-${token}`;
  return (
    <div className="custom" data-role="field-list" data-candidate-id={candidate.id}>
      <h3>공개할 필드</h3>
      <p className="hint" id={listId}>
        서버가 후보 근거에서 뽑은 필드 목록입니다. 고른 필드의 값만 남기며, 표현은 {SELECTED_FIELDS_TRANSFORM}입니다.
        목록은 화면에서 만들지 않고 서버 응답을 그대로 씁니다.
      </p>
      {entry === null
        ? (
          <p className="status" role="status" aria-live="polite">
            필드 목록을 불러오지 않았습니다.
          </p>
        )
        : entry.status === 'loading'
          ? (
            <p className="status" role="status" aria-live="polite" aria-busy="true">
              필드 목록을 불러오는 중입니다.
            </p>
          )
          : entry.status === 'failed'
            ? (
              <p className="status" role="status" aria-live="polite" data-role="field-error">
                {entry.message}
              </p>
            )
            : null}
      {entry !== null && entry.status === 'ready'
        ? (
          <>
            <fieldset className="candidate__mode">
              <legend>{`선택 가능한 필드 ${entry.fields.length}개 · 입력 revision ${entry.inputRevision ?? '-'}`}</legend>
              {entry.fields.map((field, index) => {
                const id = `${listId}-${index}`;
                return (
                  <div className="option" key={id}>
                    <input
                      type="checkbox"
                      id={id}
                      checked={draft.selection.get(field) === true}
                      data-role="field"
                      data-field={field}
                      aria-describedby={listId}
                      onChange={event => workspace.toggleField(candidate.id, field, event.currentTarget.checked)}
                    />
                    <label htmlFor={id}>{field === '' ? '(빈 JSON pointer · 문서 루트)' : field}</label>
                  </div>
                );
              })}
            </fieldset>
            <p className="status" role="status" aria-live="polite" data-role="field-selection">
              {`선택 ${selected.length}개${selected.length === 0 ? ' · 하나 이상 골라야 미리보기를 만들 수 있습니다.' : ''}`}
            </p>
          </>
        )
        : null}
      <div className="action">
        <button
          className="button"
          type="button"
          data-role="load-fields"
          data-candidate-id={candidate.id}
          disabled={workspace.busy || (entry !== null && entry.status === 'loading')}
          aria-describedby={listId}
          onClick={() => { void workspace.loadFields(candidate.id); }}
        >
          필드 목록 다시 불러오기
        </button>
      </div>
      <p className="hint">
        {`선택 필드 표현은 재사용 기준으로 저장할 수 없습니다(서버가 재사용 불가로 표시). 필드 수 상한은 1~100개이며, 목록 revision이 현재 작업과 다르면 선택과 미리보기를 버리고 작업을 다시 조회합니다.`}
      </p>
      {draft.message ? <p className="hint">{draft.message}</p> : null}
    </div>
  );
}
