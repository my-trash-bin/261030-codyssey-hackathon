// 후보 한 건의 카드. 결정·표현 방식·조건 해석·미리보기·재사용·저장된 결정을 차례로 그린다.
// 충돌이 있으면 충돌 블록이 양쪽 후보의 근거를 모두 보여주므로 같은 목록을 두 번 그리지 않는다.

import type { JSX } from 'react';

import type { Candidate, Snapshot } from '../disclosure-state.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';
import { ConflictBlock, EvidenceList, hasConflict } from '../disclosure-evidence.tsx';
import { DISPOSITION_LABELS, emptyDraft, kindLabel } from '../disclosure-format.ts';
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
  writeReason: string;
  uid: string;
  token: string;
  setFocusFallback: (key: string) => void;
}): JSX.Element {
  const { workspace, snapshot, candidate, index, writeReason, uid, token, setFocusFallback } = props;
  const draft = workspace.drafts.get(candidate.id) ?? emptyDraft();
  return (
    <fieldset className="candidate" data-candidate-id={candidate.id}>
      <legend className="candidate__legend">
        {`후보 ${index + 1} · ${kindLabel(candidate.kind)} · ${candidate.required ? '필수' : '선택'}`}
      </legend>
      <p className="candidate__statement">{candidate.statement}</p>
      <p className="hint">{`후보 ID ${candidate.id}`}</p>
      <p className="hint">
        {`불확실성: ${candidate.uncertainty || 'task 응답에 표시되지 않음'}`}
      </p>
      {hasConflict(snapshot, candidate)
        ? <ConflictBlock snapshot={snapshot} candidate={candidate} />
        : <EvidenceList snapshot={snapshot} evidenceIds={candidate.evidence_ids} heading="인용 근거" />}
      <CandidateDisposition
        workspace={workspace}
        snapshot={snapshot}
        candidate={candidate}
        draft={draft}
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
        : draft.disposition === 'exclude' || draft.disposition === 'defer'
          ? (
            <p className="hint">
              {`${DISPOSITION_LABELS[draft.disposition]} 결정에는 표현 방식이 없습니다.`}
            </p>
          )
          : <p className="hint">결정을 고르면 표현 방식과 미리보기 자리가 열립니다.</p>}
      <CandidateSavedDecisions
        workspace={workspace}
        snapshot={snapshot}
        candidate={candidate}
        writeReason={writeReason}
        uid={uid}
      />
    </fieldset>
  );
}
