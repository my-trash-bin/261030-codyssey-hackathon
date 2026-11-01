// 공개 미리보기 블록. 서버가 계산한 표·발췌·해시를 그대로 표시하고, 화면은 값을 계산하지 않는다.
// 표의 가로 스크롤 위치는 contentKey(미리보기 id)가 바뀐 뒤 다시 넣는다.

import type { JSX } from 'react';

import type { Draft, Preview } from '../disclosure-state.ts';
import type { DisclosuresApi } from './hooks/useDisclosures.ts';
import { collapse, decodeBase64Text, previewBlockReason, representationLabel } from '../disclosure-format.ts';
import { usePreservedScroll } from './hooks/usePreservedScroll.ts';

function ProjectionTable(props: { preview: Preview; candidateId: string }): JSX.Element | null {
  const { preview, candidateId } = props;
  const { ref, onScroll } = usePreservedScroll(preview.preview_id);
  const { columns, rows } = preview.projection;
  if (!columns || !rows) return null;
  return (
    <div className="preview__scroll" ref={ref} onScroll={onScroll} data-scroll-key={`preview:${candidateId}`}>
      <table className="preview__table">
        <thead>
          <tr>
            {columns.map((column, index) => <th key={index} scope="col">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((values, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((_, index) => <td key={index}>{values[index] ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewResult(props: {
  preview: Preview;
  revision: number | null;
  candidateId: string;
}): JSX.Element {
  const { preview, revision, candidateId } = props;
  const rawExcerpt = preview.projection.excerpt;
  const excerpt = rawExcerpt !== undefined ? decodeBase64Text(rawExcerpt) : null;
  const { columns, rows } = preview.projection;
  return (
    <div className="preview" data-role="preview-result" data-candidate-id={candidateId}>
      {revision !== null && preview.input_revision !== revision
        ? <p className="status">작업 판본이 바뀌어 이 미리보기는 쓸 수 없습니다. 다시 만드세요.</p>
        : null}
      <p className="candidate__statement">{preview.projection.statement}</p>
      {/* 사실 요약처럼 표가 없는 표현은 빈 표를 그리지 않는다. */}
      {columns && rows && columns.length > 0 && rows.length > 0
        ? <ProjectionTable preview={preview} candidateId={candidateId} />
        : null}
      {excerpt
        ? (
          <p className={excerpt.ok ? 'evidence__excerpt' : 'hint'}>
            {excerpt.ok ? `발췌: "${collapse(excerpt.text)}"` : `발췌를 표시할 수 없습니다: ${excerpt.reason}`}
          </p>
        )
        : null}
      <details className="fold fold--plain">
        <summary>기술 정보</summary>
        <div className="fold__body">
          <p className="hint">{`표현 ${representationLabel(preview.representation)} · 입력 판본 ${preview.input_revision}`}</p>
          <p className="hint">{`미리보기 ID ${preview.preview_id}`}</p>
          <p className="hint">{`미리보기 해시 ${preview.projection_sha256}`}</p>
        </div>
      </details>
    </div>
  );
}

export function PreviewBlock(props: {
  workspace: DisclosuresApi;
  candidateId: string;
  draft: Draft;
  writeReason: string;
  uid: string;
  token: string;
}): JSX.Element {
  const { workspace, candidateId, draft, writeReason, uid, token } = props;
  const blocked = previewBlockReason(draft, writeReason, workspace.busy);
  const reasonId = `${uid}-preview-reason-${token}`;
  return (
    <div className="candidate__preview" data-role="preview-block" data-candidate-id={candidateId}>
      <h3>공개될 내용 미리보기</h3>
      {draft.preview
        ? (
          <PreviewResult
            preview={draft.preview}
            revision={workspace.snapshot?.revision ?? null}
            candidateId={candidateId}
          />
        )
        : (
          // A·B는 고르면 자동으로 요청한다. 버튼은 C·D와 자동 요청이 실패한 경우에 쓴다.
          <div className="action">
            <button
              className="button"
              type="button"
              data-role="preview"
              data-candidate-id={candidateId}
              disabled={blocked !== null}
              aria-describedby={`${uid}-write-note ${reasonId}`}
              onClick={() => { void workspace.preview(candidateId); }}
            >
              미리보기 만들기
            </button>
            <p className="hint" id={reasonId}>{blocked ?? '미리보기를 만들어도 결정은 저장되지 않습니다.'}</p>
          </div>
        )}
    </div>
  );
}
