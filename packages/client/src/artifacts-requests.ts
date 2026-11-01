import { newIdempotencyKey } from './disclosure-contract.ts';
import { dataOf, failureKind, malformed, parseArtifact, parseArtifactJob, parseExport, parseTaskAggregate, readErrorCode, requestJson } from './artifacts-contract.ts';
import type { ArtifactJob, ArtifactResult, ArtifactView, DownloadedBytes, ExportInfo, FetchFn, HumanReviewChecklist, TaskAggregate } from './artifacts-contract.ts';

export async function readTask(fetchFn: FetchFn, taskId: string): Promise<ArtifactResult<TaskAggregate>> {
  const response = await requestJson(fetchFn, 'GET', `/api/v1/tasks/${encodeURIComponent(taskId)}`, null);
  if (!response.ok) return response;
  try {
    return { ok: true, value: parseTaskAggregate(response.body) };
  } catch {
    return malformed(response.status);
  }
}

/** 현재 초안을 읽는다. 초안이 아직 없으면 null이며 오류가 아니다. */
export async function readCurrentArtifact(fetchFn: FetchFn, taskId: string): Promise<ArtifactResult<ArtifactView | null>> {
  const response = await requestJson(fetchFn, 'GET', `/api/v1/tasks/${encodeURIComponent(taskId)}/bundle`, null);
  if (!response.ok) {
    if (response.failure.kind === 'not_found') return { ok: true, value: null };
    return response;
  }
  try {
    return { ok: true, value: parseArtifact(response.body) };
  } catch {
    return malformed(response.status);
  }
}

export type ArtifactJobArguments = { provisional?: boolean } | { artifact_id: string; expected_artifact_set_hash: string };

/** compose/review job을 시작한다. expected_revision은 현재 작업 판본이어야 한다. */
export async function startArtifactJob(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  expectedRevision: number,
  kind: 'compose' | 'review',
  args: ArtifactJobArguments | null,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<ArtifactResult<ArtifactJob>> {
  const response = await requestJson(fetchFn, 'POST', `/api/v1/tasks/${encodeURIComponent(taskId)}/jobs`, csrfToken, {
    payload: {
      expected_revision: expectedRevision,
      kind,
      ...(args === null ? {} : { arguments: args }),
    },
    idempotencyKey,
  });
  if (!response.ok) return response;
  try {
    return { ok: true, value: parseArtifactJob(response.body) };
  } catch {
    return malformed(response.status);
  }
}

export async function readArtifactJob(
  fetchFn: FetchFn,
  taskId: string,
  jobId: string,
): Promise<ArtifactResult<ArtifactJob>> {
  const response = await requestJson(
    fetchFn,
    'GET',
    `/api/v1/tasks/${encodeURIComponent(taskId)}/jobs/${encodeURIComponent(jobId)}`,
    null,
  );
  if (!response.ok) return response;
  try {
    return { ok: true, value: parseArtifactJob(response.body) };
  } catch {
    return malformed(response.status);
  }
}

export async function cancelArtifactJob(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  jobId: string,
  expectedRevision: number,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<ArtifactResult<{ cancelRequested: boolean }>> {
  const response = await requestJson(
    fetchFn,
    'POST',
    `/api/v1/tasks/${encodeURIComponent(taskId)}/jobs/${encodeURIComponent(jobId)}/cancel`,
    csrfToken,
    { payload: { expected_revision: expectedRevision }, idempotencyKey },
  );
  if (!response.ok) return response;
  const data = dataOf(response.body);
  if (!data || typeof data.cancel_requested !== 'boolean') return malformed(response.status);
  return { ok: true, value: { cancelRequested: data.cancel_requested } };
}


export async function recordHumanReview(
  fetchFn: FetchFn,
  csrfToken: string,
  artifactId: string,
  expectedRevision: number,
  targetHash: string,
  checklist: HumanReviewChecklist,
  fallbackReason: string,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<ArtifactResult<ArtifactView>> {
  const response = await requestJson(
    fetchFn,
    'POST',
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/human-review`,
    csrfToken,
    {
      payload: { expected_revision: expectedRevision, target_hash: targetHash, checklist, fallback_reason: fallbackReason },
      idempotencyKey,
    },
  );
  if (!response.ok) return response;
  try {
    return { ok: true, value: parseArtifact(response.body) };
  } catch {
    return malformed(response.status);
  }
}

export async function finalizeTask(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  expectedRevision: number,
  artifactId: string,
  expectedArtifactSetHash: string,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<ArtifactResult<ExportInfo>> {
  const response = await requestJson(fetchFn, 'POST', `/api/v1/tasks/${encodeURIComponent(taskId)}/finalize`, csrfToken, {
    payload: {
      expected_revision: expectedRevision,
      artifact_id: artifactId,
      expected_artifact_set_hash: expectedArtifactSetHash,
    },
    idempotencyKey,
  });
  if (!response.ok) return response;
  try {
    return { ok: true, value: parseExport(response.body) };
  } catch {
    return malformed(response.status);
  }
}

/** 내부 확인용 실제 파일 bytes. 확정 다운로드와 별개다. */
export async function readArtifactFile(
  fetchFn: FetchFn,
  artifactId: string,
  path: string,
): Promise<ArtifactResult<{ bytes: Uint8Array<ArrayBuffer>; mediaType: string }>> {
  let response: Response;
  try {
    response = await fetchFn(
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}/files/${encodeURIComponent(path)}`,
      { method: 'GET', headers: { Accept: '*/*' }, credentials: 'same-origin' },
    );
  } catch {
    return { ok: false, failure: { kind: 'network', status: 0, code: '' } };
  }
  if (!response.ok) {
    return { ok: false, failure: { kind: failureKind(response.status), status: response.status, code: await readErrorCode(response) } };
  }
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { ok: true, value: { bytes, mediaType: response.headers.get('content-type') ?? 'application/octet-stream' } };
  } catch {
    return malformed(response.status);
  }
}

function basename(value: string): string {
  const cleaned = value.replaceAll('\\', '/').split('/').filter((part) => part !== '' && part !== '.' && part !== '..');
  return cleaned.at(-1) ?? '';
}

function filenameFrom(disposition: string | null, fallback: string): string {
  if (disposition !== null) {
    const quoted = /filename="([^"]+)"/.exec(disposition);
    const plain = quoted === null ? /filename=([^;]+)/.exec(disposition) : null;
    const candidate = basename(quoted?.[1] ?? plain?.[1] ?? '');
    if (candidate !== '') return candidate;
  }
  return basename(fallback) === '' ? 'safehandoff-download' : basename(fallback);
}

/** 확정된 동일 bytes만 내려받는다. 아카이브(path=null)와 개별 파일 모두 서버 재검사를 거친다. */
export async function readExportBytes(
  fetchFn: FetchFn,
  exportId: string,
  path: string | null,
): Promise<ArtifactResult<DownloadedBytes>> {
  const url = path === null
    ? `/api/v1/exports/${encodeURIComponent(exportId)}/archive`
    : `/api/v1/exports/${encodeURIComponent(exportId)}/files/${encodeURIComponent(path)}`;
  let response: Response;
  try {
    response = await fetchFn(url, { method: 'GET', headers: { Accept: '*/*' }, credentials: 'same-origin' });
  } catch {
    return { ok: false, failure: { kind: 'network', status: 0, code: '' } };
  }
  if (!response.ok) {
    return { ok: false, failure: { kind: failureKind(response.status), status: response.status, code: await readErrorCode(response) } };
  }
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      ok: true,
      value: {
        bytes,
        filename: filenameFrom(response.headers.get('content-disposition'), path ?? 'safehandoff.zip'),
        mediaType: response.headers.get('content-type') ?? 'application/octet-stream',
      },
    };
  } catch {
    return malformed(response.status);
  }
}

/** 브라우저 저장 동작. DOM이 없는 환경에서는 false를 돌려주고 성공을 가장하지 않는다. */
export function saveDownload(file: DownloadedBytes): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const blob = new Blob([file.bytes], { type: file.mediaType });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.filename;
    anchor.rel = 'noopener';
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // 클릭 뒤 즉시 해제하면 일부 브라우저가 저장을 시작하지 못하므로 다음 작업으로 미룬다.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return true;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
