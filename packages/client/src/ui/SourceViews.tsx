// 자료 분석과 검토 단계의 원문 대조. 왼쪽은 후보의 근거 원문, 오른쪽은 후보 문장이나 사람이 허용한 공개 표현이다.
// SafeHandoff는 원문을 가려 내보내지 않고 허용한 내용으로 새로 쓰므로, 글자 단위 차이 대신 후보별로 나란히 보여 준다.

import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { DISPOSITION_LABELS, kindLabel, orderCandidates, representationLabel } from '../disclosure-format.ts';
import type { Candidate, Projection } from '../disclosure-contract.ts';
import { originalLocation, readComparison, readSourceContent } from '../source-views-client.ts';
import type { ComparisonRow, DisclosureComparison, SourceFileView } from '../source-views-client.ts';
import { workflowFailureMessage } from '../workflow-client.ts';

type Stage = 'analysis' | 'review';

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

function useComparison(taskId: string | null, revision: number | null) {
  const [comparison, setComparison] = useState<DisclosureComparison | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setComparison(null);
    setError('');
    if (taskId === null) return undefined;
    let stale = false;
    void readComparison(defaultFetch, taskId).then((result) => {
      if (stale) return;
      if (result.ok) setComparison(result.value);
      else setError(`원문을 불러오지 못했습니다. ${workflowFailureMessage(result.failure)}`);
    });
    return () => { stale = true; };
  }, [taskId, revision]);
  return { comparison, error };
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes.toString()} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function SourceFile(props: { taskId: string; file: SourceFileView }): JSX.Element {
  const { taskId, file } = props;
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = (): void => {
    if (text !== null) return;
    setError('');
    void readSourceContent(defaultFetch, taskId, file.id).then((result) => {
      if (result.ok) setText(result.value.text);
      else setError(`원본을 불러오지 못했습니다. ${workflowFailureMessage(result.failure)}`);
    });
  };
  return (
    <details
      className="fold fold--plain source-file"
      data-role="source-file"
      onToggle={(event) => { if (event.currentTarget.open) load(); }}
    >
      <summary>{`${file.displayName} · ${formatSize(file.byteSize)}`}</summary>
      <div className="fold__body">
        {error === '' ? null : <p className="status status--warn" role="status">{error}</p>}
        {text === null && error === '' ? <p className="hint">불러오는 중입니다.</p> : null}
        {text === null ? null : <pre className="file-view__text" data-role="source-text">{text}</pre>}
      </div>
    </details>
  );
}

function SourceFiles(props: { taskId: string; files: readonly SourceFileView[] }): JSX.Element {
  if (props.files.length === 0) return <p className="hint">등록한 원자료가 없습니다.</p>;
  return (
    <div className="source-files" data-role="source-files">
      {props.files.map((file) => <SourceFile key={file.id} taskId={props.taskId} file={file} />)}
    </div>
  );
}

function ProjectionView(props: { projection: Projection }): JSX.Element {
  const { statement, columns, rows } = props.projection;
  return (
    <>
      {statement === '' ? null : <p>{statement}</p>}
      {!columns || columns.length === 0
        ? null
        : (
          <div className="preview__scroll">
            <table className="preview__table">
              <thead>
                <tr>{columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr>
              </thead>
              <tbody>
                {(rows ?? []).map((row, index) => (
                  <tr key={index.toString()}>{row.map((cell, cellIndex) => <td key={cellIndex.toString()}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}

function AfterSide(props: { row: ComparisonRow; stage: Stage }): JSX.Element {
  const { row, stage } = props;
  if (stage === 'analysis') {
    return (
      <div className="compare__side">
        <p className="compare__label">후보 문장</p>
        <p>{row.statement}</p>
      </div>
    );
  }
  if (row.disposition === 'exclude') {
    return (
      <div className="compare__side compare__side--excluded" data-disposition="exclude">
        <p className="compare__label">공개 내용</p>
        <p className="compare__state">공개하지 않음</p>
        <p className="hint">{DISPOSITION_LABELS.exclude}로 결정해 공유 초안의 근거에서 뺐습니다.</p>
      </div>
    );
  }
  if (row.disposition === 'allow') {
    return (
      <div className="compare__side compare__side--allowed" data-disposition="allow">
        <p className="compare__label">{`공개 내용 · ${representationLabel(row.representation)}`}</p>
        {row.disclosed === null ? <p>{row.statement}</p> : <ProjectionView projection={row.disclosed} />}
      </div>
    );
  }
  return (
    <div className="compare__side compare__side--pending" data-disposition={row.disposition ?? 'none'}>
      <p className="compare__label">공개 내용</p>
      <p className="compare__state">{row.disposition === 'defer' ? '보류' : '결정 전'}</p>
      <p className="hint">최종 확정 전에 허용이나 제외로 정해야 합니다.</p>
    </div>
  );
}

function ComparisonList(props: { rows: readonly ComparisonRow[]; stage: Stage; role: string }): JSX.Element {
  return (
    <ul className="compare" data-role={props.role}>
      {orderCandidates(props.rows).map((row) => (
        <li className="compare__row" key={row.id} data-candidate-id={row.id}>
          <p className="meta">{`${kindLabel(row.kind)} · ${row.required ? '필수' : '선택'}`}</p>
          <div className="compare__pair">
            <div className="compare__side compare__side--original">
              <p className="compare__label">원문 근거 · 내부 확인용</p>
              {row.originals.length === 0
                ? <p className="hint">연결된 원문 근거가 없습니다.</p>
                : row.originals.map((span) => (
                  <div className="compare__span" key={span.evidenceId}>
                    <p className="hint">{originalLocation(span)}</p>
                    <p className="compare__text">{span.text === '' ? '(빈 구간)' : span.text}</p>
                    {span.truncated ? <p className="hint">길어서 앞부분만 표시합니다. 전체는 원본에서 확인하세요.</p> : null}
                  </div>
                ))}
            </div>
            <AfterSide row={row} stage={props.stage} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// 분석 단계: 분석 전에도 원본을 열 수 있고, 분석 뒤에는 후보 문장을 근거 원문과 나란히 보여 준다.
export function AnalysisSources(props: {
  taskId: string | null;
  revision: number | null;
  candidates: readonly Candidate[];
}): JSX.Element | null {
  const { taskId, revision, candidates } = props;
  const { comparison, error } = useComparison(taskId, revision);
  if (taskId === null) return null;
  return (
    <>
      <h3>원본 파일</h3>
      {error === '' ? null : <p className="status status--warn" role="status">{error}</p>}
      {comparison === null ? null : <SourceFiles taskId={taskId} files={comparison.sources} />}
      {candidates.length === 0
        ? null
        : (
          <>
            <h3>{`분석 결과: 후보 ${candidates.length.toString()}개`}</h3>
            <p className="hint">아직 공개 허가가 아닙니다. 공개 결정 단계에서 후보마다 정합니다.</p>
            {comparison === null
              ? (
                <ul className="candidate-summary" data-role="analysis-result">
                  {orderCandidates(candidates).map((candidate) => (
                    <li key={candidate.id} className={candidate.required ? 'candidate-summary__required' : undefined}>
                      <span className="meta">{`${kindLabel(candidate.kind)} · ${candidate.required ? '필수' : '선택'}`}</span>
                      <span>{candidate.statement}</span>
                    </li>
                  ))}
                </ul>
              )
              : <ComparisonList rows={comparison.rows} stage="analysis" role="analysis-result" />}
          </>
        )}
    </>
  );
}

// 검토 단계: 후보마다 원문과 공개하기로 한 표현을 나란히 보여 주고, 실제 문장은 이어지는 초안에서 확인한다.
export function ReviewSources(props: { taskId: string | null; revision: number | null }): JSX.Element | null {
  const { taskId, revision } = props;
  const { comparison, error } = useComparison(taskId, revision);
  if (taskId === null) return null;
  return (
    <>
      <h3>원문과 공개 내용 비교</h3>
      <p className="hint">원문은 이 화면에서만 보이며 공유 파일에 들어가지 않습니다. 공개 내용을 바탕으로 쓴 실제 문장은 아래 초안에서 확인하세요.</p>
      {error === '' ? null : <p className="status status--warn" role="status">{error}</p>}
      {comparison === null
        ? null
        : (
          <>
            <ComparisonList rows={comparison.rows} stage="review" role="review-comparison" />
            <details className="fold fold--plain" data-role="review-sources">
              <summary>{`원본 파일 ${comparison.sources.length.toString()}개`}</summary>
              <div className="fold__body">
                <SourceFiles taskId={taskId} files={comparison.sources} />
              </div>
            </details>
          </>
        )}
    </>
  );
}
