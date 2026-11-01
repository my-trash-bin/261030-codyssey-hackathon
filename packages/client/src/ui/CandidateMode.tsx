// 표현 방식 선택과 조건 해석. A·B를 고르면 곧바로 미리보기를 요청하고(결정 저장 아님),
// D는 조건 해석이 지원된 뒤에만, C는 서버 필드 목록에서 필드를 고른 뒤에 미리보기를 만든다.

import { Fragment } from 'react';
import type { JSX } from 'react';

import { seriesBlockReason } from '../disclosure-state.ts';
import type { Candidate, Draft, Mode } from '../disclosure-state.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';
import { MODE_LABELS, interpretationText } from '../disclosure-format.ts';
import { CandidateFields } from './CandidateFields.tsx';

export function CandidateMode(props: {
  workspace: DisclosuresApi;
  candidate: Candidate;
  draft: Draft;
  uid: string;
  token: string;
}): JSX.Element {
  const { workspace, candidate, draft, uid, token } = props;
  // 표현 선택 자체는 미리보기 요청이다. 결정 저장은 하지 않는다.
  const canRequest = workspace.writeBlockReason === '';
  const reasons: Partial<Record<Mode, string>> = {};
  // 서버 계열 변환과 같은 조건: 한 CSV 자료의 같은 열·서로 다른 행 셀 근거.
  const seriesReason = seriesBlockReason(candidate, workspace.snapshot?.evidence ?? []);
  if (seriesReason !== '') reasons.B = seriesReason;
  const groupName = `${uid}-mode-${token}`;
  return (
    <fieldset className="candidate__mode">
      <legend>표현 방식</legend>
      {canRequest ? null : <p className="hint">{workspace.writeBlockReason}</p>}
      {(['A', 'B', 'C', 'D'] as Mode[]).map(mode => {
        const reason = reasons[mode];
        const id = `${groupName}-${mode}`;
        return (
          <Fragment key={mode}>
            <div className="option">
              <input
                type="radio"
                name={groupName}
                id={id}
                value={mode}
                checked={draft.mode === mode}
                disabled={Boolean(reason)}
                data-role="representation-mode"
                data-mode={mode}
                data-candidate-id={candidate.id}
                data-focus-key={`mode:${candidate.id}:${mode}`}
                aria-describedby={reason ? `${id}-reason` : undefined}
                onChange={event => {
                  if (!event.currentTarget.checked) return;
                  // 방금 고른 초안을 그대로 넘겨 렌더 지연 없이 미리보기를 요청한다.
                  const chosen = workspace.chooseMode(candidate.id, mode);
                  if (mode !== 'A' && mode !== 'B') return;
                  if (!chosen?.representation) return;
                  if (workspace.writeBlockReason !== '') return;
                  void workspace.preview(candidate.id, chosen);
                }}
              />
              <label htmlFor={id}>{MODE_LABELS[mode]}</label>
            </div>
            {reason ? <p className="hint" id={`${id}-reason`}>{reason}</p> : null}
          </Fragment>
        );
      })}
      {draft.mode === 'C'
        ? (
          <CandidateFields
            workspace={workspace}
            candidate={candidate}
            draft={draft}
            uid={uid}
            token={token}
          />
        )
        : null}
    </fieldset>
  );
}

export function CandidateCondition(props: {
  workspace: DisclosuresApi;
  candidate: Candidate;
  draft: Draft;
  writeReason: string;
  uid: string;
  token: string;
}): JSX.Element {
  const { workspace, candidate, draft, writeReason, uid, token } = props;
  const textareaId = `${uid}-condition-${token}`;
  return (
    <div className="custom">
      <div className="field">
        <label htmlFor={textareaId}>직접 입력 조건</label>
        <textarea
          id={textareaId}
          rows={4}
          value={draft.condition}
          data-focus-key={`condition:${candidate.id}`}
          aria-describedby={`${textareaId}-help`}
          onChange={event => workspace.setCondition(candidate.id, event.currentTarget.value)}
        />
      </div>
      <p className="hint" id={`${textareaId}-help`}>
        조건을 바꾸면 해석과 미리보기를 다시 해야 합니다. 이 문장 자체는 공개 승인이 아닙니다.
      </p>
      <div className="action">
        <button
          className="button"
          type="button"
          data-role="interpret"
          data-candidate-id={candidate.id}
          disabled={Boolean(writeReason) || workspace.busy || !draft.condition.trim()}
          aria-describedby={`${uid}-write-note`}
          onClick={() => { void workspace.interpret(candidate.id); }}
        >
          조건 해석 요청
        </button>
        {draft.jobId && (draft.jobStatus === 'queued' || draft.jobStatus === 'running')
          ? (
            <button
              className="button"
              type="button"
              data-role="refresh-interpretation"
              data-candidate-id={candidate.id}
              disabled={Boolean(writeReason) || workspace.busy}
              aria-describedby={`${uid}-write-note`}
              onClick={() => { void workspace.refreshInterpretation(candidate.id); }}
            >
              해석 결과 조회
            </button>
          )
          : null}
      </div>
      <p className="hint">
        {writeReason || (draft.condition.trim() ? '해석 결과는 자동으로 갱신되지 않습니다. 끝나면 해석 결과 조회를 누르세요.' : '조건을 입력하세요.')}
      </p>
      <p className="status" role="status" aria-live="polite" data-role="interpretation" data-candidate-id={candidate.id}>
        {interpretationText(draft)}
      </p>
      {draft.message ? <p className="hint">{draft.message}</p> : null}
    </div>
  );
}
