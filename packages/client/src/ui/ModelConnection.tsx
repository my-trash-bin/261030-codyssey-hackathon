// 자료 분석 단계의 모델 연결 상태. 주소는 서버 설정이며 화면에서 바꾸지 않는다.

import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { checkModel, modelStateView } from '../model-connection-client.ts';
import type { ModelCheckResult } from '../model-connection-client.ts';
import { readRuntime } from '../task-browser-client.ts';
import type { WorkflowRuntime } from '../task-browser-client.ts';

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function ModelConnection(props: { csrfToken: string | null; origin: string | null }): JSX.Element {
  const { csrfToken, origin } = props;
  const [runtime, setRuntime] = useState<WorkflowRuntime | null>(null);
  const [result, setResult] = useState<ModelCheckResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stale = false;
    void readRuntime(defaultFetch).then((read) => {
      if (!stale && read.ok) setRuntime(read.value);
    });
    return () => { stale = true; };
  }, []);

  const run = (): void => {
    if (csrfToken === null) return;
    setBusy(true);
    void checkModel(defaultFetch, csrfToken).then((checked) => {
      setResult(checked.ok ? checked.value : { status: 'failed', code: '' });
      setBusy(false);
    });
  };

  const view = modelStateView(runtime, result);
  return (
    <div className="model-status" id="model-status" data-role="model-status" role="group" aria-labelledby="model-status-heading">
      <h3 id="model-status-heading">분석 모델</h3>
      <dl className="model-status__facts">
        <div>
          <dt className="meta">주소</dt>
          <dd>{origin ?? '설정 안 됨'}</dd>
        </div>
        <div>
          <dt className="meta">모델</dt>
          <dd>{runtime?.model ?? '설정 안 됨'}</dd>
        </div>
        <div>
          <dt className="meta">상태</dt>
          <dd className={view.tone === 'neutral' ? undefined : `status--${view.tone}`} data-role="model-state" role="status" aria-live="polite">
            {busy ? '확인 중…' : view.label}
          </dd>
        </div>
      </dl>
      <p className="hint" data-role="model-hint">{view.hint}</p>
      {view.canCheck
        ? (
          <div className="action">
            <button
              className="button"
              id="model-check"
              type="button"
              disabled={busy || csrfToken === null}
              aria-busy={busy ? 'true' : undefined}
              aria-describedby="model-check-note"
              onClick={run}
            >
              연결 확인
            </button>
            <p className="hint" id="model-check-note">원자료는 보내지 않고 고정 문구로 응답만 확인합니다.</p>
          </div>
        )
        : null}
    </div>
  );
}
