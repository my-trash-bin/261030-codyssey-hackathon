// 작업 이력과 인증된 실행 정보. events의 duration_ms/usage가 null이면 미측정으로 표시하고
// 서버가 주지 않은 수치를 추정하지 않는다. 실행 정보는 설정 조회이며 모델 호출 성공 증거가 아니다.
import type { JSX } from 'react';
import type { Snapshot } from '../disclosure-state.ts';
import { eventKindLabel } from '../task-browser-client.ts';
import { formatWorkflowTimestamp } from '../workflow-client.ts';
import { useTaskHistory } from './hooks/useTaskHistory.ts';

export interface TaskHistoryProps {
  csrfToken: string | null;
  snapshot: Snapshot | null;
  onTaskChanged: (id: string) => Promise<void> | void;
}

export function TaskHistory(props: TaskHistoryProps): JSX.Element {
  const { csrfToken, snapshot } = props;
  const history = useTaskHistory({ csrfToken, snapshot });
  const runtime = history.runtime;

  return (
    <section className="block" id="task-history" aria-labelledby="task-history-heading">
      <h2 id="task-history-heading">작업 이력과 실행 정보</h2>
      <p className="hint">
        선택한 작업의 이벤트를 시간순으로 조회합니다. 서버는 한 번에 최대 100개를 돌려주며, 소요 시간과 사용량이 null이면 미측정으로 표시하고 0이나 다른 값으로 바꾸지 않습니다.
      </p>

      <div className="actions">
        <button
          className="button"
          type="button"
          disabled={history.eventsBusy || csrfToken === null || snapshot === null}
          aria-busy={history.eventsBusy ? 'true' : undefined}
          onClick={() => { history.refreshEvents(); }}
        >
          이력 새로 고침
        </button>
      </div>
      <p className="status" role="status" aria-live="polite" data-role="history-status">{history.eventsStatus}</p>

      {snapshot === null
        ? null
        : (
          <>
            <p className="meta">{`작업 ${snapshot.id} · revision ${snapshot.revision}`}</p>
            {history.events.length === 0
              ? null
              : (
                <div className="preview__scroll">
                  <table className="preview__table">
                    <caption className="hint">시간순 작업 이벤트</caption>
                    <thead>
                      <tr>
                        <th scope="col">순번</th>
                        <th scope="col">판본</th>
                        <th scope="col">종류</th>
                        <th scope="col">시각</th>
                        <th scope="col">소요</th>
                        <th scope="col">사용량</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.events.map(event => (
                        <tr key={event.seq}>
                          <td>{event.seq}</td>
                          <td>{event.revision}</td>
                          <td>{eventKindLabel(event.kind)}</td>
                          <td>{formatWorkflowTimestamp(event.createdAt)}</td>
                          <td>{event.durationMs === null ? '미측정' : `${event.durationMs} ms`}</td>
                          <td>{event.usage === null ? '미측정' : event.usage}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            {history.eventsMore
              ? (
                <div className="actions">
                  <button
                    className="button"
                    type="button"
                    disabled={history.eventsBusy}
                    aria-busy={history.eventsBusy ? 'true' : undefined}
                    onClick={() => { history.loadMoreEvents(); }}
                  >
                    다음 이력 100개
                  </button>
                </div>
              )
              : null}
          </>
        )}

      <div className="runtime" id="workflow-runtime" role="group" aria-labelledby="workflow-runtime-heading">
        <h3 id="workflow-runtime-heading">인증된 실행 정보</h3>
        <p className="hint">
          GET /api/v1/runtime을 인증된 세션으로 조회합니다. 값이 없으면 표시 없음으로 두고 실제/개발용 여부나 모델 동작을 추정하지 않습니다.
        </p>
        <button
          className="button"
          type="button"
          disabled={history.runtimeBusy || csrfToken === null}
          aria-busy={history.runtimeBusy ? 'true' : undefined}
          onClick={() => { history.refreshRuntime(); }}
        >
          실행 정보 새로 고침
        </button>
        <p className="status" role="status" aria-live="polite" data-role="runtime-status">{history.runtimeStatus}</p>
        {runtime === null
          ? null
          : (
            <ul className="plain-list">
              <li>{`provider ${runtime.provider ?? '표시 없음'}`}</li>
              <li>{`model ${runtime.model ?? '표시 없음'}`}</li>
              <li>{`준비 상태 ${runtime.ready === null ? '표시 없음' : runtime.ready ? '준비됨' : '준비되지 않음'}`}</li>
              <li>{`app 버전 ${runtime.appVersion ?? '표시 없음'}`}</li>
              <li>{`검사기 ${runtime.checkers.length === 0 ? '표시 없음' : runtime.checkers.join(', ')}`}</li>
              <li>{`확장 ${runtime.extensions.length === 0 ? '없음 표시' : runtime.extensions.join(', ')}`}</li>
              <li>{`재현 설정 ${runtime.reproductionStatus ?? '표시 없음'}`}</li>
              <li>{`debug 콘텐츠 로깅 ${runtime.contentLogging === null ? '표시 없음' : runtime.contentLogging ? '켜짐' : '꺼짐'}`}</li>
              <li>{`보존 정책 ${runtime.retention ?? '표시 없음'}`}</li>
            </ul>
          )}
      </div>
    </section>
  );
}
