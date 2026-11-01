// 작업 이력과 인증된 실행 정보. events의 duration_ms/usage가 null이면 미측정으로 표시하고
// 서버가 주지 않은 수치를 추정하지 않는다. 실행 정보는 설정 조회이며 모델 호출 성공 증거가 아니다.
// 이력은 이력 화면에, 실행 정보는 실행 정보 화면에 나눠 그린다.
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

const REPRODUCTION_LABELS: Record<string, string> = {
  disabled: '꺼짐',
  enabled_unverified: '켜짐(검증 전)',
  not_configured: '설정 안 됨',
};

export function TaskHistory(props: TaskHistoryProps): JSX.Element {
  const { csrfToken, snapshot } = props;
  const history = useTaskHistory({ csrfToken, snapshot });

  // 측정값이 하나도 없는 열은 같은 글자로 채우지 않고 뺀다.
  const hasDuration = history.events.some(event => event.durationMs !== null);
  const hasUsage = history.events.some(event => event.usage !== null);

  return (
    <section className="block" id="task-history" aria-label="작업 이력">
      <div className="block__head">
        <p className="status" role="status" aria-live="polite" data-role="history-status">{history.eventsStatus}</p>
        <button
          className="button button--small"
          type="button"
          disabled={history.eventsBusy || csrfToken === null || snapshot === null}
          aria-busy={history.eventsBusy ? 'true' : undefined}
          onClick={() => { history.refreshEvents(); }}
        >
          새로 고침
        </button>
      </div>

      {snapshot === null || history.events.length === 0
        ? null
        : (
          <div className="preview__scroll">
            <table className="preview__table">
              <caption className="visually-hidden">시간순 작업 이벤트</caption>
              <thead>
                <tr>
                  <th scope="col">시각</th>
                  <th scope="col">내용</th>
                  <th scope="col">판본</th>
                  {hasDuration ? <th scope="col">소요</th> : null}
                  {hasUsage ? <th scope="col">사용량</th> : null}
                </tr>
              </thead>
              <tbody>
                {history.events.map(event => (
                  <tr key={event.seq}>
                    <td>{formatWorkflowTimestamp(event.createdAt)}</td>
                    <td>{eventKindLabel(event.kind)}</td>
                    <td>{event.revision}</td>
                    {hasDuration ? <td>{event.durationMs === null ? '미측정' : `${event.durationMs} ms`}</td> : null}
                    {hasUsage ? <td>{event.usage === null ? '미측정' : event.usage}</td> : null}
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
    </section>
  );
}
