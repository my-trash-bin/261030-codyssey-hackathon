// 내부 텍스트 보관 달력. 저장 목록과 새 텍스트 저장을 함께 둔다.
// 저장 중에 사용자가 더 쓴 내용은 지우지 않는다.

import { useEffect, useRef } from 'react';
import type { FormEvent, JSX } from 'react';
import type { DocumentRecord, DocumentsApi } from './hooks/useDocuments.ts';

function formatCreated(value: string): { dateTime?: string; text: string } {
  const created = new Date(value);
  if (Number.isNaN(created.getTime())) return { text: value };
  return { dateTime: value, text: created.toLocaleString('ko-KR', { timeZoneName: 'short' }) };
}

function DocumentItem(props: { record: DocumentRecord }): JSX.Element {
  const { record } = props;
  const created = formatCreated(record.createdAt);
  return (
    <article>
      <time dateTime={created.dateTime}>{created.text}</time>
      <pre>{record.text}</pre>
    </article>
  );
}

export function ArchiveSection(props: { documents: DocumentsApi }): JSX.Element {
  const { documents } = props;
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (documents.textInvalid) textRef.current?.focus();
  }, [documents.textInvalid]);

  return (
    <div className="archive">
      <section className="block" aria-labelledby="store-heading">
        <h2 id="store-heading">내부 텍스트 보관</h2>
        <p className="hint" id="store-hint">내부 텍스트 보관일 뿐이며 자료 분석·공개 승인·공유 초안 생성이 아닙니다.</p>

        <details className="fold" id="internal-note-panel">
          <summary>내부 메모 작성</summary>
          <div className="fold__body">
            <form
              className="form"
              id="save-form"
              noValidate
              aria-busy={documents.saveBusy ? 'true' : undefined}
              onSubmit={(event: FormEvent<HTMLFormElement>): void => {
                event.preventDefault();
                documents.save();
              }}
            >
              <div className="field">
                <label htmlFor="text">저장할 내부 텍스트</label>
                <textarea
                  id="text"
                  name="text"
                  rows={4}
                  ref={textRef}
                  value={documents.text}
                  aria-invalid={documents.textInvalid ? 'true' : undefined}
                  aria-describedby="text-help status"
                  onChange={(event): void => { documents.setText(event.currentTarget.value); }}
                />
              </div>
              <p className="hint" id="text-help">비어 있는 텍스트는 저장할 수 없습니다.</p>
              <button
                className="button button--solid"
                id="save"
                type="submit"
                disabled={documents.saveBusy}
                aria-busy={documents.saveBusy ? 'true' : undefined}
              >내부 메모 저장</button>
            </form>
            <p className="status" id="status" role="status" aria-live="polite">{documents.saveStatus}</p>
          </div>
        </details>
      </section>

      <section className="block" id="saved-documents" aria-labelledby="saved-heading" tabIndex={-1}>
        <div className="block__head">
          <h2 id="saved-heading">저장된 내부 문서</h2>
          <button
            className="button"
            id="refresh"
            type="button"
            disabled={documents.busy}
            aria-busy={documents.busy ? 'true' : undefined}
            onClick={() => { documents.load(); }}
          >목록 새로고침</button>
        </div>
        <p className="hint">내부 텍스트 보관 목록입니다. 공유 결과나 승인 기록이 아닙니다.</p>
        <p className="status" id="documents-status" role="status" aria-live="polite">{documents.status}</p>
        <div className="documents" id="documents">
          {documents.records.map((record) => <DocumentItem record={record} key={record.id} />)}
        </div>
      </section>
    </div>
  );
}
