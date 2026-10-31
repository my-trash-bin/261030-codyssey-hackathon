// 후보별 결정 선택과, 필수 후보를 제외할 때의 범위 축소 안내.
// 제외 취소 버튼은 자기 자신을 지우는 동작이므로, 사라진 뒤 같은 후보의 제외 라디오로 초점을 되돌릴 키를 남긴다.

import type { JSX } from 'react';

import type { Candidate, Disposition, Draft, Snapshot } from '../disclosure-state.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';
import { purposeName } from '../disclosure-format.ts';

function RequiredExclude(props: {
  workspace: DisclosuresApi;
  snapshot: Snapshot;
  candidate: Candidate;
  noticeId: string;
  setFocusFallback: (key: string) => void;
}): JSX.Element {
  const { workspace, snapshot, candidate, noticeId, setFocusFallback } = props;
  const purpose = purposeName(snapshot.scope);
  const target = purpose
    ? `현재 작업 목적 ${purpose}의 공유 결과와 근거에서`
    : 'task 응답에 목적이 없어 목적을 표시할 수 없지만, 이번 공유 결과와 근거에서';
  const cancelHelpId = `${noticeId}-cancel-help`;
  return (
    <div className="required-exclude" id={noticeId} data-role="required-exclude" data-candidate-id={candidate.id}>
      <p className="status">
        {`필수 후보를 이번 결과에서 제외합니다. ${target} 다음 정보가 빠집니다: “${candidate.statement}”`}
      </p>
      <p className="hint">
        이 정보가 필수로 분류된 구체적인 이유는 제공되지 않았습니다. 위의 근거를 확인하고, 정보를 빼고 공유하려면 아래에서 범위 축소에 동의하세요.
      </p>
      <p className="hint">
        제외를 유지하면 아래 전체 적용의 범위 축소 동의로 이 결정을 그대로 저장할 수 있습니다.
      </p>
      <button
        className="button"
        type="button"
        data-role="exclude-cancel"
        data-candidate-id={candidate.id}
        data-focus-key={`exclude-cancel:${candidate.id}`}
        aria-describedby={cancelHelpId}
        onClick={() => {
          // 버튼이 사라진 뒤 같은 후보의 제외 라디오로 초점을 되돌린다.
          setFocusFallback(`disposition:${candidate.id}:exclude`);
          workspace.chooseDisposition(candidate.id, null);
        }}
      >
        제외 취소
      </button>
      <p className="hint" id={cancelHelpId}>
        제외 취소는 이 후보를 미선택으로 되돌립니다. 미선택은 허용으로 자동 선택되지 않으며, 제외한 필수 후보 목록과 범위 축소 동의 대상에서도 빠집니다.
      </p>
    </div>
  );
}

export function CandidateDisposition(props: {
  workspace: DisclosuresApi;
  snapshot: Snapshot;
  candidate: Candidate;
  draft: Draft;
  uid: string;
  token: string;
  setFocusFallback: (key: string) => void;
}): JSX.Element {
  const { workspace, snapshot, candidate, draft, uid, token, setFocusFallback } = props;
  const options: { value: Disposition | null; label: string; note: string }[] = [
    { value: null, label: '아직 결정하지 않음', note: '결정을 저장하지 않습니다.' },
    {
      value: 'allow',
      label: '허용 — 미리보기를 승인해 포함',
      note: '표현을 고르고 미리보기를 만든 뒤에만 배치에 넣을 수 있습니다.',
    },
    { value: 'exclude', label: '이번 결과에서 제외', note: '이 후보의 내용은 공유 결과에 포함하지 않습니다.' },
    { value: 'defer', label: '나중에 결정', note: '보류로 저장하고 이번 결과에는 포함하지 않습니다.' },
  ];
  const groupName = `${uid}-disposition-${token}`;
  const requiredNoticeId = `${uid}-required-exclude-${token}`;
  const showRequiredNotice = draft.disposition === 'exclude' && candidate.required;
  return (
    <fieldset className="candidate__disposition">
      <legend>결정</legend>
      <p className="hint">
        기본 상태는 허용 미선택입니다. 고르지 않은 후보는 배치에서 빠집니다.
      </p>
      {options.map(option => {
        const key = option.value ?? 'none';
        const id = `${groupName}-${key}`;
        return (
          <div className="option" key={key}>
            <input
              type="radio"
              name={groupName}
              id={id}
              value={key}
              checked={draft.disposition === option.value}
              data-focus-key={`disposition:${candidate.id}:${key}`}
              aria-describedby={option.value === 'exclude' && showRequiredNotice ? requiredNoticeId : undefined}
              onChange={event => {
                if (!event.currentTarget.checked) return;
                workspace.chooseDisposition(candidate.id, option.value);
              }}
            />
            <label htmlFor={id}>{`${option.label} — ${option.note}`}</label>
          </div>
        );
      })}
      {showRequiredNotice
        ? (
          <RequiredExclude
            workspace={workspace}
            snapshot={snapshot}
            candidate={candidate}
            noticeId={requiredNoticeId}
            setFocusFallback={setFocusFallback}
          />
        )
        : null}
    </fieldset>
  );
}
