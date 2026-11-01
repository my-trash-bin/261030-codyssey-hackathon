// 분석 모델 연결 확인. 서버가 고정 문구만 보내므로 원자료는 나가지 않는다.
// 응답이 왔다는 사실은 그 주소가 승인된 사내 환경이라는 증거가 아니다.
import { asString, isRecord } from './disclosure-contract.ts';
import type { WorkflowRuntime } from './task-browser-client.ts';
import { requestJson } from './workflow-client.ts';
import type { WorkflowResult } from './workflow-client.ts';

export type ModelCheckResult =
  | { status: 'reachable' | 'not_configured' | 'not_applicable' }
  | { status: 'failed'; code: string };

export interface ModelStateView {
  label: string;
  tone: 'ok' | 'warn' | 'error' | 'neutral';
  hint: string;
  canCheck: boolean;
}

export function parseModelCheck(body: unknown): ModelCheckResult | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  const status = asString(body.data.status);
  if (status === 'reachable' || status === 'not_configured' || status === 'not_applicable') return { status };
  if (status === 'failed') return { status, code: asString(body.data.code) ?? '' };
  return null;
}

export function checkModel(fetchFn: typeof fetch, csrfToken: string): Promise<WorkflowResult<ModelCheckResult>> {
  return requestJson(fetchFn, {
    method: 'POST',
    path: '/api/v1/model-check',
    csrfToken,
    payload: {},
    parse: parseModelCheck,
  });
}

const FAILURES: Record<string, { label: string; hint: string }> = {
  MODEL_TIMEOUT: { label: '응답 시간 초과', hint: '모델 서버가 제때 답하지 않았습니다. 서버 상태와 네트워크를 확인하세요.' },
  MODEL_INVALID_RESPONSE: { label: '응답 형식 오류', hint: '모델 서버에는 닿았지만 응답이 예상과 다릅니다. 모델 이름과 OpenAI 호환 여부를 확인하세요.' },
  MODEL_BUDGET_EXCEEDED: { label: '다른 요청 처리 중', hint: '진행 중인 모델 요청이 끝난 뒤 다시 확인하세요.' },
};
const UNREACHABLE = { label: '연결 실패', hint: '모델 서버에 닿지 못했거나 요청이 거부됐습니다. 주소, 모델 이름, API 키와 서버 상태를 확인하세요.' };

function setupHint(runtime: WorkflowRuntime): string {
  const setup = runtime.modelSetup;
  if (setup === null) return '서버의 모델 설정을 확인하세요.';
  const parts: string[] = [];
  if (setup.missing.length > 0) parts.push(`서버 환경 변수 ${setup.missing.join(', ')}이(가) 비어 있습니다.`);
  if (setup.baseUrlRejected) parts.push(`${setup.baseUrlEnv} 값을 쓸 수 없습니다. https 주소를 넣고(http는 설정에서 허용한 경우만) 사용자 정보와 쿼리는 빼세요.`);
  if (parts.length === 0) return '서버의 모델 설정을 확인하세요.';
  return `${parts.join(' ')} 값을 고친 뒤 서버를 다시 시작하세요.`;
}

/** 서버 설정과 마지막 확인 결과로 화면 문구를 정한다. 설정이 있어도 확인 전에는 연결됐다고 말하지 않는다. */
export function modelStateView(runtime: WorkflowRuntime | null, result: ModelCheckResult | null): ModelStateView {
  if (runtime === null) return { label: '확인 불가', tone: 'warn', hint: '서버에서 모델 설정을 읽지 못했습니다.', canCheck: false };
  if (runtime.implementation === 'fake' || result?.status === 'not_applicable') {
    return { label: '연출용 실행', tone: 'neutral', hint: '이 실행은 실제 모델에 연결하지 않습니다.', canCheck: false };
  }
  if (runtime.ready !== true || result?.status === 'not_configured') {
    return { label: '연결 설정 필요', tone: 'warn', hint: setupHint(runtime), canCheck: false };
  }
  if (result?.status === 'reachable') {
    return { label: '연결 확인됨', tone: 'ok', hint: '모델이 응답했습니다. 이 주소가 승인된 환경인지는 운영자가 확인해야 합니다.', canCheck: true };
  }
  if (result?.status === 'failed') return { ...(FAILURES[result.code] ?? UNREACHABLE), tone: 'error', canCheck: true };
  return { label: '설정됨, 연결 확인 전', tone: 'neutral', hint: '연결 확인으로 모델이 응답하는지 볼 수 있습니다.', canCheck: true };
}
