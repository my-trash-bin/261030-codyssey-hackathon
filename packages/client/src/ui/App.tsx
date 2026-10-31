// 하나의 서버 작업과 판본을 여섯 단계 흐름으로 나눠 보여 준다.
// 왼쪽은 단계 목록, 가운데는 지금 단계의 입력·실행, 오른쪽은 집계와 내부 근거다.
// 세션이 닫히면 흐름을 그리지 않고 접속 화면만 남긴다.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useDisclosures } from './hooks/useDisclosures.ts';
import { useRuntimeInfo } from './hooks/useRuntimeInfo.ts';
import type { RuntimeInfoApi } from './hooks/useRuntimeInfo.ts';
import { formatSessionExpiry, useSession } from './hooks/useSession.ts';
import type { SessionApi } from './hooks/useSession.ts';
import { useTaskFlow } from './hooks/useTaskFlow.ts';
import { useArtifacts } from './hooks/useArtifacts.ts';
import { useDocuments } from './hooks/useDocuments.ts';
import type { SessionInfo } from '../session-client.ts';
import { completionCount, currentStepId, describeSteps, EMPTY_FACTS, stepView } from '../flow-status.ts';
import type { FlowFacts, StepId } from '../flow-status.ts';
import { Masthead } from './Masthead.tsx';
import { SessionSection } from './SessionSection.tsx';
import { TaskSection } from './TaskSection.tsx';
import { TaskBrowser } from './TaskBrowser.tsx';
import { DisclosuresSection } from './DisclosuresSection.tsx';
import { DraftSection } from './DraftSection.tsx';
import { RulesSection } from './RulesSection.tsx';
import { TaskHistory } from './TaskHistory.tsx';
import { ExecutionSection } from './ExecutionSection.tsx';
import { ArchiveSection } from './ArchiveSection.tsx';
import { FlowRail, VIEW_INFO } from './FlowRail.tsx';
import type { ViewId } from './FlowRail.tsx';
import { Inspector } from './Inspector.tsx';
import { StepFrame } from './StepFrame.tsx';

const STEP_IDS: readonly ViewId[] = ['purpose', 'analysis', 'decision', 'draft', 'review', 'files'];

function WorkflowWorkspace(props: {
  csrfToken: string;
  environment: SessionInfo['environment'];
  onAuthRequired: () => void;
  session: SessionApi;
  runtime: RuntimeInfoApi;
}): JSX.Element {
  const { csrfToken, environment, onAuthRequired, session, runtime } = props;
  const disclosures = useDisclosures({ csrfToken, onAuthRequired });
  const documents = useDocuments({ csrfToken });
  const task = useTaskFlow({
    csrfToken,
    snapshot: disclosures.snapshot,
    onTaskLoaded: disclosures.loadTask,
    onAuthRequired,
  });
  const artifacts = useArtifacts({
    csrfToken,
    snapshot: disclosures.snapshot,
    canGenerate: disclosures.canGenerate,
    onTaskChanged: disclosures.loadTask,
  });
  const shared = {
    csrfToken,
    snapshot: disclosures.snapshot,
    onTaskChanged: disclosures.loadTask,
  };
  const [active, setActive] = useState<ViewId>('purpose');
  const [pendingFocus, setPendingFocus] = useState<ViewId | null>(null);

  const snapshot = disclosures.snapshot;
  const facts: FlowFacts = useMemo(() => {
    if (snapshot === null) return { ...EMPTY_FACTS };
    const live = Object.values(snapshot.decisions).filter((decision) => !decision.revoked);
    return {
      hasTask: true,
      sourceCount: snapshot.sources.length,
      candidateCount: snapshot.candidates.length,
      decidedCount: new Set(live.map((decision) => decision.candidate_id)).size,
      analysisRunning: task.job !== null && (task.job.status === 'running' || task.job.status === 'cancel_requested'),
      artifactFileCount: artifacts.artifact?.files.length ?? 0,
      reviewResult: artifacts.artifact?.review?.result ?? null,
      hasHumanReview: Boolean(artifacts.artifact?.humanReview),
      exported: artifacts.exportInfo !== null,
    };
  }, [snapshot, task.job, artifacts.artifact, artifacts.exportInfo]);

  const steps = describeSteps(facts);
  const completed = completionCount(steps);
  const step = stepView(steps, active as StepId);
  const taskLabel = snapshot === null
    ? null
    : `${snapshot.intake?.internal_title ?? snapshot.id.slice(0, 8)} · 판본 ${snapshot.revision}`;

  // 작업이 바뀔 때만 지금 할 일 단계로 옮긴다. 같은 작업의 판본이 오를 때는 사용자가 고른 단계를 유지한다.
  const taskIdRef = useRef<string | null>(null);
  const recommended = currentStepId(steps);
  useEffect(() => {
    const id = snapshot?.id ?? null;
    if (id === taskIdRef.current) return;
    taskIdRef.current = id;
    setActive(recommended);
  }, [snapshot?.id, recommended]);

  // 단계나 화면을 고르면 그 제목으로 초점을 옮긴다. 화면 이동을 키보드로도 따라갈 수 있어야 한다.
  useEffect(() => {
    if (pendingFocus === null) return;
    const target = document.getElementById(`step-${pendingFocus}`) ?? document.getElementById(`screen-${pendingFocus}`);
    target?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  const select = (id: ViewId): void => {
    setActive(id);
    setPendingFocus(id);
  };

  const secondary = (id: ViewId): JSX.Element => (
    <section className="screen" id={`screen-${id}`} aria-label={VIEW_INFO[id as keyof typeof VIEW_INFO].label} tabIndex={-1}>
      <header className="screen__head">
        <h2>{VIEW_INFO[id as keyof typeof VIEW_INFO].label}</h2>
        <p className="screen__lede">{VIEW_INFO[id as keyof typeof VIEW_INFO].hint}</p>
      </header>
      {id === 'rules' ? <RulesSection {...shared} /> : null}
      {id === 'history' ? <TaskHistory {...shared} /> : null}
      {id === 'archive' ? <ArchiveSection documents={documents} /> : null}
      {id === 'execution' ? <ExecutionSection runtime={runtime} /> : null}
    </section>
  );

  const isStep = STEP_IDS.includes(active);

  return (
    <>
      <Masthead
        modeLabel={runtime.modeLabel}
        sessionLabel={session.session ? `만료 ${formatSessionExpiry(session.session.expiresAt)}` : null}
        taskLabel={taskLabel}
        steps={steps}
        completed={completed}
      />
      <div className="shell">
        <FlowRail steps={steps} active={active} onSelect={select} />
        <main className="shell__main" id="workspace" tabIndex={-1}>
          {isStep
            ? (
              <StepFrame step={step} steps={steps} onSelect={select}>
                {active === 'purpose' ? (
                  <>
                    <TaskBrowser {...shared} onTaskDeleted={disclosures.clearTask} />
                    <TaskSection task={task} csrfToken={csrfToken} environment={environment} part="setup" />
                  </>
                ) : null}
                {active === 'analysis' ? (
                  <>
                    <TaskSection task={task} csrfToken={csrfToken} environment={environment} part="sources" />
                    <TaskSection task={task} csrfToken={csrfToken} environment={environment} part="analysis" />
                  </>
                ) : null}
                {active === 'decision' ? <DisclosuresSection workspace={disclosures} taskId={snapshot?.id ?? null} /> : null}
                {active === 'draft' ? <DraftSection workflow={artifacts} part="compose" /> : null}
                {active === 'review' ? <DraftSection workflow={artifacts} part="review" /> : null}
                {active === 'files' ? <DraftSection workflow={artifacts} part="files" /> : null}
              </StepFrame>
            )
            : secondary(active)}
        </main>
        <Inspector
          facts={facts}
          steps={steps}
          status={task.status}
          taskId={snapshot?.id ?? null}
          taskPhase={snapshot?.phase ?? null}
          revision={snapshot?.revision ?? null}
          session={session}
          snapshot={snapshot}
          workflow={artifacts}
        />
      </div>
    </>
  );
}

export function App(): JSX.Element {
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const session = useSession(setCsrfToken);
  const runtime = useRuntimeInfo();

  useEffect(() => {
    const recheck = (): void => { session.recheck(); };
    window.addEventListener('focus', recheck);
    return () => { window.removeEventListener('focus', recheck); };
  }, [session.recheck]);

  const openedSession = session.session;
  if (csrfToken === null || openedSession === null) {
    return (
      <>
        <Masthead
          modeLabel={runtime.modeLabel}
          sessionLabel={null}
          taskLabel={null}
          steps={describeSteps(EMPTY_FACTS)}
          completed={0}
        />
        <main className="workspace" id="workspace" tabIndex={-1}>
          <p className="hint" id="session-gate-hint">
            시작 토큰으로 세션을 열면 여섯 단계 작업 공간이 열립니다. 토큰은 서버를 시작할 때 터미널에 한 번만
            표시됩니다.
          </p>
          <SessionSection session={session} />
          <ExecutionSection runtime={runtime} />
        </main>
      </>
    );
  }

  return (
    <WorkflowWorkspace
      key={csrfToken}
      csrfToken={csrfToken}
      environment={openedSession.environment}
      onAuthRequired={session.recheck}
      session={session}
      runtime={runtime}
    />
  );
}
