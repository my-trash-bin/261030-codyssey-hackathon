// 후보 한 건의 카드. 저장 상태·근거·결정·표현 방식·조건 해석·미리보기·재사용을 차례로 그린다.
// 충돌이 있으면 충돌 블록이 양쪽 후보의 근거를 모두 보여주므로 같은 목록을 두 번 그리지 않는다.
// 이미 저장한 후보는 결과만 펼쳐 두고, 바꿀 때만 입력을 연다.

import type { JSX } from 'react';

import type { Candidate, SavedDecision, Snapshot } from '../disclosure-state.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';
import { ConflictBlock, EvidenceList, hasConflict } from '../disclosure-evidence.tsx';
import { DISPOSITION_LABELS, emptyDraft, kindLabel, UNCERTAINTY_LABELS } from '../disclosure-format.ts';
import { CandidateMode, CandidateCondition } from './CandidateMode.tsx';
import { CandidateDisposition } from './CandidateDisposition.tsx';
import { CandidateReusable } from './CandidateReusable.tsx';
import { CandidateSavedDecisions } from './CandidateSavedDecisions.tsx';
import { PreviewBlock } from './PreviewBlock.tsx';

export function CandidateCard(props: {
  workspace: DisclosuresApi;
  snapshot: Snapshot;
  candidate: Candidate;
  index: number;
  saved: SavedDecision | undefined;
  writeReason: string;
  uid: string;
  token: string;
  setFocusFallback: (key: string) => void;
}): JSX.Element {
  const { workspace, snapshot, candidate, index, saved, writeReason, uid, token, setFocusFallback } = props;
  const draft = workspace.drafts.get(candidate.id) ?? emptyDraft();
  const editor = (
    <>
      <CandidateDisposition
        workspace={workspace}
        snapshot={snapshot}
        candidate={candidate}
        draft={draft}
        saved={saved !== undefined}
        uid={uid}
        token={token}
        setFocusFallback={setFocusFallback}
      />
      {draft.disposition === 'allow'
        ? (
          <>
            <CandidateMode workspace={workspace} candidate={candidate} draft={draft} uid={uid} token={token} />
            {draft.mode === 'D'
              ? (
                <CandidateCondition
                  workspace={workspace}
                  candidate={candidate}
                  draft={draft}
                  writeReason={writeReason}
                  uid={uid}
                  token={token}
                />
              )
              : null}
            <PreviewBlock
              workspace={workspace}
              candidateId={candidate.id}
              draft={draft}
              writeReason={writeReason}
              uid={uid}
              token={token}
            />
            <CandidateReusable workspace={workspace} candidate={candidate} draft={draft} uid={uid} token={token} />
          </>
        )
        : null}
    </>
  );
  const history = (
    <CandidateSavedDecisions
      workspace={workspace}
      snapshot={snapshot}
      candidate={candidate}
      writeReason={writeReason}
      uid={uid}
    />
  );
  return (
    <div
      className={`candidate${saved === undefined ? '' : ' candidate--saved'}${saved?.disposition === 'defer' ? ' candidate--deferred' : ''}`}
      data-candidate-id={candidate.id}
    >
      <fieldset className="candidate__group">
        <legend className="candidate__legend">
          {`후보 ${index + 1} · ${kindLabel(candidate.kind)} · ${candidate.required ? '필수' : '선택'} · ${UNCERTAINTY_LABELS[candidate.uncertainty] ?? '확실성 미표시'}`}
        </legend>
        <p className="candidate__statement">{candidate.statement}</p>
        {saved === undefined
          ? null
          : (
            <p className={`candidate__saved${saved.disposition === 'defer' ? ' status--warn' : ''}`} data-role="saved-state">
              {saved.disposition === 'defer'
                ? '저장됨: 보류 · 최종 확정 전에 허용이나 제외로 바꿔야 합니다.'
                : `저장됨: ${DISPOSITION_LABELS[saved.disposition]}`}
            </p>
          )}
        {hasConflict(snapshot, candidate)
          ? <ConflictBlock snapshot={snapshot} candidate={candidate} />
          : <EvidenceList snapshot={snapshot} evidenceIds={candidate.evidence_ids} heading="근거" />}
        {saved === undefined
          ? editor
          : (
            <details className="fold fold--plain" data-role="change-decision">
              <summary>결정 바꾸기·철회</summary>
              <div className="fold__body">
                {editor}
                {history}
              </div>
            </details>
          )}
        {saved === undefined ? history : null}
      </fieldset>
    </div>
  );
}
