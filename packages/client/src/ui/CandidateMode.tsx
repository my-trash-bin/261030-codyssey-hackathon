// 표현 방식 선택과 조건 해석. A·B를 고르면 곧바로 미리보기를 요청하고(결정 저장 아님),
// D는 조건 해석이 지원된 뒤에만 미리보기를 만들 수 있다. C는 서버 필드 목록 연결이 없어 차단한다.

import { Fragment } from 'react';
import type { JSX } from 'react';

import type { Candidate, Draft, Mode } from '../disclosure-state.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';
import { MODE_LABELS, kindLabel, representationLabel, interpretationText } from '../disclosure-format.ts';

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
  const reasons: Partial<Record<Mode, string>> = {
    C: 'C(선택 필드)는 이 화면의 서버 필드 목록·선택 연결이 아직 없어 사용할 수 없습니다.',
  };
  if (candidate.kind !== 'series') {
    reasons.B = `이 후보의 종류는 ${kindLabel(candidate.kind)}입니다. B는 series 후보에만 쓸 수 있어 차단합니다.`;
  }
  const groupName = `${uid}-mode-${token}`;
  return (
    <fieldset className="candidate__mode">
      <legend>표현 방식</legend>
      <p className="hint">
        {canRequest
          ? 'A·B를 고르면 서버에 미리보기를 요청합니다(결정 저장 아님). D는 조건 해석이 지원된 뒤에, C는 차단 상태라 요청하지 않습니다.'
          : 'A·B를 고르면 표현만 정해집니다. 지금은 쓰기 차단 사유가 있어 미리보기를 요청하지 않으며, D도 해석이 지원된 뒤에만 요청할 수 있습니다.'}
      </p>
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
      {draft.mode === 'D' && draft.interpretation !== 'supported'
        ? (
          <p className="hint">
            D는 조건 해석이 지원(supported)으로 끝나야 미리보기를 만들 수 있습니다.
          </p>
        )
        : null}
      {draft.representation
        ? (
          <p className="meta" data-role="representation" data-candidate-id={candidate.id}>
            {`선택된 표현: ${representationLabel(draft.representation)}`}
          </p>
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
        조건을 바꾸면 기존 해석과 미리보기가 폐기됩니다. 이 문장은 공개 승인이 아닙니다.
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
        {writeReason
          ? `쓰기 차단: ${writeReason}`
          : draft.condition.trim()
            ? '해석은 job(interpret_disclosure)으로 요청하며 결과를 자동으로 반복 조회하지 않습니다.'
            : '조건을 입력하세요.'}
      </p>
      <p className="status" role="status" aria-live="polite" data-role="interpretation" data-candidate-id={candidate.id}>
        {interpretationText(draft)}
      </p>
      <p className="hint">
        {draft.jobId
          ? `해석 job ${draft.jobId} · 상태 ${draft.jobStatus ?? '미확인'}`
          : '해석 요청 기록이 없습니다.'}
      </p>
      {draft.message ? <p className="hint">{draft.message}</p> : null}
    </div>
  );
}
