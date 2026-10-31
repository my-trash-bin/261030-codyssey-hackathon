// 분석 결과(내부) 영역. 표시만 하며 저장·후보 반영·공개 허가를 하지 않는다.
// 결과 본문은 결과 객체나 현재 입력 여부가 바뀔 때만 다시 만든다(이전 화면과 같은 규칙).
// 파일명·모델 문장·sha256·JSON 포인터 같은 외부 문자열은 모두 JSX 텍스트 자식으로 넣는다.

import { useRef } from 'react';
import type { JSX, ReactNode } from 'react';
import type {
  AnalysisCandidate,
  AnalysisConflict,
  AnalysisEvidence,
  AnalysisResult,
  AnalysisSource,
} from '../analysis-state.ts';
import type { AnalysisApi } from './hooks/useAnalysis.ts';
import {
  KIND_LABELS,
  RELEVANCE_LABELS,
  UNCERTAINTY_LABELS,
  excerptText,
  locatorText,
} from '../analysis-format.ts';

function statusText(analysis: AnalysisApi, resultMessage: string | null): string {
  if (analysis.busy) return '분석 요청을 보냈습니다. 모델 응답을 기다리는 중입니다(취소 가능).';
  if (analysis.result && !analysis.resultIsCurrent && analysis.message === resultMessage) {
    return '이전 입력으로 받은 결과를 표시하고 있습니다. 현재 입력으로 다시 분석하면 갱신됩니다.';
  }
  if (analysis.message) return analysis.message;
  if (analysis.problem) return analysis.problem.message;
  if (analysis.result) {
    return analysis.resultIsCurrent
      ? '분석이 끝났습니다. 아래에 이번 입력의 내부 근거와 후보 제안을 표시했습니다.'
      : '이전 입력으로 받은 결과입니다. 현재 선택한 입력으로 다시 분석해야 갱신됩니다.';
  }
  return '아직 분석 결과가 없습니다. 파일·목적·수신처를 준비하고 분석을 요청하면 이 자리에 표시됩니다.';
}

function EvidenceItem(props: { evidence: AnalysisEvidence; sources: readonly AnalysisSource[] }): JSX.Element {
  const { evidence, sources } = props;
  const source = sources.find((item) => item.id === evidence.source_version_id);
  const meta = `근거 ${evidence.id} · 원본 ${source ? source.display_name : evidence.source_version_id} · ${locatorText(evidence)}` +
    ` · 원문 sha256 ${evidence.evidence_sha256.length > 12 ? `${evidence.evidence_sha256.slice(0, 12)}…` : evidence.evidence_sha256}`;
  const excerpt = excerptText(source, evidence);

  return (
    <article className="analysis-evidence__item">
      <p className="evidence__meta">{meta}</p>
      {excerpt && excerpt.text === ''
        ? <p className="hint">발췌가 빈 값입니다(빈 셀·빈 줄). 근거 위치 자체는 위 바이트 범위 그대로입니다.</p>
        : excerpt
          ? (
            <>
              <pre className="analysis-evidence__excerpt">{excerpt.text}</pre>
              {excerpt.truncated
                ? <p className="hint">발췌가 길어 표시용으로 줄였습니다. 근거 범위 자체는 위 바이트 위치 그대로입니다.</p>
                : null}
            </>
          )
          : <p className="hint">원문에서 이 범위의 발췌를 표시할 수 없어 위치 정보만 표시합니다.</p>}
    </article>
  );
}

function CandidateItem(props: { candidate: AnalysisCandidate; conflicts: readonly AnalysisConflict[] }): JSX.Element {
  const { candidate, conflicts } = props;
  const related = conflicts.filter((conflict) => conflict.local_keys.includes(candidate.local_key));

  return (
    <article className="analysis-candidate">
      <p className="meta">
        {`제안 참조 ${candidate.local_key} · ${KIND_LABELS[candidate.kind] ?? candidate.kind} · ${UNCERTAINTY_LABELS[candidate.uncertainty] ?? candidate.uncertainty}`}
      </p>
      <p className="analysis-candidate__statement">{candidate.statement}</p>
      <p className="hint">{`목적 관련성: ${candidate.purpose_relevance}`}</p>
      <p className="hint">{`모델 추천: ${RELEVANCE_LABELS[candidate.relevance] ?? candidate.relevance}`}</p>
      <p className="hint">
        {candidate.evidence_ids.length
          ? `인용 근거: ${candidate.evidence_ids.join(', ')}`
          : '인용 근거: 응답에 근거 참조가 없습니다.'}
      </p>
      {related.map((conflict) => {
        const others = conflict.local_keys.filter((key) => key !== candidate.local_key);
        return (
          <p className="hint" key={`${candidate.local_key}:${conflict.reason}`}>
            {`충돌 표시: ${conflict.reason}${others.length ? ` (다른 후보 ${others.join(', ')})` : ''}`}
          </p>
        );
      })}
    </article>
  );
}

function ConflictItem(props: { conflict: AnalysisConflict }): JSX.Element {
  const { conflict } = props;
  return (
    <article className="analysis-conflict">
      <p className="meta">{`관련 후보: ${conflict.local_keys.join(', ')}`}</p>
      <p className="analysis-conflict__reason">{conflict.reason}</p>
    </article>
  );
}

function buildBody(result: AnalysisResult | null, resultIsCurrent: boolean): ReactNode[] {
  if (!result) {
    return [
      <p className="hint" key="empty">
        분석을 실행하면 이 자리에 내부 근거와 후보 제안이 표시됩니다. 표시된 내용은 저장되지 않고 공개 결정에도 쓰이지 않습니다.
      </p>,
    ];
  }

  const nodes: ReactNode[] = [];
  if (!resultIsCurrent) {
    nodes.push(
      <p className="status analysis-results__stale" key="stale">
        이전 입력의 결과입니다. 파일·목적·수신처를 바꾸면 이전 결과는 그대로 남고, 다시 분석해야 새 결과가 나옵니다.
      </p>,
    );
  }

  const { evidence, proposals, sources, task } = result;
  nodes.push(
    <p className="hint" key="conditions">
      {`결과 조건 — 전달 목적 “${task.purpose}” · 수신처 “${task.recipient}” · 파일 ${sources.length}개`}
    </p>,
    <p className="hint" key="counts">
      {`근거 ${evidence.length}개 · 후보 ${proposals.candidates.length}개 · 충돌 ${proposals.conflicts.length}건`}
    </p>,
  );

  if (evidence.length === 0 && proposals.candidates.length === 0) {
    nodes.push(
      <p className="status" key="none">
        분석 응답에 근거와 후보가 모두 0건입니다. 오류가 아니라 이 입력에서 제안할 내용이 없었다는 뜻입니다.
      </p>,
    );
  }

  if (evidence.length > 0) {
    nodes.push(
      <h3 key="evidence-heading">{`내부 근거 ${evidence.length}개`}</h3>,
      <p className="hint" key="evidence-hint">파일 원문에서 잘라낸 위치와 발췌입니다. 내부 참고용이며 공유 대상이 아닙니다.</p>,
      <div className="analysis-evidence" key="evidence-list">
        {evidence.map((item) => <EvidenceItem evidence={item} sources={sources} key={item.id} />)}
      </div>,
    );
  }

  if (proposals.candidates.length > 0) {
    nodes.push(
      <h3 key="candidate-heading">{`후보 제안 ${proposals.candidates.length}개`}</h3>,
      <p className="hint" key="candidate-hint">
        후보 종류·확실성·목적 관련성은 모델의 제안입니다. “목적상 필요”는 모델의 필수 추천일 뿐 확정 필수나 공개 허용이 아닙니다.
      </p>,
      <div className="analysis-candidates" key="candidate-list">
        {proposals.candidates.map((candidate) => (
          <CandidateItem candidate={candidate} conflicts={proposals.conflicts} key={candidate.local_key} />
        ))}
      </div>,
    );
  }

  if (proposals.conflicts.length > 0) {
    nodes.push(
      <h3 key="conflict-heading">{`충돌 ${proposals.conflicts.length}건`}</h3>,
      <p className="hint" key="conflict-hint">후보끼리 양립하기 어렵다는 표시입니다. 어느 쪽이 맞는지는 이 화면이 정하지 않습니다.</p>,
      <div className="analysis-conflicts" key="conflict-list">
        {proposals.conflicts.map((conflict, index) => (
          <ConflictItem conflict={conflict} key={`${index}:${conflict.reason}`} />
        ))}
      </div>,
    );
  }

  return nodes;
}

export function AnalysisResults(props: { analysis: AnalysisApi }): JSX.Element {
  const { analysis } = props;
  const rendered = useRef<{
    result: AnalysisResult | null | undefined;
    current: boolean | null;
    message: string | null;
    body: ReactNode[];
  }>({ result: undefined, current: null, message: null, body: [] });

  let rebuild = false;
  if (analysis.result !== rendered.current.result) {
    rendered.current.result = analysis.result;
    // 결과와 함께 온 메시지. 입력이 바뀌면 상태는 메시지를 지우지 않으므로, 이 값과 같은 메시지는
    // 이전 결과의 설명으로 보고 '이전 입력 결과' 안내를 우선한다.
    rendered.current.message = analysis.result ? analysis.message : null;
    rebuild = true;
  }
  if (analysis.resultIsCurrent !== rendered.current.current) {
    rendered.current.current = analysis.resultIsCurrent;
    rebuild = true;
  }
  if (rebuild) rendered.current.body = buildBody(analysis.result, analysis.resultIsCurrent);

  return (
    <section className="analysis-results" id="analysis-results" aria-label="분석 결과 (내부)" tabIndex={-1}>
      <div className="analysis-results__head">
        <h2 id="analysis-results-heading">분석 결과 (내부)</h2>
        <p className="hint">
          이 영역은 내부 참고용이며 저장되지 않습니다. 공개 결정·공유 초안·task 후보로 반영되지 않고 공개 허가도 아닙니다.
          {' '}후보 참조(local_key)와 근거 ID는 이 응답 안에서만 쓰는 임시 값입니다.
        </p>
        <p className="hint">
          근거의 시작·끝 값은 원문의 UTF-8 바이트 위치이며 글자 위치가 아닙니다. CSV 행 번호는 머리글을 1행으로 세고, JSON 포인터 루트는 빈 문자열로 표시됩니다.
        </p>
      </div>
      <p className="status" role="status" aria-live="polite" aria-atomic="true">
        {statusText(analysis, rendered.current.message)}
      </p>
      <div className="analysis-results__body">{rendered.current.body}</div>
    </section>
  );
}
