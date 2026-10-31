// 작업 목록과 선택, 명시 확인 뒤의 작업 삭제. 목록은 세션이 있으면 snapshot 없이도 조회한다.
// 선택은 onTaskChanged(id)로 메인 작업 공간에 알리고, 판본이 바뀌면 목록을 다시 조회한다.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Snapshot } from '../disclosure-state.ts';
import { phaseLabel } from '../task-browser-client.ts';
import { formatWorkflowTimestamp } from '../workflow-client.ts';
import { useTaskBrowser } from './hooks/useTaskBrowser.ts';

export interface TaskBrowserProps {
  csrfToken: string | null;
  snapshot: Snapshot | null;
  onTaskChanged: (id: string) => Promise<void> | void;
  /** 선택한 작업이 삭제된 뒤 메인 작업 공간의 snapshot을 비우는 선택 콜백. */
  onTaskDeleted?: () => void;
}

let mountCounter = 0;

export function TaskBrowser(props: TaskBrowserProps): JSX.Element {
  const browser = useTaskBrowser(props);
  const [uid] = useState(() => {
    mountCounter += 1;
    return `task-browser-${mountCounter}`;
  });
  const [confirmation, setConfirmation] = useState('');
  const [retainedAck, setRetainedAck] = useState(false);

  // 선택한 작업이 바뀌면 이전 작업의 삭제 확인 입력을 그대로 두지 않는다.
  useEffect(() => {
    setConfirmation('');
    setRetainedAck(false);
  }, [browser.selectedId]);

  const selected = browser.selectedId !== null;
  const busy = browser.busyKey !== null;
  const deleteReady = selected && confirmation === 'DELETE' && retainedAck && !busy;
  const hintId = `${uid}-hint`;
  const deleteHintId = `${uid}-delete-hint`;

  return (
    <section className="block" id="task-browser" aria-labelledby="task-browser-heading">
      <h2 id="task-browser-heading">작업 목록</h2>
      <p className="hint" id={hintId}>
        최근 수정순 30개씩 조회합니다. 목록에는 원자료 본문과 모델 응답이 없습니다. 작업을 선택하면 화면의 모든 기능이 그 작업의 현재 판본을 기준으로 다시 조회됩니다.
      </p>

      <div className="actions">
        <button
          className="button"
          type="button"
          disabled={browser.listBusy}
          aria-busy={browser.listBusy ? 'true' : undefined}
          aria-describedby={hintId}
          onClick={() => { browser.reload(); }}
        >
          목록 새로 고침
        </button>
      </div>
      <p className="status" role="status" aria-live="polite" data-role="task-list-status">{browser.listStatus}</p>

      {browser.tasks.length === 0
        ? (
          <div className="disclosures__empty">
            <p className="hint">작업 만들기에서 작업을 등록하면 이 목록에 나타납니다. 이 화면은 작업을 자동으로 만들거나 삭제하지 않습니다.</p>
          </div>
        )
        : (
          <ul className="plain-list">
            {browser.tasks.map(task => {
              const isSelected = task.id === browser.selectedId;
              const title = task.internalTitle === '' ? '제목 없는 작업' : task.internalTitle;
              return (
                <li key={task.id}>
                  <button
                    className="button"
                    type="button"
                    aria-current={isSelected ? 'true' : undefined}
                    disabled={busy}
                    aria-describedby={hintId}
                    onClick={() => { browser.select(task.id); }}
                  >
                    {isSelected ? `선택됨 · ${title}` : title}
                  </button>
                  <p className="meta">
                    {`작업 ${task.id} · revision ${task.revision} · ${phaseLabel(task.phase)} · 수정 ${formatWorkflowTimestamp(task.updatedAt)}`}
                  </p>
                  <p className="hint">
                    {`목적 ${task.purpose} · 수신처 ${task.recipient}`
                      + (task.currentJobId === null ? '' : ` · 진행 job ${task.currentJobId}`)
                      + (task.currentArtifactId === null ? '' : ` · 최근 artifact ${task.currentArtifactId}`)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

      {browser.nextCursor === null
        ? null
        : (
          <div className="actions">
            <button
              className="button"
              type="button"
              disabled={browser.listBusy}
              aria-busy={browser.listBusy ? 'true' : undefined}
              onClick={() => { browser.loadMore(); }}
            >
              다음 30개
            </button>
            <p className="hint">서버 커서로 이어 조회합니다. 커서가 만료되면 첫 페이지부터 다시 조회하세요.</p>
          </div>
        )}

      <p className="status" role="status" aria-live="polite" data-role="task-action-message">{browser.message}</p>

      {!selected
        ? (
          <p className="hint">삭제는 작업을 선택한 뒤에만 열립니다. 기존 작업은 이 화면에서 자동으로 삭제하지 않습니다.</p>
        )
        : (
          <div className="decision">
            <h3>선택한 작업 삭제</h3>
            <p className="hint" id={deleteHintId}>
              {`작업 ${browser.selectedId}의 원자료·후보·결정·이력·초안이 서버에서 삭제되며 되돌릴 수 없습니다. 값이나 원문이 없는 저장 규칙은 남습니다. 삭제는 실행 중 job이 끝날 때까지 기다립니다.`}
            </p>
            <div className="field">
              <label htmlFor={`${uid}-confirmation`}>확인 문자열</label>
              <input
                id={`${uid}-confirmation`}
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={confirmation}
                placeholder="DELETE"
                aria-describedby={deleteHintId}
                aria-invalid={confirmation !== '' && confirmation !== 'DELETE' ? 'true' : undefined}
                disabled={busy}
                onChange={event => { setConfirmation(event.currentTarget.value); }}
              />
              <p className="hint">정확히 DELETE를 입력해야 삭제 요청이 열립니다.</p>
            </div>
            <div className="option">
              <input
                id={`${uid}-retained`}
                type="checkbox"
                checked={retainedAck}
                disabled={busy}
                aria-describedby={deleteHintId}
                onChange={event => { setRetainedAck(event.currentTarget.checked); }}
              />
              <label htmlFor={`${uid}-retained`}>저장된 재사용 규칙은 남는다는 것을 확인했습니다.</label>
            </div>
            <div className="action">
              <button
                className="button"
                type="button"
                disabled={!deleteReady}
                aria-busy={browser.busyKey === 'delete' ? 'true' : undefined}
                onClick={() => { browser.deleteSelected(); }}
              >
                작업 삭제
              </button>
              <p className="hint">
                {deleteReady
                  ? '이 작업만 삭제합니다. 재사용 규칙의 판본과 철회 이력은 저장소에 남습니다.'
                  : '확인 문자열 DELETE와 재사용 규칙 보존 확인이 모두 있어야 삭제할 수 있습니다.'}
              </p>
            </div>
          </div>
        )}
    </section>
  );
}
