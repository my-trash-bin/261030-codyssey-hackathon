// 오른쪽 정보 열. 다음에 할 일, 작업 집계, 최근 실행 문구, 세션과 내부 근거를 한 곳에 모은다.
// 여기서 새 상태를 만들지 않고 훅이 준 값만 정리해 보여 준다.

import type { JSX } from 'react';
import { currentStepId } from '../flow-status.ts';
import type { FlowFacts, StepId, StepView } from '../flow-status.ts';
import type { Snapshot } from '../disclosure-contract.ts';
import { phaseLabel } from '../task-browser-client.ts';
import type { ArtifactsApi } from './hooks/useArtifacts.ts';
import type { SessionApi } from './hooks/useSession.ts';
import { EvidencePanel } from './DraftSection.tsx';
import { SessionSection } from './SessionSection.tsx';

export function Inspector(props: {
  facts: FlowFacts;
  steps: StepView[];
  status: string;
  taskId: string | null;
  taskPhase: string | null;
  revision: number | null;
  session: SessionApi;
  snapshot: Snapshot | null;
  workflow: ArtifactsApi;
}): JSX.Element {
  const { facts, steps, status, taskId, taskPhase, revision, session, snapshot, workflow } = props;
  const next = steps.find((step) => step.id === currentStepId(steps)) as StepView;
  const allDone = steps.every((step) => step.state === 'done');
  const factRows: { label: string; value: string }[] = [
    { label: '원자료', value: String(facts.sourceCount) },
    { label: '후보', value: String(facts.candidateCount) },
    { label: '결정', value: `${facts.decidedCount} / ${facts.candidateCount}` },
    { label: '파일', value: String(facts.artifactFileCount) },
  ];
  return (
    <aside className="inspector" aria-label="작업 정보">
      <section className="inspector__block" aria-labelledby="inspector-next-heading">
        <h2 className="meta" id="inspector-next-heading">다음에 할 일</h2>
        {allDone
          ? <p className="inspector__lead">모든 단계를 마쳤습니다. 내려받은 파일과 해시를 확인하세요.</p>
          : (
            <>
              <p className="inspector__lead">{next.index}단계 · {next.title}</p>
              <p className="hint">{next.purpose}</p>
            </>
          )}
      </section>

      <section className="inspector__block" aria-labelledby="inspector-facts-heading">
        <h2 className="meta" id="inspector-facts-heading">작업 집계</h2>
        <dl className="factgrid">
          {factRows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="hint">
          {taskId === null
            ? '고른 작업이 없습니다.'
            : `작업 ${taskId.slice(0, 8)} · 판본 ${revision ?? '-'}${taskPhase ? ` · ${phaseLabel(taskPhase)}` : ''}`}
        </p>
      </section>

      <section className="inspector__block" aria-labelledby="inspector-status-heading">
        <h2 className="meta" id="inspector-status-heading">최근 실행</h2>
        <p className="status" id="task-status" role="status" aria-live="polite">{status}</p>
      </section>

      <details className="inspector__fold" id="inspector-session">
        <summary className="meta">세션</summary>
        <SessionSection session={session} heading="h3" />
      </details>

      <EvidencePanel snapshot={snapshot} workflow={workflow} />
    </aside>
  );
}
