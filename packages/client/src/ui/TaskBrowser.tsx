// 작업 목록과 선택, 명시 확인 뒤의 작업 삭제. 목록은 세션이 있으면 snapshot 없이도 조회한다.
// 선택은 onTaskChanged(id)로 메인 작업 공간에 알리고, 판본이 바뀌면 목록을 다시 조회한다.
import { useState } from 'react';
import type { JSX } from 'react';
import type { Snapshot } from '../disclosure-state.ts';
import { purposeLabel } from '../disclosure-format.ts';
import type { ScopeNames } from '../disclosure-format.ts';
import { phaseLabel } from '../task-browser-client.ts';
import { formatWorkflowTimestamp } from '../workflow-client.ts';
import { useTaskBrowser } from './hooks/useTaskBrowser.ts';

export interface TaskBrowserProps {
  csrfToken: string | null;
  snapshot: Snapshot | null;
  onTaskChanged: (id: string) => Promise<void> | void;
  /** 선택한 작업이 삭제된 뒤 메인 작업 공간의 snapshot을 비우는 선택 콜백. */
  onTaskDeleted?: () => void;
  catalog?: ScopeNames | null;
}

let mountCounter = 0;

export function TaskBrowser(props: TaskBrowserProps): JSX.Element {
  const browser = useTaskBrowser(props);
  const [uid] = useState(() => {
    mountCounter += 1;
    return `task-browser-${mountCounter}`;
  });
  const selected = browser.selectedId !== null;
  const busy = browser.busyKey !== null;
  const deleteReady = selected && !busy;
  const hintId = `${uid}-hint`;
  const deleteHintId = `${uid}-delete-hint`;
  const recipientName = (id: string): string =>
    props.catalog?.recipients.find(recipient => recipient.id === id)?.displayName ?? id;

  // 작업이 하나도 없으면 목록 영역을 그리지 않는다. 처음 온 사람은 아래 만들기 폼부터 보면 된다.
  if (browser.tasks.length === 0 && !selected) {
    return (
      <section id="task-browser" aria-label="작업 목록">
        <p className="status" role="status" aria-live="polite" data-role="task-list-status">{browser.listStatus}</p>
      </section>
    );
  }

  return (
    <section className="block" id="task-browser" aria-labelledby="task-browser-heading">
      <div className="block__head">
        <h3 id="task-browser-heading">작업 목록</h3>
        <button
          className="button button--small"
          type="button"
          disabled={browser.listBusy}
          aria-busy={browser.listBusy ? 'true' : undefined}
          onClick={() => { browser.reload(); }}
        >
          새로 고침
        </button>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite" data-role="task-list-status">{browser.listStatus}</p>

      <div className="preview__scroll">
        <table className="preview__table task-table">
          <thead>
            <tr>
              <th scope="col">작업</th>
              <th scope="col">목적</th>
              <th scope="col">수신처</th>
              <th scope="col">상태</th>
              <th scope="col">수정</th>
              <th scope="col"><span className="visually-hidden">동작</span></th>
            </tr>
          </thead>
          <tbody>
            {browser.tasks.map(task => {
              const isSelected = task.id === browser.selectedId;
              const title = task.internalTitle === '' ? '제목 없는 작업' : task.internalTitle;
              return (
                <tr key={task.id} aria-current={isSelected ? 'true' : undefined}>
                  <td className="task-table__title">{title}</td>
                  <td>{purposeLabel(task.purpose, props.catalog)}</td>
                  <td>{recipientName(task.recipient)}</td>
                  <td><span className="chip">{phaseLabel(task.phase)}</span></td>
                  <td>{formatWorkflowTimestamp(task.updatedAt)}</td>
                  <td className="task-table__action">
                    {isSelected
                      ? <span className="chip chip--current">선택됨</span>
                      : (
                        <button
                          className="button button--small button--solid"
                          type="button"
                          aria-label={`${title} 열기`}
                          disabled={busy}
                          onClick={() => { browser.select(task.id); }}
                        >
                          열기
                        </button>
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
          </div>
        )}

      <p className="status" role="status" aria-live="polite" data-role="task-action-message">{browser.message}</p>

      {!selected
        ? null
        : (
          <div className="danger-zone">
            <details className="fold fold--danger">
              <summary>
                <h4>선택한 작업 삭제</h4>
              </summary>
              <div className="fold__body">
                <p className="hint" id={deleteHintId}>
                  이 작업의 원자료·후보·결정·이력·초안이 서버에서 삭제되며 되돌릴 수 없습니다. 값이나 원문이 없는 재사용 규칙은 남습니다. 실행 중인 작업이 있으면 끝날 때까지 기다립니다.
                </p>
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
                </div>
              </div>
            </details>
          </div>
        )}
    </section>
  );
}
