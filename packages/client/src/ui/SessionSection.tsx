// 로컬 접속 구역. 토큰은 화면 메모리에만 두고 저장하지 않는다.
// 토큰이 거부되거나 세션이 만료되면 입력에 aria-invalid를 붙이고 다시 초점을 준다.
// 세션을 닫을 때는 한 번 더 확인을 받고, 승인 상태는 화면이 판정하지 않는다.

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { formatSessionExpiry } from './hooks/useSession.ts';
import type { SessionApi } from './hooks/useSession.ts';
import type { SessionInfo } from '../session-client.ts';

const CAPABILITIES: { key: string; label: string }[] = [
  { key: 'tasks', label: '작업 등록·조회' },
  { key: 'selected_fields', label: '후보 필드 선택' },
  { key: 'reusable_rules', label: '재사용 규칙' },
  { key: 'artifacts', label: '초안·검토' },
  { key: 'exports', label: '확정·내보내기' },
  { key: 'approved_excerpt', label: '승인 발췌' },
];

function capabilityLines(capabilities: Record<string, boolean>): string[] {
  const known = new Set(CAPABILITIES.map((entry) => entry.key));
  const lines = CAPABILITIES.map((entry) => `${entry.label} ${capabilities[entry.key] === true ? '지원' : '미지원'}`);
  for (const [key, value] of Object.entries(capabilities)) {
    if (known.has(key)) continue;
    lines.push(`${key} ${value ? '지원' : '미지원'}`);
  }
  return lines;
}

function environmentLines(session: SessionInfo): string[] {
  const environment = session.environment;
  if (!environment) return ['분석 환경 정보가 응답에 없습니다. 이 화면은 모델 연결 승인을 확인했다고 표시하지 않습니다.'];
  const lines = [
    environment.providerOrigin
      ? `분석 provider 주소 ${environment.providerOrigin}`
      : '분석 provider 주소가 응답에 없습니다.',
    '주소 표시는 모델 연결 성공이나 승인의 증거가 아닙니다.',
  ];
  if (environment.approvalStatus === 'operator_confirmation_required') {
    lines.push('모델 연결 승인: 운영자가 직접 확인해야 합니다. 이 화면은 승인 여부를 판정하지 않습니다.');
  } else if (environment.approvalStatus === '') {
    lines.push('모델 연결 승인 상태를 서버가 밝히지 않았습니다. 승인된 것으로 보지 않습니다.');
  } else {
    lines.push(`모델 연결 승인 상태 값: ${environment.approvalStatus}. 이 화면은 자동으로 승인 처리하지 않습니다.`);
  }
  lines.push(environment.verifiedAt
    ? `환경 검증 시각 ${environment.verifiedAt} (승인 증거로 쓰지 않습니다.)`
    : '환경 검증 시각 없음.');
  return lines;
}

export function SessionSection(props: { session: SessionApi; heading?: 'h2' | 'h3' }): JSX.Element {
  const { session } = props;
  // 정보 열에 접어 넣을 때는 h2를 쓰지 않는다. 문서 제목 순서를 유지하려고 호출부가 정한다.
  const Heading = props.heading ?? 'h2';
  const inputRef = useRef<HTMLInputElement | null>(null);
  const logoutRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const confirmPrevRef = useRef(false);

  useEffect(() => {
    // 확인 단계로 들어가고 나올 때 초점을 따라 옮긴다. 사라진 버튼에 초점이 남지 않게 한다.
    if (confirmPrevRef.current === confirmingLogout) return;
    confirmPrevRef.current = confirmingLogout;
    if (confirmingLogout) confirmRef.current?.focus();
    else logoutRef.current?.focus();
  }, [confirmingLogout]);

  useEffect(() => {
    if (session.invalid || session.expired) inputRef.current?.focus();
  }, [session.invalid, session.expired]);

  const opened = session.session;
  const firstRenderRef = useRef(true);
  useEffect(() => {
    // 세션이 닫히면 확인 단계도 끝내고 토큰 입력으로 초점을 돌린다. 첫 화면 로드에서는 옮기지 않는다.
    if (opened !== null) {
      firstRenderRef.current = false;
      return;
    }
    setConfirmingLogout(false);
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    inputRef.current?.focus();
  }, [opened]);

  if (opened) {
    return (
      <section className="session" id="session" aria-labelledby="session-heading">
        <Heading id="session-heading">로컬 접속</Heading>
        <p className="hint" id="session-hint">
          세션이 열려 있어 공개 결정 영역의 쓰기가 가능합니다. 세션은 서버가 정한 8시간 고정이며 연장되지 않습니다.
          만료되거나 닫히면 같은 시작 토큰을 다시 쓸 수 없으므로, 계속하려면 서버를 다시 시작해 새로 표시되는
          토큰을 입력해야 합니다.
        </p>
        <ul className="hint" id="session-facts" aria-label="열린 세션 정보">
          <li>만료 {formatSessionExpiry(opened.expiresAt)} (연장 없음)</li>
          {environmentLines(opened).map((line) => <li key={line}>{line}</li>)}
          {capabilityLines(opened.capabilities).map((line) => <li key={line}>{line}</li>)}
        </ul>
        <div className="actions">
          <button
            className="button"
            id="session-recheck"
            type="button"
            disabled={session.busy}
            aria-busy={session.busy ? 'true' : undefined}
            onClick={(): void => { session.recheck(); }}
          >세션 상태 다시 확인</button>
          {confirmingLogout ? null : (
            <button
              className="button"
              id="session-logout"
              type="button"
              ref={logoutRef}
              disabled={session.busy}
              aria-describedby="session-logout-hint"
              onClick={(): void => { setConfirmingLogout(true); }}
            >세션 닫기</button>
          )}
        </div>
        {confirmingLogout ? (
          <div className="form" role="group" aria-labelledby="session-logout-hint">
            <p className="hint" id="session-logout-hint">
              세션을 닫으면 이 화면의 작업 입력과 진행 중 요청이 초기화됩니다. 다시 열려면 서버를 시작할 때 표시된
              시작 토큰이 필요하며, 이미 쓴 토큰은 다시 쓸 수 없습니다.
            </p>
            <div className="actions">
              <button
                className="button button--solid"
                id="session-logout-confirm"
                type="button"
                ref={confirmRef}
                disabled={session.busy}
                aria-busy={session.busy ? 'true' : undefined}
                onClick={(): void => { session.logout(); }}
              >세션 닫기 확인</button>
              <button
                className="button"
                id="session-logout-cancel"
                type="button"
                disabled={session.busy}
                onClick={(): void => { setConfirmingLogout(false); }}
              >취소</button>
            </div>
          </div>
        ) : null}
        <p className="status" id="session-status" role="status" aria-live="polite">{session.status}</p>
      </section>
    );
  }

  return (
    <section className="session" id="session" aria-labelledby="session-heading">
      <Heading id="session-heading">로컬 접속</Heading>
      <p className="hint" id="session-hint">
        서버를 SAFEHANDOFF_WORKFLOW_ENABLED=1로 시작하면 터미널에 5분 동안 한 번만 쓸 수 있는 시작 토큰이 표시됩니다.
        그 토큰으로 세션을 엽니다. 토큰은 이 화면의 메모리에만 쓰고 저장하지 않습니다. 세션은 8시간 고정이며
        연장되지 않습니다. 세션이 만료되거나 닫힌 뒤에는 같은 토큰을 다시 쓸 수 없으므로, 계속하려면 서버를 다시
        시작해 새로 표시되는 토큰을 입력해야 합니다.
      </p>
      <form
        className="form session__form"
        id="session-form"
        noValidate
        aria-busy={session.busy ? 'true' : undefined}
        onSubmit={(event: FormEvent<HTMLFormElement>): void => {
          event.preventDefault();
          session.connect();
        }}
      >
        <div className="field">
          <label htmlFor="session-token">시작 토큰</label>
          <input
            id="session-token"
            name="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            ref={inputRef}
            value={session.token}
            aria-invalid={session.invalid ? 'true' : undefined}
            aria-describedby="session-hint session-status"
            onChange={(event): void => { session.setToken(event.currentTarget.value); }}
          />
        </div>
        <button
          className="button button--solid"
          id="session-connect"
          type="submit"
          disabled={session.busy}
          aria-busy={session.busy ? 'true' : undefined}
        >세션 열기</button>
      </form>
      <p className="status" id="session-status" role="status" aria-live="polite">{session.status}</p>
    </section>
  );
}
