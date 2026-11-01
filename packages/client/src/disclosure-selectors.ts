// 공개 결정의 파생 값과 명령 계획. 상태를 바꾸지 않고 현재 상태와 입력만으로 판단한다.
// 훅은 이 계획을 실행하고, reducer는 응답을 상태로 옮긴다.
import { NO_TOKEN_REASON, REUSABLE_FORBIDDEN, representationSignature, toWireRepresentation } from './disclosure-contract.ts';
import type { Candidate, Disposition, Draft, Representation, SavedDecision, Snapshot } from './disclosure-contract.ts';
import { seriesBlockReason } from './disclosure-state.ts';
import type { DisclosuresState, JobRequest, PreviewRequest } from './disclosure-state.ts';

export function writeBlockReason(state: DisclosuresState, csrfToken: string, busy: boolean = state.busy): string {
  if (csrfToken === '') return NO_TOKEN_REASON;
  if (!state.snapshot) return '작업을 먼저 고르세요.';
  if (state.stale) return '표시 중인 작업 정보가 오래되었습니다. 다시 불러온 뒤 시도하세요.';
  if (busy) return '다른 요청을 처리하는 중입니다.';
  return '';
}

// 철회·만료·supersedes를 반영한 후보별 유효 저장 결정. 과거 allow를 되살리지 않는다.
export function validSavedDecisions(snapshot: Snapshot): Map<string, SavedDecision> {
  const decisions = Object.values(snapshot.decisions);
  const superseded = new Set<string>();
  for (const decision of decisions) {
    if (decision.supersedes_id && decision.supersedes_id !== '') superseded.add(decision.supersedes_id);
  }
  const now = Date.now();
  const effective = new Map<string, SavedDecision>();
  for (const decision of decisions) {
    if (decision.revoked || superseded.has(decision.id)) continue;
    if (decision.expires_at !== null) {
      const expires = Date.parse(decision.expires_at);
      if (!Number.isFinite(expires) || expires <= now) continue;
    }
    // 같은 후보에 유효 결정이 여러 개면 서버 응답 순서상 마지막 것을 쓴다.
    effective.set(decision.candidate_id, decision);
  }
  return effective;
}

export function canGenerate(state: DisclosuresState): boolean {
  const snapshot = state.snapshot;
  if (!snapshot || state.stale || state.busy) return false;
  // 생성은 저장된 결정을 근거로 한다. 저장 전 draft·미리보기는 여기서 세지 않는다.
  const effective = validSavedDecisions(snapshot);
  let allows = 0;
  for (const cand of snapshot.candidates) {
    const allowed = effective.get(cand.id)?.disposition === 'allow';
    if (cand.required && !allowed) return false;
    if (allowed) allows += 1;
  }
  if (allows === 0) return false;
  // 생성 API는 아직 연결되지 않았다. 충돌 해결 규칙을 여기서 추정하지 않는다.
  return true;
}

function describe(cand: Candidate): string {
  const short = cand.statement.length > 40 ? `${cand.statement.slice(0, 40)}…` : cand.statement;
  return `"${short}"`;
}

export interface DecisionOperation {
  candidate: Candidate;
  draft: Draft;
  disposition: Disposition;
}

export function collectOperations(state: DisclosuresState): DecisionOperation[] {
  const operations: DecisionOperation[] = [];
  for (const cand of state.snapshot?.candidates ?? []) {
    const draft = state.drafts.get(cand.id);
    if (!draft || draft.disposition === null) continue;
    operations.push({ candidate: cand, draft, disposition: draft.disposition });
  }
  return operations;
}

function allowReadyReason(snapshot: Snapshot, cand: Candidate, draft: Draft): string {
  const rep = draft.representation;
  if (!rep) {
    if (draft.mode === 'C') return `${describe(cand)}의 C(선택 필드)는 공개할 필드를 하나 이상 골라야 저장할 수 있습니다.`;
    return `${describe(cand)}의 공개 방식(A·B·C·D)을 먼저 고르세요.`;
  }
  if (rep.kind === 'selected_fields') {
    const fields = rep.parameters?.fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      return `${describe(cand)}의 C(선택 필드)는 공개할 필드를 하나 이상 골라야 저장할 수 있습니다.`;
    }
  }
  if (draft.mode === 'B') {
    const reason = seriesBlockReason(cand, snapshot.evidence);
    if (reason !== '') return `${describe(cand)} ${reason}`;
  }
  if (draft.mode === 'D' && draft.interpretation !== 'supported') {
    return `${describe(cand)}의 D 조건은 해석이 끝나 적용 가능해야 저장할 수 있습니다.`;
  }
  const preview = draft.preview;
  if (!preview) return `${describe(cand)}의 미리보기를 먼저 확인하세요.`;
  if (preview.candidate_id !== cand.id || preview.input_revision !== snapshot.revision) {
    return `${describe(cand)}의 미리보기가 현재 작업 판본과 맞지 않아 다시 만들어야 합니다.`;
  }
  if (representationSignature(preview.representation) !== representationSignature(rep)) {
    return `${describe(cand)}의 미리보기와 고른 공개 방식이 달라 다시 확인해야 합니다.`;
  }
  if (preview.preview_id === '' || preview.projection_sha256 === '') {
    return `${describe(cand)}의 미리보기 식별자·해시가 비어 있어 저장할 수 없습니다.`;
  }
  return '';
}

export function batchBlockReason(
  state: DisclosuresState,
  csrfToken: string,
  busy: boolean = state.busy,
): string {
  const blocked = writeBlockReason(state, csrfToken, busy);
  if (blocked !== '') return blocked;
  const snapshot = state.snapshot;
  if (!snapshot) return '작업을 먼저 불러오세요.';
  const operations = collectOperations(state);
  if (operations.length === 0) return '저장할 결정이 없습니다. 후보마다 허용·제외·보류 중 하나를 고르세요.';
  if (operations.length > 30) return '한 번에 30개까지만 저장할 수 있어 임의로 나누어 보내지 않습니다.';
  for (const operation of operations) {
    if (operation.disposition !== 'allow') continue;
    const reason = allowReadyReason(snapshot, operation.candidate, operation.draft);
    if (reason !== '') return reason;
  }
  // F03 §3의 충돌 요구는 "두 근거와 미확인 사실을 함께 보여주고 하나를 몰래
  // 고르지 않는 것"뿐이다. 해결 규칙(최대 1개 허용 등)을 클라이언트가 만들어
  // 저장을 막지 않는다. 충돌 표시는 화면 담당이 양쪽 근거로 보여준다.
  return '';
}

export type LoadTaskPlan =
  | { kind: 'notice'; message: string }
  | { kind: 'request'; taskId: string };

export function planLoadTask(id: string): LoadTaskPlan {
  const taskId = id.trim();
  if (taskId === '') return { kind: 'notice', message: '작업 ID를 입력하세요.' };
  return { kind: 'request', taskId };
}

export type PreviewPlan =
  | { kind: 'notice'; message: string }
  | { kind: 'draft-notice'; id: string; message: string }
  | { kind: 'request'; taskId: string; representation: Representation; request: PreviewRequest };

export function planPreview(
  state: DisclosuresState,
  csrfToken: string,
  id: string,
  draftOverride?: Draft,
  busy: boolean = state.busy,
): PreviewPlan {
  const blocked = writeBlockReason(state, csrfToken, busy);
  if (blocked !== '') return { kind: 'notice', message: blocked };
  const snapshot = state.snapshot;
  const candidate = snapshot?.candidates.find((item) => item.id === id) ?? null;
  if (!snapshot || !candidate) return { kind: 'notice', message: '작업을 먼저 불러오세요.' };
  const draft = draftOverride ?? state.drafts.get(id);
  if (!draft || draft.mode === null) {
    return { kind: 'draft-notice', id, message: '공개 방식(A·B·C·D)을 먼저 고르세요.' };
  }
  if (draft.mode === 'D' && draft.interpretation !== 'supported') {
    return { kind: 'draft-notice', id, message: 'D는 조건 확인(해석)이 지원(supported)되어야 미리보기가 가능합니다.' };
  }
  if (draft.mode === 'B') {
    const reason = seriesBlockReason(candidate, snapshot.evidence);
    if (reason !== '') return { kind: 'draft-notice', id, message: reason };
  }
  const representation = draft.representation;
  if (!representation) {
    return {
      kind: 'draft-notice',
      id,
      message: draft.mode === 'C'
        ? 'C(선택 필드)는 서버가 준 필드 목록에서 공개할 필드를 하나 이상 골라야 미리보기를 만들 수 있습니다.'
        : '전송할 표현 방식이 정해지지 않았습니다.',
    };
  }
  if (representation.kind === 'selected_fields') {
    const fields = representation.parameters?.fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      return {
        kind: 'draft-notice',
        id,
        message: 'C(선택 필드)는 공개할 필드를 하나 이상 골라야 미리보기를 만들 수 있습니다.',
      };
    }
    if (!draft.selection.size || !fields.every((field) => draft.selection.get(field) === true)) {
      return {
        kind: 'draft-notice',
        id,
        message: 'C(선택 필드)의 표현과 체크박스 선택이 어긋나 미리보기를 보내지 않습니다. 필드를 다시 고르세요.',
      };
    }
  }
  return {
    kind: 'request',
    taskId: snapshot.id,
    representation,
    request: {
      loadSeq: state.loadSeq,
      revision: snapshot.revision,
      candidateId: id,
      mode: draft.mode,
      condition: draft.condition,
      signature: representationSignature(representation),
    },
  };
}

export type InterpretPlan =
  | { kind: 'notice'; message: string }
  | { kind: 'draft-notice'; id: string; message: string }
  | { kind: 'request'; taskId: string; text: string; request: JobRequest };

export function planInterpret(
  state: DisclosuresState,
  csrfToken: string,
  id: string,
  busy: boolean = state.busy,
): InterpretPlan {
  const blocked = writeBlockReason(state, csrfToken, busy);
  if (blocked !== '') return { kind: 'notice', message: blocked };
  const snapshot = state.snapshot;
  if (!snapshot || !snapshot.candidates.some((item) => item.id === id)) {
    return { kind: 'notice', message: '작업을 먼저 불러오세요.' };
  }
  const draft = state.drafts.get(id);
  if (!draft || draft.mode !== 'D') {
    return { kind: 'draft-notice', id, message: 'D 방식을 먼저 고르고 조건을 적으세요.' };
  }
  const text = draft.condition.trim();
  if (text === '') return { kind: 'draft-notice', id, message: '해석할 조건을 먼저 적으세요.' };
  return {
    kind: 'request',
    taskId: snapshot.id,
    text,
    request: { loadSeq: state.loadSeq, revision: snapshot.revision, condition: draft.condition, jobId: null },
  };
}

export type RefreshInterpretationPlan =
  | { kind: 'notice'; message: string }
  | { kind: 'draft-notice'; id: string; message: string }
  | { kind: 'request'; taskId: string; jobId: string; request: JobRequest };

// 해석 상태 조회는 읽기(GET)라 CSRF 토큰 없이도 보낸다.
export function planRefreshInterpretation(
  state: DisclosuresState,
  id: string,
  busy: boolean = state.busy,
): RefreshInterpretationPlan {
  if (busy) return { kind: 'notice', message: '다른 요청을 처리하는 중입니다.' };
  if (state.stale) return { kind: 'notice', message: '표시 중인 작업 정보가 오래되었습니다. 다시 불러온 뒤 조회하세요.' };
  const snapshot = state.snapshot;
  if (!snapshot) return { kind: 'notice', message: '작업을 먼저 불러오세요.' };
  const draft = state.drafts.get(id);
  if (!draft || !draft.jobId) {
    return { kind: 'notice', message: '조회할 해석 작업이 없습니다. 먼저 조건 확인을 누르세요.' };
  }
  if (draft.jobStatus !== 'queued' && draft.jobStatus !== 'running' && draft.jobStatus !== 'cancel_requested') {
    return {
      kind: 'draft-notice',
      id,
      message: '이미 끝난 해석은 다시 조회하지 않습니다. 대기·진행·취소 접수 상태일 때만 조회합니다.',
    };
  }
  return {
    kind: 'request',
    taskId: snapshot.id,
    jobId: draft.jobId,
    request: {
      loadSeq: state.loadSeq,
      revision: snapshot.revision,
      condition: draft.condition,
      jobId: draft.jobId,
    },
  };
}

export type ApplyPlan =
  | { kind: 'notice'; message: string }
  | { kind: 'request'; taskId: string; body: string };

export function planApply(
  state: DisclosuresState,
  csrfToken: string,
  busy: boolean = state.busy,
): ApplyPlan {
  const reason = batchBlockReason(state, csrfToken, busy);
  if (reason !== '') return { kind: 'notice', message: reason };
  const snapshot = state.snapshot;
  if (!snapshot) return { kind: 'notice', message: '작업을 먼저 불러오세요.' };
  const operations = collectOperations(state).map((operation) => {
    const representation = operation.draft.representation;
    const preview = operation.draft.preview;
    if (operation.disposition !== 'allow' || !representation || !preview) {
      return { candidate_id: operation.candidate.id, disposition: operation.disposition };
    }
    const effectiveReusable = operation.draft.reusable && REUSABLE_FORBIDDEN[representation.kind] !== true;
    return {
      candidate_id: operation.candidate.id,
      disposition: operation.disposition,
      representation: toWireRepresentation(representation),
      preview_id: preview.preview_id,
      projection_sha256: preview.projection_sha256,
      save_reusable_rule: effectiveReusable,
    };
  });
  return {
    kind: 'request',
    taskId: snapshot.id,
    body: JSON.stringify({
      expected_revision: snapshot.revision,
      accept_scope_reduction: operations.some(op => op.disposition === 'exclude' && snapshot.candidates.some(c => c.id === op.candidate_id && c.required)),
      operations,
    }),
  };
}

export type RevokePlan =
  | { kind: 'notice'; message: string }
  | { kind: 'request'; taskId: string; revision: number; decisionId: string };

export function planRevoke(
  state: DisclosuresState,
  csrfToken: string,
  decisionId: string,
  busy: boolean = state.busy,
): RevokePlan {
  const blocked = writeBlockReason(state, csrfToken, busy);
  if (blocked !== '') return { kind: 'notice', message: blocked };
  const snapshot = state.snapshot;
  if (!snapshot) return { kind: 'notice', message: '작업을 먼저 불러오세요.' };
  const target = decisionId.trim();
  if (target === '') return { kind: 'notice', message: '철회할 결정을 고르세요.' };
  return { kind: 'request', taskId: snapshot.id, revision: snapshot.revision, decisionId: target };
}

export type FieldsPlan =
  | { kind: 'notice'; message: string }
  | { kind: 'request'; taskId: string; candidateId: string; loadSeq: number };

// 필드 목록 조회는 읽기(GET)라 CSRF 토큰을 요구하지 않는다. 세션은 서버가 검사한다.
export function planFieldList(state: DisclosuresState, id: string): FieldsPlan {
  const snapshot = state.snapshot;
  if (!snapshot) return { kind: 'notice', message: '작업을 먼저 불러오세요.' };
  if (!snapshot.candidates.some((item) => item.id === id)) {
    return { kind: 'notice', message: '목록에 없는 후보의 필드는 불러오지 않습니다.' };
  }
  if (state.stale) {
    return { kind: 'notice', message: '표시 중인 작업 정보가 오래되었습니다. 작업을 다시 불러온 뒤 필드 목록을 요청하세요.' };
  }
  const entry = state.fieldLists.get(id);
  if (entry && entry.status === 'loading') {
    return { kind: 'notice', message: '필드 목록을 이미 불러오는 중입니다.' };
  }
  return { kind: 'request', taskId: snapshot.id, candidateId: id, loadSeq: state.loadSeq };
}
