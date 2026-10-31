// 작업 만들기 구역. 목적·수신처와 원자료로 작업을 만들고 첫 판본을 등록한다.
// 작업 생성 버튼은 세션(CSRF 토큰)이 열린 뒤에만 활성화한다.

import { useEffect, useRef } from 'react';
import type { ChangeEvent, FormEvent, JSX } from 'react';
import type { TaskFlowApi } from './hooks/useTaskFlow.ts';

export function TaskSection(props: { task: TaskFlowApi; csrfToken: string | null }): JSX.Element {
  const { task, csrfToken } = props;
  const purposeRef = useRef<HTMLInputElement | null>(null);
  const recipientRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (task.invalidField === 'purpose') purposeRef.current?.focus();
    if (task.invalidField === 'recipient') recipientRef.current?.focus();
  }, [task.invalidField]);

  // 작업을 만들고 원자료를 등록한 뒤에는 선택한 파일 입력을 비운다.
  useEffect(() => {
    if (task.clearFilesSignal === 0) return;
    if (filesRef.current) filesRef.current.value = '';
  }, [task.clearFilesSignal]);

  const analyzeDisabled = task.currentTask === null || task.analysisBusy;

  return (
    <section className="session" id="task-create" aria-labelledby="task-create-heading">
      <h2 id="task-create-heading">작업 만들기</h2>
      <p className="hint" id="task-create-hint">목적·수신처로 작업을 만들고 원자료를 그 작업의 첫 판본으로 등록합니다. 형식은 txt·log·md·csv·json(UTF-8), 파일당 256 KiB, 합계 1 MiB까지입니다.</p>
      <form
        className="form"
        id="task-form"
        noValidate
        aria-busy={task.busy ? 'true' : undefined}
        onSubmit={(event: FormEvent<HTMLFormElement>): void => {
          event.preventDefault();
          task.create();
        }}
      >
        <div className="field">
          <label htmlFor="task-purpose">전달 목적</label>
          <input
            id="task-purpose"
            name="purpose"
            type="text"
            autoComplete="off"
            ref={purposeRef}
            value={task.purpose}
            aria-invalid={task.invalidField === 'purpose' ? 'true' : undefined}
            aria-describedby="task-create-hint task-status"
            onChange={(event): void => { task.setPurpose(event.currentTarget.value); }}
          />
        </div>
        <div className="field">
          <label htmlFor="task-recipient">수신처</label>
          <input
            id="task-recipient"
            name="recipient"
            type="text"
            autoComplete="off"
            ref={recipientRef}
            value={task.recipient}
            aria-invalid={task.invalidField === 'recipient' ? 'true' : undefined}
            aria-describedby="task-create-hint task-status"
            onChange={(event): void => { task.setRecipient(event.currentTarget.value); }}
          />
        </div>
        <div className="field">
          <label htmlFor="task-files">원자료 파일</label>
          <input
            id="task-files"
            name="files"
            type="file"
            multiple
            accept=".txt,.log,.md,.csv,.json"
            ref={filesRef}
            aria-describedby="task-create-hint task-status"
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              task.setFiles(Array.from(event.currentTarget.files ?? []));
            }}
          />
        </div>
        <button
          className="button button--solid"
          id="task-submit"
          type="submit"
          disabled={csrfToken === null || task.busy}
          aria-busy={task.busy ? 'true' : undefined}
        >작업 만들기</button>
      </form>
      <div className="actions">
        <button
          className="button button--solid"
          id="analyze-start"
          type="button"
          disabled={analyzeDisabled}
          aria-busy={task.analysisBusy ? 'true' : undefined}
          aria-describedby="task-create-hint task-status"
          onClick={() => { task.startJob(); }}
        >분석 시작</button>
        <button
          className="button"
          id="analyze-cancel"
          type="button"
          hidden={!task.analysisBusy}
          aria-describedby="task-status"
          onClick={() => { task.cancelJob(); }}
        >분석 취소</button>
      </div>
      <p className="status" id="task-status" role="status" aria-live="polite">{task.status}</p>
    </section>
  );
}
