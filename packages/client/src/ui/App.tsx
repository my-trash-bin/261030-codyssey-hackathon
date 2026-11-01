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
import { validSavedDecisions } from '../disclosure-selectors.ts';
import { completionCount, currentStepId, describeSteps, EMPTY_FACTS, stepView } from '../flow-status.ts';
import type { FlowFacts, StepId } from '../flow-status.ts';
import { SidebarHead, TopBar } from './Masthead.tsx';
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
// 새로고침해도 고른 작업으로 돌아오게 탭 단위로만 기억한다. 토큰이나 원자료는 저장하지 않는다.
const SELECTED_TASK_KEY = 'safehandoff.selected-task';

function readSelectedTask(): string | null {
  try { return sessionStorage.getItem(SELECTED_TASK_KEY); } catch { return null; }
}

function writeSelectedTask(id: string | null): void {
  try {
    if (id === null) sessionStorage.removeItem(SELECTED_TASK_KEY);
    else sessionStorage.setItem(SELECTED_TASK_KEY, id);
  } catch {
    // 저장소를 못 쓰면 새로고침 때 작업 목록에서 다시 고르면 된다.
  }
}

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
  const [recentStatus, setRecentStatus] = useState('');

  const snapshot = disclosures.snapshot;
  const facts: FlowFacts = useMemo(() => {
    if (snapshot === null) return { ...EMPTY_FACTS };
    const effective = [...validSavedDecisions(snapshot).values()];
    const deferred = effective.filter((decision) => decision.disposition === 'defer').length;
    const draftReady = artifacts.artifact !== null && artifacts.artifact.taskId === snapshot.id;
    return {
      hasTask: true,
      sourceCount: snapshot.sources.length,
      candidateCount: snapshot.candidates.length,
      decidedCount: effective.length - deferred,
      deferredCount: deferred,
      analysisRunning: task.job !== null && (task.job.status === 'running' || task.job.status === 'cancel_requested'),
      hasDraft: draftReady,
      artifactFileCount: draftReady ? artifacts.artifact?.files.length ?? 0 : 0,
      reviewResult: draftReady ? artifacts.artifact?.review?.result ?? null : null,
      hasHumanReview: draftReady && Boolean(artifacts.artifact?.humanReview),
      // 내보내기 정보는 메모리에만 있어 새로고침하면 사라진다. 확정 여부 자체는 서버 단계를 따른다.
      exported: artifacts.exportInfo !== null || snapshot.phase === 'finalized',
    };
  }, [snapshot, task.job, artifacts.artifact, artifacts.exportInfo]);

  // 서버 확정 조건을 아직 채우지 않은 후보. 6단계에서 무엇이 막는지 이름으로 보여 준다.
  const pendingDecisions = useMemo(() => {
    if (snapshot === null) return [];
    const effective = validSavedDecisions(snapshot);
    return snapshot.candidates.filter((candidate) => {
      const decision = effective.get(candidate.id);
      return decision === undefined || decision.disposition === 'defer';
    });
  }, [snapshot]);

  const steps = describeSteps(facts);
  const completed = completionCount(steps);
  const step = stepView(steps, active as StepId);
  const recommended = currentStepId(steps);
  const recommendedStep = stepView(steps, recommended);
  const taskLabel = snapshot === null
    ? null
    : `${snapshot.intake?.internal_title ?? snapshot.id.slice(0, 8)} · 판본 ${snapshot.revision}`;

  // 작업이 바뀔 때만 지금 할 일 단계로 옮긴다. 같은 작업의 판본이 오를 때는 사용자가 고른 단계를 유지한다.
  // 초안 정보까지 읽은 뒤에 옮겨야 이미 끝난 단계로 잘못 돌아가지 않는다.
  const taskIdRef = useRef<string | null>(null);
  const draftLoaded = snapshot !== null && artifacts.task?.id === snapshot.id;
  useEffect(() => {
    const id = snapshot?.id ?? null;
    if (id === taskIdRef.current) return;
    if (id !== null && !draftLoaded) return;
    taskIdRef.current = id;
    setActive(recommended);
  }, [snapshot?.id, draftLoaded, recommended]);

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = readSelectedTask();
    if (saved !== null) void disclosures.loadTask(saved);
  }, [disclosures.loadTask]);

  const previousTaskRef = useRef<string | null>(null);
  useEffect(() => {
    const id = snapshot?.id ?? null;
    // 복원 전 첫 렌더의 빈 값으로 기억한 작업을 지우지 않는다. 있던 작업이 사라질 때만 지운다.
    if (id !== null) writeSelectedTask(id);
    else if (previousTaskRef.current !== null) writeSelectedTask(null);
    previousTaskRef.current = id;
  }, [snapshot?.id]);

  // 최근 실행은 어느 훅이 남긴 문구든 가장 나중 것을 보여 준다. 분석 문구가 끝까지 남지 않게 한다.
  const hasTask = snapshot !== null;
  useEffect(() => { if (task.status !== '') setRecentStatus(task.status); }, [task.status]);
  useEffect(() => { if (hasTask && disclosures.message !== '') setRecentStatus(disclosures.message); }, [hasTask, disclosures.message]);
  useEffect(() => { if (hasTask && artifacts.message !== '') setRecentStatus(artifacts.message); }, [hasTask, artifacts.message]);

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
      {id === 'rules' ? <RulesSection {...shared} names={task.catalog} /> : null}
      {id === 'history' ? <TaskHistory {...shared} part="events" /> : null}
      {id === 'archive' ? <ArchiveSection documents={documents} /> : null}
      {id === 'execution'
        ? (
          <>
            <ExecutionSection runtime={runtime} embedded />
            <TaskHistory {...shared} part="runtime" />
          </>
        )
        : null}
    </section>
  );

  const isStep = STEP_IDS.includes(active);
  // 앞 단계가 끝나지 않으면 비활성 입력을 늘어놓지 않고 어디로 가야 하는지만 알린다.
  // 원자료가 빠진 작업의 02단계와 초안이 있는 06단계는 그 자리에서 할 일이 있어 그대로 연다.
  const gated = step.state === 'waiting'
    && !(step.id === 'analysis' && facts.hasTask)
    && !(step.id === 'files' && facts.hasDraft);

  return (
    <>
      <div className="app">
        <aside className="app__sidebar">
          <SidebarHead steps={steps} completed={completed} />
          <FlowRail steps={steps} active={active} onSelect={select} />
        </aside>
        <div className="app__content">
          <TopBar
            modeLabel={runtime.modeLabel}
            sessionLabel={session.session ? `만료 ${formatSessionExpiry(session.session.expiresAt)}` : null}
            taskLabel={taskLabel}
          />
          <div className="app__columns">
        <main className="shell__main" id="workspace" tabIndex={-1}>
          {isStep
            ? (
              <StepFrame step={step} steps={steps} onSelect={select}>
                {gated
                  ? (
                    <div className="step-gate" data-role="step-gate">
                      <p className="status">{`먼저 ${recommendedStep.index}단계(${recommendedStep.title})부터 진행하세요.`}</p>
                      <button className="button button--solid" type="button" onClick={(): void => { select(recommended); }}>
                        {`${recommendedStep.index}단계로 이동`}
                      </button>
                    </div>
                  )
                  : (
                    <>
                      {active === 'purpose' ? (
                        <>
                          <TaskBrowser {...shared} catalog={task.catalog} onTaskDeleted={disclosures.clearTask} />
                          <TaskSection task={task} csrfToken={csrfToken} environment={environment} part="setup" />
                        </>
                      ) : null}
                      {active === 'analysis' ? (
                        <>
                          <TaskSection task={task} csrfToken={csrfToken} environment={environment} part="sources" />
                          <TaskSection
                            task={task}
                            csrfToken={csrfToken}
                            environment={environment}
                            part="analysis"
                            candidates={snapshot?.candidates ?? []}
                          />
                        </>
                      ) : null}
                      {active === 'decision' ? <DisclosuresSection workspace={disclosures} taskId={snapshot?.id ?? null} names={task.catalog} /> : null}
                      {active === 'draft' ? <DraftSection workflow={artifacts} part="compose" /> : null}
                      {active === 'review' ? <DraftSection workflow={artifacts} part="review" /> : null}
                      {active === 'files'
                        ? (
                          <DraftSection
                            workflow={artifacts}
                            part="files"
                            pendingDecisions={pendingDecisions}
                            onGoToDecision={(): void => { select('decision'); }}
                          />
                        )
                        : null}
                    </>
                  )}
              </StepFrame>
            )
            : secondary(active)}
        </main>
        <Inspector
          facts={facts}
          steps={steps}
          status={recentStatus}
          taskPhase={snapshot?.phase ?? null}
          session={session}
          snapshot={snapshot}
          workflow={artifacts}
        />
          </div>
        </div>
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
        <div className="app">
          <aside className="app__sidebar">
            <SidebarHead steps={describeSteps(EMPTY_FACTS)} completed={0} />
          </aside>
          <div className="app__content">
            <TopBar modeLabel={runtime.modeLabel} sessionLabel={null} taskLabel={null} />
            <main className="workspace" id="workspace" tabIndex={-1}>
              <SessionSection session={session} />
              <ExecutionSection runtime={runtime} />
            </main>
          </div>
        </div>
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
