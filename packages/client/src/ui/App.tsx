// 하나의 서버 작업과 판본을 분석·공개 결정·초안·규칙·내보내기가 함께 사용한다.
// 세션이 닫히면 작업 공간을 해제해 이전 세션의 상태와 늦은 응답을 남기지 않는다.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useDisclosures } from './hooks/useDisclosures.ts';
import { useRuntimeInfo } from './hooks/useRuntimeInfo.ts';
import { useSession } from './hooks/useSession.ts';
import { useTaskFlow } from './hooks/useTaskFlow.ts';
import { useArtifacts } from './hooks/useArtifacts.ts';
import { useDocuments } from './hooks/useDocuments.ts';
import type { SessionInfo } from '../session-client.ts';
import { Masthead } from './Masthead.tsx';
import { SessionSection } from './SessionSection.tsx';
import { TaskSection } from './TaskSection.tsx';
import { DraftSection, EvidencePanel } from './DraftSection.tsx';
import { DisclosuresSection } from './DisclosuresSection.tsx';
import { RulesSection } from './RulesSection.tsx';
import { TaskBrowser } from './TaskBrowser.tsx';
import { TaskHistory } from './TaskHistory.tsx';
import { ExecutionSection } from './ExecutionSection.tsx';
import { ArchiveSection } from './ArchiveSection.tsx';

function WorkflowWorkspace(props: {
  csrfToken: string;
  environment: SessionInfo['environment'];
  onAuthRequired: () => void;
}): JSX.Element {
  const { csrfToken, environment, onAuthRequired } = props;
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

  return (
    <>
      <TaskBrowser {...shared} onTaskDeleted={disclosures.clearTask} />
      <TaskSection task={task} csrfToken={csrfToken} environment={environment} />
      <section className="decisions" id="disclosure-decisions" aria-label="공개 결정" tabIndex={-1}>
        <DisclosuresSection workspace={disclosures} />
      </section>
      <DraftSection workflow={artifacts} />
      <EvidencePanel snapshot={disclosures.snapshot} workflow={artifacts} />
      <RulesSection {...shared} />
      <TaskHistory {...shared} />
      <ArchiveSection documents={documents} />
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

  return (
    <>
      <Masthead modeLabel={runtime.modeLabel} />
      <main className="workspace" id="workspace" tabIndex={-1}>
        <SessionSection session={session} />
        {csrfToken !== null && session.session !== null
          ? (
            <WorkflowWorkspace
              key={csrfToken}
              csrfToken={csrfToken}
              environment={session.session.environment}
              onAuthRequired={session.recheck}
            />
          )
          : <p className="status" role="status">세션을 열면 작업 등록·분석·공개 결정·초안 작성과 내보내기를 진행할 수 있습니다.</p>}
        <ExecutionSection runtime={runtime} />
      </main>
    </>
  );
}
