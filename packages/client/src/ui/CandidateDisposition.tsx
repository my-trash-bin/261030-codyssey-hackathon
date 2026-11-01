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
    ? `${purpose} 공유 결과에서`
    : '이번 공유 결과에서';
  const cancelHelpId = `${noticeId}-cancel-help`;
  return (
    <div className="required-exclude" id={noticeId} data-role="required-exclude" data-candidate-id={candidate.id}>
      <p className="status">{`필수 후보를 제외합니다. ${target} 이 정보가 빠집니다.`}</p>
      <p className="hint">제외를 유지하려면 아래 결정 저장에서 범위 축소에 동의하세요. 필수 후보를 제외하면 초안을 만들 수 없습니다.</p>
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
      <p className="hint" id={cancelHelpId}>이 후보를 미선택으로 되돌립니다. 허용으로 자동 선택되지는 않습니다.</p>
    </div>
  );
}

export function CandidateDisposition(props: {
  workspace: DisclosuresApi;
  snapshot: Snapshot;
  candidate: Candidate;
  draft: Draft;
  saved: boolean;
  uid: string;
  token: string;
  setFocusFallback: (key: string) => void;
}): JSX.Element {
  const { workspace, snapshot, candidate, draft, saved, uid, token, setFocusFallback } = props;
  const options: { value: Disposition | null; label: string; note: string }[] = [
    saved
      ? { value: null, label: '바꾸지 않음', note: '저장된 결정을 그대로 둡니다.' }
      : { value: null, label: '아직 결정하지 않음', note: '이번 저장에서 뺍니다.' },
    {
      value: 'allow',
      label: '허용',
      note: '표현을 고르고 미리보기를 확인한 뒤 공유 결과에 넣습니다.',
    },
    { value: 'exclude', label: '이번 결과에서 제외', note: '공유 결과에 넣지 않습니다.' },
    { value: 'defer', label: '나중에 결정(보류)', note: '초안은 만들 수 있지만, 최종 확정 전에 허용이나 제외로 바꿔야 합니다.' },
  ];
  const groupName = `${uid}-disposition-${token}`;
  const requiredNoticeId = `${uid}-required-exclude-${token}`;
  const showRequiredNotice = draft.disposition === 'exclude' && candidate.required;
  return (
    <fieldset className="candidate__disposition">
      <legend>결정</legend>
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
            <label htmlFor={id}>
              <span className="option__label">{option.label}</span>
              <span className="option__note">{option.note}</span>
            </label>
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
