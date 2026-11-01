// 작업 목록·이력·실행 정보 API. 목록은 최근 수정순 30개와 다음 커서를 주고,
// 이력은 duration_ms/usage가 미측정이면 null로 남겨 화면이 수치를 추측하지 않게 한다.
import { asInt, asNonEmptyString, asString, isRecord } from './disclosure-contract.ts';
import { requestJson } from './workflow-client.ts';
import type { WorkflowResult } from './workflow-client.ts';

export interface TaskSummary {
  id: string;
  revision: number;
  phase: string;
  internalTitle: string;
  purpose: string;
  recipient: string;
  updatedAt: string;
  currentJobId: string | null;
  currentArtifactId: string | null;
}

export interface TaskPage {
  tasks: TaskSummary[];
  nextCursor: string | null;
}

export interface TaskEvent {
  seq: number;
  revision: number;
  kind: string;
  createdAt: string;
  durationMs: number | null;
  /** null은 서버가 사용량을 측정하지 않았다는 뜻이며 0으로 바꾸지 않는다. */
  usage: string | null;
}



const base = '/api/v1';

function parseTask(value: unknown): TaskSummary | null {
  if (!isRecord(value)) return null;
  const id = asNonEmptyString(value['id']);
  const revision = asInt(value['revision']);
  const phase = asNonEmptyString(value['phase']);
  if (id === null || revision === null || revision < 1 || phase === null) return null;
  const context = isRecord(value['context']) ? value['context'] : {};
  return {
    id,
    revision,
    phase,
    internalTitle: asString(value['internal_title']) ?? '',
    purpose: asString(context['purpose']) ?? '',
    recipient: asString(context['recipient']) ?? '',
    updatedAt: asString(value['updated_at']) ?? '',
    currentJobId: asString(value['current_job_id']),
    currentArtifactId: asString(value['current_artifact_id']),
  };
}

function parseTaskPage(body: unknown): TaskPage | null {
  if (!isRecord(body)) return null;
  const data = body['data'];
  if (!isRecord(data)) return null;
  const rawTasks = data['tasks'];
  const rawCursor = data['next_cursor'];
  if (!Array.isArray(rawTasks)) return null;
  let nextCursor: string | null = null;
  if (typeof rawCursor === 'string') nextCursor = rawCursor;
  else if (rawCursor !== null) return null;
  const tasks: TaskSummary[] = [];
  for (const entry of rawTasks) {
    const task = parseTask(entry);
    // 형식이 깨진 작업을 건너뛰면 목록이 최신 상태를 잘못 보여 준다. 페이지 전체를 거부한다.
    if (!task) return null;
    tasks.push(task);
  }
  return { tasks, nextCursor };
}

function parseDeleted(body: unknown): { id: string } | null {
  if (!isRecord(body)) return null;
  const data = body['data'];
  if (!isRecord(data)) return null;
  const id = asNonEmptyString(data['id']);
  if (id === null || data['deleted'] !== true) return null;
  return { id };
}

function labelList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') labels.push(entry);
    else if (isRecord(entry) && typeof entry['id'] === 'string') labels.push(entry['id']);
  }
  return labels;
}


function measuredUsage(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = JSON.stringify(value);
  return text === undefined ? null : text;
}

function parseEvent(value: unknown): TaskEvent | null {
  if (!isRecord(value)) return null;
  const seq = asInt(value['seq']);
  const revision = asInt(value['revision']);
  const kind = asNonEmptyString(value['kind']);
  const createdAt = asString(value['created_at']);
  const rawDuration = value['duration_ms'];
  if (seq === null || seq < 1 || revision === null || revision < 1 || kind === null || createdAt === null) return null;
  let durationMs: number | null = null;
  if (typeof rawDuration === 'number' && Number.isFinite(rawDuration)) durationMs = rawDuration;
  else if (rawDuration !== null) return null;
  return {
    seq,
    revision,
    kind,
    createdAt,
    durationMs,
    usage: measuredUsage(value['usage']),
  };
}

function parseEventList(body: unknown): TaskEvent[] | null {
  if (!isRecord(body)) return null;
  const data = body['data'];
  if (!isRecord(data)) return null;
  const entries = data['events'];
  if (!Array.isArray(entries)) return null;
  const events: TaskEvent[] = [];
  for (const entry of entries) {
    const event = parseEvent(entry);
    if (!event) return null;
    events.push(event);
  }
  return events;
}

/** 선택한 작업의 목록을 최근 수정순으로 읽는다. cursor가 있으면 그 지점 다음부터 이어 읽는다. */
export function listTasks(
  fetchFn: typeof fetch,
  cursor: string | null,
): Promise<WorkflowResult<TaskPage>> {
  const query = cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`;
  return requestJson(fetchFn, {
    method: 'GET',
    path: `${base}/tasks${query}`,
    parse: parseTaskPage,
  });
}

/**
 * 선택한 작업을 현재 판본으로 삭제한다. 실행 중 job 종료와 기존 규칙 보존은 서버가 처리한다.
 */
export function deleteTask(
  fetchFn: typeof fetch,
  csrfToken: string,
  taskId: string,
  expectedRevision: number,
): Promise<WorkflowResult<{ id: string }>> {
  return requestJson(fetchFn, {
    method: 'DELETE',
    path: `${base}/tasks/${encodeURIComponent(taskId)}`,
    csrfToken,
    payload: { expected_revision: expectedRevision },
    parse: parseDeleted,
  });
}

/** 작업 이력을 시간순으로 읽는다. 서버는 한 번에 최대 100개를 돌려준다. */
export function listTaskEvents(
  fetchFn: typeof fetch,
  taskId: string,
  after: number,
): Promise<WorkflowResult<TaskEvent[]>> {
  return requestJson(fetchFn, {
    method: 'GET',
    path: `${base}/tasks/${encodeURIComponent(taskId)}/events?after=${encodeURIComponent(String(after))}`,
    parse: parseEventList,
  });
}

/** 인증된 실행 정보를 읽는다. 값이 없으면 null로 남기고 다른 값으로 추정하지 않는다. */

const PHASE_LABELS: Record<string, string> = {
  needs_analysis: '분석 전',
  needs_decisions: '공개 결정 필요',
  processing: '처리 중',
  needs_attention: '확인 필요',
  ready_to_generate: '초안 생성 가능',
  ready_to_finalize: '확정 가능',
  finalized: '확정됨',
};

export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}

const EVENT_LABELS: Record<string, string> = {
  task_created: '작업 생성',
  task_changed: '작업 변경',
  writer_started: '초안 작성 시작',
  review_started: '초안 검토 시작',
  files_review_started: '파일 검토 시작',
  job_failed: '작업 실패',
  job_cancel_requested: '작업 취소 요청',
  artifact_created: '초안 파일 생성',
  rule_conflict: '규칙 결과 충돌',
  rule_transform_failed: '규칙 변환 실패',
};

export function eventKindLabel(kind: string): string {
  return EVENT_LABELS[kind] ?? kind;
}
