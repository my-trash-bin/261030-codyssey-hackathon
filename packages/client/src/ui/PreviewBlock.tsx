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
          {rows.length === 0
            ? (
              <tr>
                <td colSpan={Math.max(columns.length, 1)}>표 행이 없습니다.</td>
              </tr>
            )
            : rows.map((values, rowIndex) => (
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
  return (
    <div className="preview" data-role="preview-result" data-candidate-id={candidateId}>
      <p className="meta">
        {`미리보기 ${preview.preview_id} · 입력 revision ${preview.input_revision} · 표현 ${representationLabel(preview.representation)}`}
      </p>
      {revision !== null && preview.input_revision !== revision
        ? (
          <p className="status">
            {`현재 task revision ${revision}과 달라 이 미리보기는 무효입니다. 다시 만든 뒤 적용하세요.`}
          </p>
        )
        : null}
      <p className="candidate__statement">{preview.projection.statement}</p>
      {preview.projection.columns && preview.projection.rows
        ? <ProjectionTable preview={preview} candidateId={candidateId} />
        : <p className="hint">응답에 표가 없어 표시할 계산값이 없습니다.</p>}
      {excerpt
        ? (
          <p className={excerpt.ok ? 'evidence__excerpt' : 'hint'}>
            {excerpt.ok ? `발췌: "${collapse(excerpt.text)}"` : `발췌 표시 불가: ${excerpt.reason}`}
          </p>
        )
        : null}
      <p className="hint">{`projection_sha256(서버 반환값): ${preview.projection_sha256}`}</p>
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
      <h3>공개 미리보기</h3>
      <p className="hint">
        미리보기는 서버가 계산한 결과입니다. 이 화면은 응답의 표와 해시를 그대로 표시하며 직접 계산하지 않습니다.
      </p>
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
      </div>
      <p className="hint" id={reasonId}>
        {blocked ?? '미리보기를 요청할 수 있습니다. 요청은 결정을 저장하지 않습니다.'}
      </p>
      {draft.preview
        ? (
          <PreviewResult
            preview={draft.preview}
            revision={workspace.snapshot?.revision ?? null}
            candidateId={candidateId}
          />
        )
        : null}
    </div>
  );
}
