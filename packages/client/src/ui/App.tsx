// SafeHandoff 작업 화면의 최상위 컴포넌트.
// 분석과 공개 결정은 각 훅의 React reducer가 상태를 소유한다.
// 세션 토큰은 두 흐름이 공유할 수 있도록 최상위에서 보유한다.

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useAnalysis } from './hooks/useAnalysis.ts';
import type { AnalysisApi } from './hooks/useAnalysis.ts';
import { useDisclosures } from './hooks/useDisclosures.ts';
import { useRuntimeInfo } from './hooks/useRuntimeInfo.ts';
import { useSession } from './hooks/useSession.ts';
import { useDocuments } from './hooks/useDocuments.ts';
import { useTaskFlow } from './hooks/useTaskFlow.ts';
import { Masthead } from './Masthead.tsx';
import { SessionSection } from './SessionSection.tsx';
import { TaskSection } from './TaskSection.tsx';
import { IntentSection } from './IntentSection.tsx';
import { DraftSection, EvidencePanel } from './DraftSection.tsx';
import { DisclosuresSection } from './DisclosuresSection.tsx';
import { PrimaryActions } from './PrimaryActions.tsx';
import type { AnalysisPrerequisites } from './PrimaryActions.tsx';
import { AnalysisResults } from './AnalysisResults.tsx';
import { ArchiveSection } from './ArchiveSection.tsx';
import { ExecutionSection } from './ExecutionSection.tsx';

function prerequisitesOf(analysis: AnalysisApi): AnalysisPrerequisites {
  const missing: string[] = [];
  if (analysis.files.length === 0) missing.push('파일');
  if (!analysis.purpose.trim()) missing.push('전달 목적');
  if (!analysis.recipient.trim()) missing.push('수신처');
  if (!analysis.consent) missing.push('승인 환경 확인 동의');
  const ready = missing.length === 0;

  return {
    analyzeDisabled: analysis.busy || !ready,
    cancelDisabled: !analysis.busy,
    analyzeBusy: analysis.busy,
    reason: analysis.busy
      ? '분석 요청을 보냈습니다. 응답이 오거나 취소할 때까지 기다립니다. 완료되면 아래 분석 결과에 표시됩니다.'
      : analysis.problem && analysis.problem.field !== 'request'
        ? analysis.problem.message
        : ready
          ? '분석을 시작하면 입력의 형식·한도를 확인합니다. 결과는 공개 허가가 아닙니다.'
          : `${missing.join(' · ')} 항목이 준비되어야 분석을 요청할 수 있습니다.`,
  };
}

export function App(): JSX.Element {
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const disclosures = useDisclosures({ csrfToken });
  const analysis = useAnalysis();
  const runtime = useRuntimeInfo();
  const session = useSession(setCsrfToken);
  const sessionView = {
    ...session,
    status: session.isSessionNotice
      ? `${session.status}${disclosures.writeBlockReason === ''
        ? ' 공개 결정 쓰기가 열렸습니다.' : ` ${disclosures.writeBlockReason}`}`
      : session.status,
  };
  const documents = useDocuments();
  const task = useTaskFlow({
    csrfToken,
    onTaskLoaded: (id) => { void disclosures.loadTask(id); },
  });

  useEffect(() => {
    if (csrfToken === null) return;
    task.noteSessionOpened();
  }, [csrfToken]);

  const prereq = prerequisitesOf(analysis);

  return (
    <>
      <Masthead modeLabel={runtime.modeLabel} />

      <main className="workspace" id="workspace" tabIndex={-1}>
        <SessionSection session={sessionView} />
        <TaskSection task={task} csrfToken={csrfToken} />

        <div className="work">
          <IntentSection analysis={analysis} />
          <DraftSection />
          <EvidencePanel />
        </div>

        <section className="decisions" id="disclosure-decisions" aria-label="공개 결정" tabIndex={-1}>
          <DisclosuresSection workspace={disclosures} />
        </section>

        <PrimaryActions
          prereq={prereq}
          onAnalyze={() => { void analysis.run(); }}
          onCancel={() => { analysis.cancel(); }}
        />

        <AnalysisResults analysis={analysis} />

        <ArchiveSection documents={documents} />

        <ExecutionSection runtime={runtime} />
      </main>
    </>
  );
}
