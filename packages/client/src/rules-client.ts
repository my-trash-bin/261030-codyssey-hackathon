// 재사용 규칙 API. 값이 아니라 숫자 CSV 열 selector와 방향·지수 변환만 다룬다.
// 목록·새 판본·철회·명시 적용 응답을 검사하고, 서버가 허용하는 표현(derived_table)만 노출한다.
import {
  asInt,
  asNonEmptyString,
  asString,
  asStringArray,
  isRecord,
  parseRepresentation,
  parseScope,
} from './disclosure-contract.ts';
import type { Representation, Scope, TaskIntake } from './disclosure-contract.ts';
import { requestJson } from './workflow-client.ts';
import type { WorkflowResult } from './workflow-client.ts';

/** 서버가 재사용을 지원하는 변환. 방향은 추가 인자가 없고 지수는 소수 자리만 받는다. */
export const RULE_TRANSFORM_OPTIONS = [
  { id: 'series_direction_only.v1', label: '방향만(증가·감소·동일)' },
  { id: 'series_index_base100.v1', label: '기준 100 지수' },
] as const;

export type RuleTransformId = (typeof RULE_TRANSFORM_OPTIONS)[number]['id'];

export interface RuleRecord {
  id: string;
  version: number;
  scope: Scope;
  selector: string;
  representation: Representation;
  expiresAt: string | null;
  revoked: boolean;
  /** 서버가 같은 selector·scope라도 goal이 다르면 적용하지 않도록 따로 보관한다. */
  goalVariant: string | null;
}

export interface RuleRef {
  id: string;
  version: number;
}

export interface TaskDetail {
  id: string;
  revision: number;
  scope: Scope;
  /** catalog intake가 없으면 null이며, 서버는 이 작업의 규칙 저장을 422로 거부한다. */
  intake: TaskIntake | null;
}

export function isRuleTransformId(value: string): value is RuleTransformId {
  return RULE_TRANSFORM_OPTIONS.some(option => option.id === value);
}

export function ruleTransformLabel(transformId: string | undefined): string {
  const found = RULE_TRANSFORM_OPTIONS.find(option => option.id === transformId);
  return found?.label ?? (transformId === undefined || transformId === '' ? '변환 없음' : transformId);
}

/** 서버 규칙 저장이 받아들이는 표현인지 화면에서 먼저 판단한다. 최종 판정은 서버가 한다. */
export function isSupportedRuleRepresentation(representation: Representation | null | undefined): boolean {
  if (!representation || representation.kind !== 'derived_table') return false;
  const parameters = representation.parameters ?? {};
  const keys = Object.keys(parameters);
  if (representation.transform_id === 'series_direction_only.v1') return keys.length === 0;
  if (representation.transform_id !== 'series_index_base100.v1') return false;
  if (!keys.every(key => key === 'decimal_places')) return false;
  const places = parameters['decimal_places'];
  if (places === undefined) return true;
  return typeof places === 'number' && Number.isInteger(places) && places >= 0 && places <= 4;
}

/** 화면 문구용 표현 요약. 저장에 쓸 수 없는 표현도 그대로 알린다. */
export function ruleRepresentationLabel(representation: Representation): string {
  if (representation.kind !== 'derived_table') return representation.kind;
  const places = representation.parameters?.['decimal_places'];
  if (representation.transform_id === 'series_index_base100.v1' && typeof places === 'number') {
    return `${ruleTransformLabel(representation.transform_id)} · 소수 ${places}자리`;
  }
  return ruleTransformLabel(representation.transform_id);
}

export function ruleIsActive(rule: RuleRecord, nowMs = Date.now()): boolean {
  if (rule.revoked) return false;
  if (rule.expiresAt === null) return true;
  const at = Date.parse(rule.expiresAt);
  return Number.isFinite(at) && at > nowMs;
}

/** 방향/지수 새 판본 본문을 만든다. 지원 밖 입력은 서버로 보내지 않고 여기서 거부한다. */
export function buildRuleRepresentation(input: { transformId: RuleTransformId; decimalPlaces: number }): Representation {
  if (input.transformId === 'series_direction_only.v1') {
    return { kind: 'derived_table', transform_id: input.transformId };
  }
  if (!Number.isInteger(input.decimalPlaces) || input.decimalPlaces < 0 || input.decimalPlaces > 4) {
    throw new Error('지수 소수 자리는 0~4 사이 정수여야 합니다.');
  }
  return {
    kind: 'derived_table',
    transform_id: input.transformId,
    parameters: { decimal_places: input.decimalPlaces },
  };
}

function parseIntake(value: unknown): TaskIntake | null {
  if (!isRecord(value)) return null;
  const internalTitle = asString(value['internal_title']);
  const projectId = asString(value['project_id']);
  const purposeId = asString(value['purpose_id']);
  const recipientId = asString(value['recipient_id']);
  const audience = asString(value['audience']);
  const skillIds = asStringArray(value['skill_ids']);
  if (internalTitle === null || projectId === null || purposeId === null || recipientId === null || audience === null || skillIds === null) {
    return null;
  }
  return {
    internal_title: internalTitle,
    project_id: projectId,
    purpose_id: purposeId,
    recipient_id: recipientId,
    audience,
    skill_ids: skillIds,
  };
}

function parseRule(value: unknown): RuleRecord | null {
  if (!isRecord(value)) return null;
  const id = asNonEmptyString(value['id']);
  const version = asInt(value['version']);
  const selector = asString(value['selector']);
  const revoked = value['revoked'];
  const rawExpires = value['expires_at'];
  const rawGoal = value['goal_variant'];
  if (id === null || version === null || version < 1 || selector === null) return null;
  if (typeof revoked !== 'boolean') return null;
  let expiresAt: string | null = null;
  if (typeof rawExpires === 'string') expiresAt = rawExpires;
  else if (rawExpires !== null) return null;
  let scope: Scope;
  let representation: Representation;
  try {
    scope = parseScope(value['scope']);
    representation = parseRepresentation(value['representation']);
  } catch {
    return null;
  }
  return {
    id,
    version,
    scope,
    selector,
    representation,
    expiresAt,
    revoked,
    goalVariant: typeof rawGoal === 'string' ? rawGoal : null,
  };
}

function parseRuleEnvelope(body: unknown): RuleRecord | null {
  if (!isRecord(body)) return null;
  const data = body['data'];
  if (!isRecord(data)) return null;
  return parseRule(data);
}

function parseRuleList(body: unknown): RuleRecord[] | null {
  if (!isRecord(body)) return null;
  const data = body['data'];
  if (!isRecord(data)) return null;
  const entries = data['rules'];
  if (!Array.isArray(entries)) return null;
  const rules: RuleRecord[] = [];
  for (const entry of entries) {
    const rule = parseRule(entry);
    // 형식이 깨진 항목을 조용히 버리면 화면이 최신 상태를 잘못 보여 준다. 목록 전체를 거부한다.
    if (!rule) return null;
    rules.push(rule);
  }
  return rules;
}

function parseTaskDetail(body: unknown): TaskDetail | null {
  if (!isRecord(body)) return null;
  const data = body['data'];
  if (!isRecord(data)) return null;
  const id = asNonEmptyString(data['id']);
  const revision = asInt(data['revision']);
  if (id === null || revision === null || revision < 1) return null;
  let scope: Scope;
  try {
    scope = parseScope(data['scope']);
  } catch {
    return null;
  }
  let intake: TaskIntake | null = null;
  const rawIntake = data['intake'];
  if (rawIntake !== null && rawIntake !== undefined) {
    const parsed = parseIntake(rawIntake);
    if (!parsed) return null;
    intake = parsed;
  }
  return { id, revision, scope, intake };
}

function parseTaskRevision(body: unknown): { id: string; revision: number } | null {
  if (!isRecord(body)) return null;
  const data = body['data'];
  if (!isRecord(data)) return null;
  const id = asNonEmptyString(data['id']);
  const revision = asInt(data['revision']);
  if (id === null || revision === null || revision < 1) return null;
  return { id, revision };
}

function parseRevoke(body: unknown): { id: string; affectedTasks: string[] } | null {
  if (!isRecord(body)) return null;
  const data = body['data'];
  if (!isRecord(data)) return null;
  const id = asNonEmptyString(data['id']);
  const affected = asStringArray(data['affected_tasks']);
  if (id === null || affected === null) return null;
  return { id, affectedTasks: affected };
}

const base = '/api/v1';

/** 최신 판본 목록을 읽는다. 세션 쿠키는 필요하지만 CSRF 토큰은 쓰지 않는다. */
export function listRules(fetchFn: typeof fetch): Promise<WorkflowResult<RuleRecord[]>> {
  return requestJson(fetchFn, {
    method: 'GET',
    path: `${base}/rules`,
    parse: parseRuleList,
  });
}

/** 현재 작업의 유효한 allow 결정에서 별도 규칙을 저장한다. */
export function saveRule(
  fetchFn: typeof fetch,
  csrfToken: string,
  input: { taskId: string; expectedRevision: number; decisionId: string },
): Promise<WorkflowResult<RuleRecord>> {
  return requestJson(fetchFn, {
    method: 'POST',
    path: `${base}/rules`,
    csrfToken,
    payload: {
      task_id: input.taskId,
      expected_revision: input.expectedRevision,
      decision_id: input.decisionId,
    },
    parse: parseRuleEnvelope,
  });
}

/** 기존 규칙의 새 불변 판본을 만든다. 판본은 줄이지 않고 expected보다 하나 위로만 생긴다. */
export function createRuleVersion(
  fetchFn: typeof fetch,
  csrfToken: string,
  ruleId: string,
  expectedVersion: number,
  representation: Representation,
  expiresAt: string | null,
): Promise<WorkflowResult<RuleRecord>> {
  return requestJson(fetchFn, {
    method: 'POST',
    path: `${base}/rules/${encodeURIComponent(ruleId)}/versions`,
    csrfToken,
    payload: { expected_rule_version: expectedVersion, representation, expires_at: expiresAt },
    parse: parseRuleEnvelope,
  });
}

/** 규칙의 전 판본을 철회한다. 서버는 영향을 받는 작업명을 함께 돌려준다. */
export function revokeRule(
  fetchFn: typeof fetch,
  csrfToken: string,
  ruleId: string,
  expectedVersion: number,
): Promise<WorkflowResult<{ id: string; affectedTasks: string[] }>> {
  return requestJson(fetchFn, {
    method: 'POST',
    path: `${base}/rules/${encodeURIComponent(ruleId)}/revoke`,
    csrfToken,
    payload: { expected_rule_version: expectedVersion },
    parse: parseRevoke,
  });
}

/** 선택한 규칙을 작업에 명시 적용한다. 서버는 전부 성공 또는 전부 거부만 한다. */
export function applyRules(
  fetchFn: typeof fetch,
  csrfToken: string,
  taskId: string,
  expectedRevision: number,
  refs: readonly RuleRef[],
): Promise<WorkflowResult<{ id: string; revision: number }>> {
  return requestJson(fetchFn, {
    method: 'POST',
    path: `${base}/tasks/${encodeURIComponent(taskId)}/rules/apply`,
    csrfToken,
    payload: { expected_revision: expectedRevision, rule_refs: refs.map(ref => ({ id: ref.id, version: ref.version })) },
    parse: parseTaskRevision,
  });
}

/** 선택한 작업의 intake·scope·현재 revision을 읽는다. 규칙 저장 가능 여부를 서버 값으로 판단한다. */
export function readTaskDetail(
  fetchFn: typeof fetch,
  taskId: string,
): Promise<WorkflowResult<TaskDetail>> {
  return requestJson(fetchFn, {
    method: 'GET',
    path: `${base}/tasks/${encodeURIComponent(taskId)}`,
    parse: parseTaskDetail,
  });
}
