// 초안 API 경계의 소비자 행동: 요청 판본/hash/멱등 키/CSRF, 응답 DTO 경계, 실패 상태 전이.
// 구현 내부 문구는 검사하지 않는다.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelArtifactJob,
  finalizeTask,
  parseArtifact,
  readExportBytes,
  startArtifactJob,
} from './artifacts-client.ts';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(handler: (call: Call) => Response | Promise<Response>): { calls: Call[]; fetchFn: (input: string, init?: RequestInit) => Promise<Response> } {
  const calls: Call[] = [];
  const fetchFn = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[key.toLowerCase()] = value;
    const call = {
      url: input,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    };
    calls.push(call);
    return handler(call);
  };
  return { calls, fetchFn };
}

function artifactPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    data: {
      id: 'artifact-1',
      task_id: 'task-1',
      revision: 3,
      draft: { schema_version: 'draft.v1', blocks: [{ type: 'heading', text: '제목', level: 1, fact_ids: ['fact-1'] }] },
      review: { schema_version: 'review.v1', result: 'pass', issues: [] },
      review_error_code: null,
      document_hash: 'document-hash',
      artifact_set_hash: 'set-hash',
      review_target_hash: 'set-hash',
      files: [{ path: 'support-request.md', media_type: 'text/markdown; charset=utf-8', size: 10, sha256: 'file-hash' }],
      hard_errors: [],
      human_review: null,
      is_current: true,
      finalizable: true,
      ...overrides,
    },
  };
}

test('compose job은 현재 작업 판본·CSRF·멱등 키로 시작하고 응답 job을 읽는다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({
    data: { id: 'job-1', task_id: 'task-1', input_revision: 4, kind: 'compose', status: 'running', artifact_id: null, error_code: null },
  }, 202));
  const result = await startArtifactJob(fetchFn, 'csrf-token', 'task-1', 3, 'compose', null, 'idem-compose');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.id, 'job-1');
  assert.equal(result.value.inputRevision, 4);
  assert.equal(result.value.status, 'running');
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.method, 'POST');
  assert.equal(call.url, '/api/v1/tasks/task-1/jobs');
  assert.equal(call.headers['x-csrf-token'], 'csrf-token');
  assert.equal(call.headers['idempotency-key'], 'idem-compose');
  assert.deepEqual(JSON.parse(call.body), { expected_revision: 3, kind: 'compose' });
});

test('review job은 검토 대상 artifact id와 파일 집합 hash를 그대로 보낸다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({
    data: { id: 'job-2', task_id: 'task-1', input_revision: 5, kind: 'review', status: 'running', artifact_id: null, error_code: null },
  }, 202));
  const result = await startArtifactJob(fetchFn, 'csrf-token', 'task-1', 4, 'review', {
    artifact_id: 'artifact-1',
    expected_artifact_set_hash: 'set-hash',
  }, 'idem-review');
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(calls[0]!.body), {
    expected_revision: 4,
    kind: 'review',
    arguments: { artifact_id: 'artifact-1', expected_artifact_set_hash: 'set-hash' },
  });
});

test('job 취소는 현재 작업 판본을 expected_revision으로 보낸다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({ data: { cancel_requested: true } }, 202));
  const result = await cancelArtifactJob(fetchFn, 'csrf-token', 'task-1', 'job-1', 7, 'idem-cancel');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.cancelRequested, true);
  assert.equal(calls[0]!.url, '/api/v1/tasks/task-1/jobs/job-1/cancel');
  assert.deepEqual(JSON.parse(calls[0]!.body), { expected_revision: 7 });
});

test('finalize는 확정 확인·artifact id·파일 집합 hash를 실어 export를 읽는다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({
    data: {
      id: 'export-1', task_id: 'task-1', revision: 9, artifact_id: 'artifact-1',
      artifact_set_hash: 'set-hash', archive_sha256: 'zip-hash',
    },
  }));
  const result = await finalizeTask(fetchFn, 'csrf-token', 'task-1', 8, 'artifact-1', 'set-hash', 'idem-finalize');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.id, 'export-1');
  assert.equal(result.value.revision, 9);
  assert.equal(result.value.archiveSha256, 'zip-hash');
  assert.equal(calls[0]!.url, '/api/v1/tasks/task-1/finalize');
  assert.deepEqual(JSON.parse(calls[0]!.body), {
    expected_revision: 8,
    artifact_id: 'artifact-1',
    expected_artifact_set_hash: 'set-hash',
    confirmed: true,
  });
});

test('문서 전체 대상 지적은 block_id 없이도 초안을 읽는다', () => {
  const parsed = parseArtifact(artifactPayload({
    review: { schema_version: 'review.v1', result: 'needs_changes', issues: [{
      target: { kind: 'document' }, reason_code: 'UNCERTAINTY_REMOVED', action: null,
      approved_fact_ids: [], candidate_ids: [], internal_explanation: 'fixture',
    }] },
  }));
  assert.equal(parsed.review?.result, 'needs_changes');
  assert.equal(parsed.review?.issues[0]?.blockId, null);
});

test('artifact DTO에서 현재 여부나 확정 가능 여부가 사라지면 적용하지 않는다', () => {
  const parsed = parseArtifact(artifactPayload());
  assert.equal(parsed.id, 'artifact-1');
  assert.equal(parsed.review?.result, 'pass');
  assert.equal(parsed.files[0]?.path, 'support-request.md');
  assert.equal(parsed.finalizable, true);
  assert.throws(() => parseArtifact(artifactPayload({ is_current: undefined })));
  assert.throws(() => parseArtifact(artifactPayload({ files: [{ path: '', media_type: 'text/plain', size: 1, sha256: 'x' }] })));
});


test('확정 파일 다운로드는 저장된 바이트와 응답 파일명을 그대로 돌려준다', async () => {
  const bytes = new TextEncoder().encode('hello');
  const fetchFn = async (): Promise<Response> => new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="support-request.md"',
    },
  });
  const result = await readExportBytes(fetchFn, 'export-1', 'support-request.md');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(new TextDecoder().decode(result.value.bytes), 'hello');
  assert.equal(result.value.filename, 'support-request.md');
  assert.equal(result.value.mediaType, 'text/markdown; charset=utf-8');
});

test('무효가 된 export는 충돌로 구분해 화면이 재조회할 수 있게 한다', async () => {
  const fetchFn = async (): Promise<Response> => jsonResponse({ error: 'EXPORT_INVALIDATED' }, 409);
  const result = await readExportBytes(fetchFn, 'export-1', null);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.kind, 'conflict');
  assert.equal(result.failure.code, 'EXPORT_INVALIDATED');
});
