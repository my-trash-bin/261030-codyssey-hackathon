// 공개 결정 상태·요청 수명. 토큰을 제공받은 경우에만 쓰기를 보낸다.
import { REPRESENTATION_KINDS, JOB_STATUSES, REUSABLE_FORBIDDEN, KNOWN_CANDIDATE_KEYS, isRepresentationKind, isRecord, asString, asNonEmptyString, asInt, asStringArray, parseRepresentation, representationSignature, toWireRepresentation, parseProjection, parsePreview, parseCandidate, parseSavedDecision, parseEvidence, parseSource, parseScope, parseSnapshot, parseProposal, parseJob, serverErrorCode, newIdempotencyKey, NO_TOKEN_REASON } from './disclosure-contract.ts';
import type { Mode, Disposition, Interpretation, Representation, Candidate, Projection, Preview, SavedDecision, EvidenceLocator, Evidence, Source, Scope, Snapshot, Draft, BatchRetry, Proposal, Job } from './disclosure-contract.ts';
export type * from './disclosure-contract.ts';

export class DisclosureWorkspace {
  snapshot: Snapshot | null = null;
  drafts: Map<string, Draft> = new Map();
  busy = false;
  message = '';
  acceptScopeReduction = false;

  private onChange: () => void;
  private csrfToken: string | undefined;
  private readonly fetchFn: typeof fetch;
  private requestSeq = 0;
  private stale = false;
  private lastBatch: BatchRetry | null = null;

  constructor(onChange: () => void, options?: { csrfToken?: string; fetch?: typeof fetch }) {
    this.onChange = onChange;
    if (options?.csrfToken !== undefined && options.csrfToken !== '') this.csrfToken = options.csrfToken;
    // 브라우저의 window.fetch는 receiver를 요구하므로 클래스 필드로 옮겨 호출하면 Illegal invocation이 난다.
    const source = options?.fetch ?? globalThis.fetch;
    this.fetchFn = source.bind(globalThis);
  }

  get writeBlockReason(): string {
    if (!this.csrfToken) return NO_TOKEN_REASON;
    if (!this.snapshot) return '쓰기가 차단됩니다: 작업을 먼저 불러오세요.';
    if (this.stale) return '쓰기가 차단됩니다: 표시 중인 작업 정보가 오래되었습니다. 다시 불러온 뒤 시도하세요.';
    if (this.busy) return '쓰기가 차단됩니다: 다른 요청을 처리하는 중입니다.';
    return '';
  }

  get batchBlockReason(): string {
    const blocked = this.writeBlockReason;
    if (blocked !== '') return blocked;
    const snap = this.snapshot;
    if (!snap) return '작업을 먼저 불러오세요.';
    for (const cand of snap.candidates) {
      if (!cand.required) continue;
      const draft = this.drafts.get(cand.id);
      // 미선택 required는 저장을 막지 않는다(F03:95~99 저장과 최종화 구분).
      // operations에서 빠질 뿐 자동 allow로 채우지 않으며, 미완료 표시는 canGenerate가 맡는다.
      // 범위 축소 동의는 required를 이번 결과에서 빼는 exclude에만 요구한다.
      // defer는 최종 확정 전 해소할 임시 결정이라 동의 대상이 아니다(F03:96).
      if (draft && draft.disposition === 'exclude' && !this.acceptScopeReduction) {
        return `필수 ${this.describe(cand)}를 이번 결과에서 제외하려면 범위 축소에 동의해야 합니다.`;
      }
    }
    const ops = this.collectOperations(snap);
    if (ops.length === 0) return '적용할 결정이 없습니다. 후보마다 공개·제외·보류 중 하나를 고르세요.';
    if (ops.length > 30) return '한 번에 30개까지만 저장할 수 있어 임의로 나누어 보내지 않습니다.';
    for (const op of ops) {
      if (op.disposition !== 'allow') continue;
      const reason = this.allowReadyReason(snap, op.candidate, op.draft);
      if (reason !== '') return reason;
    }
    // F03 §3의 충돌 요구는 "두 근거와 미확인 사실을 함께 보여주고 하나를 몰래
    // 고르지 않는 것"뿐이다. 해결 규칙(최대 1개 허용 등)을 클라이언트가 만들어
    // 저장을 막지 않는다. 충돌 표시는 화면 담당이 양쪽 근거로 보여준다.
    return '';
  }

  get canGenerate(): boolean {
    const snap = this.snapshot;
    if (!snap || this.stale || this.busy) return false;
    // 생성은 저장된 결정을 근거로 한다. 저장 전 draft·미리보기는 여기서 세지 않는다.
    const effective = this.validSavedDecisions(snap);
    let allows = 0;
    for (const cand of snap.candidates) {
      const allowed = effective.get(cand.id)?.disposition === 'allow';
      if (cand.required && !allowed) return false;
      if (allowed) allows += 1;
    }
    if (allows === 0) return false;
    // 생성 API는 아직 연결되지 않았다. 충돌 해결 규칙을 여기서 추정하지 않는다.
    return true;
  }

  // 철회·만료·supersedes를 반영한 후보별 유효 저장 결정. 과거 allow를 되살리지 않는다.
  private validSavedDecisions(snap: Snapshot): Map<string, SavedDecision> {
    const decisions = Object.values(snap.decisions);
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

  async loadTask(id: string): Promise<void> {
    const taskId = id.trim();
    if (taskId === '') {
      this.message = '작업 ID를 입력하세요.';
      this.notify();
      return;
    }
    const owner = this.beginRequest();
    const previous = this.snapshot;
    this.message = '작업을 불러오는 중입니다.';
    this.notify();
    let response: Response;
    try {
      response = await this.fetchFn(`/api/v1/tasks/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
    } catch {
      if (!this.ownsRequest(owner)) return;
      this.endRequest(owner);
      if (previous) {
        this.stale = true;
        this.message = '작업 조회에 실패했습니다. 표시 중인 정보는 오래된 것이므로 저장이 차단됩니다.';
      } else {
        this.message = '작업 조회에 실패했습니다. 백엔드에 연결할 수 없습니다.';
      }
      this.notify();
      return;
    }
    let body: unknown = null;
    try {
      body = (await response.json()) as unknown;
    } catch {
      body = null;
    }
    if (!this.ownsRequest(owner)) return;
    this.endRequest(owner);
    if (!response.ok) {
      if (previous) {
        this.stale = true;
        this.message =
          `작업 조회에 실패했습니다(${response.status}${serverErrorCode(body)}). ` +
          '표시 중인 정보는 오래된 것이므로 저장이 차단됩니다.';
      } else if (response.status === 404) {
        this.message =
          '작업을 조회하지 못했습니다(404). 작업 ID 또는 서버의 작업 조회 API 제공 여부를 확인하세요.';
      } else {
        this.message = `작업 조회에 실패했습니다(${response.status}${serverErrorCode(body)}).`;
      }
      this.notify();
      return;
    }
    let snap: Snapshot;
    try {
      snap = parseSnapshot(body);
    } catch {
      if (previous) this.stale = true;
      this.message = '작업 응답을 해석할 수 없어 성공으로 처리하지 않았습니다.';
      this.notify();
      return;
    }
    if (snap.id !== taskId) {
      if (previous) this.stale = true;
      this.message = '요청한 작업 ID와 응답 ID가 달라 성공으로 처리하지 않았습니다.';
      this.notify();
      return;
    }
    const changed = !previous || previous.id !== snap.id;
    this.snapshot = snap;
    this.stale = false;
    if (changed) {
      this.drafts.clear();
      this.acceptScopeReduction = false;
      this.lastBatch = null;
      this.message = '작업을 불러왔습니다.';
    } else if (previous && previous.revision !== snap.revision) {
      for (const draft of this.drafts.values()) {
        draft.preview = null;
        draft.interpretation = 'uninterpreted';
        if (draft.mode === 'D') draft.representation = null;
        draft.jobId = null;
        draft.jobStatus = null;
      }
      this.message =
        `작업 revision이 ${previous.revision}에서 ${snap.revision}으로 바뀌어 미리보기와 해석 결과를 무효화했습니다. ` +
        '조건 입력은 유지됩니다.';
    } else {
      this.message = '작업을 새로고침했습니다.';
    }
    this.notify();
  }

  chooseDisposition(id: string, disposition: Disposition | null): void {
    const cand = this.requireCandidate(id);
    if (!cand) return;
    const draft = this.ensureDraft(id);
    draft.disposition = disposition;
    if (disposition !== 'allow') draft.preview = null;
    draft.message = '';
    this.notify();
  }

  chooseMode(id: string, mode: Mode): void {
    const cand = this.requireCandidate(id);
    if (!cand) return;
    const draft = this.ensureDraft(id);
    draft.mode = mode;
    draft.preview = null;
    draft.interpretation = 'uninterpreted';
    draft.jobId = null;
    draft.jobStatus = null;
    draft.message = '';
    if (mode === 'A') {
      draft.representation = { kind: 'fact_summary', transform_id: '', parameters: {} };
    } else if (mode === 'B') {
      if (cand.kind !== 'series') {
        draft.representation = null;
        draft.message = 'B(추이 표)는 series 후보에만 쓸 수 있어 근거 없는 매핑을 만들지 않습니다.';
      } else {
        draft.representation = { kind: 'derived_table', transform_id: 'series_direction_only.v1', parameters: {} };
      }
    } else if (mode === 'C') {
      draft.representation = null;
      draft.message = 'C(선택 필드)는 선택 가능한 필드 목록과 서버 변환이 아직 제공되지 않아 미리보기·저장이 차단됩니다.';
    } else {
      draft.representation = null;
      draft.message = 'D는 아래 조건을 적고 조건 확인(해석)이 지원(supported)되어야 미리보기가 가능합니다.';
    }
    this.notify();
  }

  setCondition(id: string, text: string): void {
    const cand = this.requireCandidate(id);
    if (!cand) return;
    const draft = this.ensureDraft(id);
    if (draft.condition !== text) {
      draft.condition = text;
      draft.interpretation = 'uninterpreted';
      draft.preview = null;
      if (draft.mode === 'D') draft.representation = null;
      draft.jobId = null;
      draft.jobStatus = null;
    }
    this.notify();
  }

  setReusable(id: string, value: boolean): void {
    const cand = this.requireCandidate(id);
    if (!cand) return;
    const draft = this.ensureDraft(id);
    const kind = draft.representation?.kind;
    if (value && kind !== undefined && REUSABLE_FORBIDDEN[kind] === true) {
      draft.reusable = false;
      draft.message = '이 표현 종류는 재사용 저장이 강제 금지라 토글이 꺼져 있습니다.';
    } else {
      draft.reusable = value;
    }
    this.notify();
  }

  setScopeReduction(value: boolean): void {
    this.acceptScopeReduction = value;
    this.notify();
  }

  async preview(id: string): Promise<void> {
    const blocked = this.writeBlockReason;
    if (blocked !== '') {
      this.message = blocked;
      this.notify();
      return;
    }
    const snap = this.snapshot;
    const cand = snap?.candidates.find((item) => item.id === id);
    if (!snap || !cand) {
      this.message = '작업을 먼저 불러오세요.';
      this.notify();
      return;
    }
    const draft = this.drafts.get(id);
    const rep = draft?.representation ?? null;
    if (!draft || draft.mode === null) {
      const target = this.ensureDraft(id);
      target.message = '공개 방식(A·B·D)을 먼저 고르세요. C는 계약에 없어 쓸 수 없습니다.';
      this.notify();
      return;
    }
    if (draft.mode === 'D' && draft.interpretation !== 'supported') {
      draft.message = 'D는 조건 확인(해석)이 지원(supported)되어야 미리보기가 가능합니다.';
      this.notify();
      return;
    }
    if (draft.mode === 'B' && cand.kind !== 'series') {
      draft.message = 'B(추이 표)는 series 후보에만 쓸 수 있습니다.';
      this.notify();
      return;
    }
    if (!rep) {
      draft.message = '전송할 표현 방식이 정해지지 않았습니다. C의 필드 선택·서버 변환은 아직 제공되지 않습니다.';
      this.notify();
      return;
    }
    if (rep.kind === 'selected_fields') {
      draft.message = 'C(선택 필드)는 선택 가능한 필드 목록과 서버 변환이 아직 제공되지 않아 미리보기가 차단됩니다.';
      this.notify();
      return;
    }
    const token = this.csrfToken ?? '';
    const revision = snap.revision;
    const modeAtRequest = draft.mode;
    const conditionAtRequest = draft.condition;
    const signatureAtRequest = representationSignature(rep);
    const owner = this.beginRequest();
    this.notify();
    let response: Response;
    try {
      response = await this.fetchFn(`/api/v1/tasks/${encodeURIComponent(snap.id)}/disclosure-previews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': token,
          'Idempotency-Key': newIdempotencyKey(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          expected_revision: revision,
          candidate_id: id,
          representation: toWireRepresentation(rep),
        }),
      });
    } catch {
      if (!this.ownsRequest(owner)) return;
      this.endRequest(owner);
      draft.message = '미리보기 전송에 실패했습니다. 입력은 그대로 두었습니다.';
      this.notify();
      return;
    }
    let body: unknown = null;
    try {
      body = (await response.json()) as unknown;
    } catch {
      body = null;
    }
    if (!this.ownsRequest(owner)) return;
    if (
      this.snapshot !== snap ||
      this.drafts.get(id) !== draft ||
      draft.mode !== modeAtRequest ||
      draft.condition !== conditionAtRequest ||
      representationSignature(draft.representation) !== signatureAtRequest
    ) {
      this.endRequest(owner);
      this.notify();
      return;
    }
    this.endRequest(owner);
    if (!response.ok) {
      if (response.status === 409) {
        draft.message = '작업 revision이 바뀌었습니다(409). 최신 상태를 다시 불러옵니다.';
        this.notify();
        await this.loadTask(snap.id);
        return;
      }
      draft.message = `미리보기에 실패했습니다(${response.status}${serverErrorCode(body)}). 입력은 그대로 두었습니다.`;
      this.notify();
      return;
    }
    let parsed: Preview;
    try {
      parsed = parsePreview(body);
    } catch {
      draft.message = '미리보기 응답을 해석할 수 없어 성공으로 처리하지 않았습니다.';
      this.notify();
      return;
    }
    if (
      parsed.candidate_id !== id ||
      parsed.input_revision !== revision ||
      representationSignature(parsed.representation) !== signatureAtRequest
    ) {
      draft.message = '미리보기 응답이 요청한 후보·revision·표현과 달라 폐기했습니다.';
      this.notify();
      return;
    }
    draft.preview = parsed;
    draft.message = '미리보기를 확인했습니다. 해시를 대조한 뒤 전체 적용에 쓰세요.';
    this.notify();
  }

  async interpret(id: string): Promise<void> {
    const blocked = this.writeBlockReason;
    if (blocked !== '') {
      this.message = blocked;
      this.notify();
      return;
    }
    const snap = this.snapshot;
    if (!snap || !snap.candidates.some((item) => item.id === id)) {
      this.message = '작업을 먼저 불러오세요.';
      this.notify();
      return;
    }
    const draft = this.drafts.get(id);
    if (!draft || draft.mode !== 'D') {
      const target = this.ensureDraft(id);
      target.message = 'D 방식을 먼저 고르고 조건을 적으세요.';
      this.notify();
      return;
    }
    const text = draft.condition.trim();
    if (text === '') {
      draft.message = '해석할 조건을 먼저 적으세요.';
      this.notify();
      return;
    }
    const token = this.csrfToken ?? '';
    const revision = snap.revision;
    const conditionAtRequest = draft.condition;
    const owner = this.beginRequest();
    this.notify();
    let response: Response;
    try {
      response = await this.fetchFn(`/api/v1/tasks/${encodeURIComponent(snap.id)}/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': token,
          'Idempotency-Key': newIdempotencyKey(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          expected_revision: revision,
          kind: 'interpret_disclosure',
          arguments: { candidate_id: id, text },
        }),
      });
    } catch {
      if (!this.ownsRequest(owner)) return;
      this.endRequest(owner);
      draft.message = '조건 확인 전송에 실패했습니다. 입력은 그대로 두었습니다.';
      this.notify();
      return;
    }
    let body: unknown = null;
    try {
      body = (await response.json()) as unknown;
    } catch {
      body = null;
    }
    if (!this.ownsRequest(owner)) return;
    if (
      this.snapshot !== snap ||
      this.drafts.get(id) !== draft ||
      draft.mode !== 'D' ||
      draft.condition !== conditionAtRequest
    ) {
      this.endRequest(owner);
      this.notify();
      return;
    }
    this.endRequest(owner);
    if (!response.ok) {
      if (response.status === 409) {
        draft.message = '작업 revision이 바뀌었습니다(409). 최신 상태를 다시 불러옵니다.';
        this.notify();
        await this.loadTask(snap.id);
        return;
      }
      draft.message = `조건 확인에 실패했습니다(${response.status}${serverErrorCode(body)}). 입력은 그대로 두었습니다.`;
      this.notify();
      return;
    }
    let job: Job;
    try {
      job = parseJob(body);
    } catch {
      draft.message = '해석 작업 응답을 해석할 수 없어 성공으로 처리하지 않았습니다.';
      this.notify();
      return;
    }
    if (job.kind !== 'interpret_disclosure' || job.input_revision !== revision) {
      draft.message = '해석 작업 응답이 요청과 달라 폐기했습니다.';
      this.notify();
      return;
    }
    draft.jobId = job.id;
    draft.jobStatus = job.status;
    if (job.status === 'succeeded' && job.result) {
      this.applyProposal(draft, id, job.result);
    } else if (job.status === 'succeeded') {
      draft.interpretation = 'uninterpreted';
      draft.message = '해석 작업은 끝났지만 결과가 비어 있어 판단하지 않았습니다.';
    } else {
      draft.message = '해석 작업을 시작했습니다. 끝나면 해석 조회를 누르세요.';
    }
    this.notify();
  }

  async refreshInterpretation(id: string): Promise<void> {
    // 해석 상태 조회는 읽기(GET)라 CSRF 토큰 없이도 보낸다.
    if (this.busy) {
      this.message = '다른 요청을 처리하는 중입니다.';
      this.notify();
      return;
    }
    if (this.stale) {
      this.message = '표시 중인 작업 정보가 오래되었습니다. 다시 불러온 뒤 조회하세요.';
      this.notify();
      return;
    }
    const snap = this.snapshot;
    if (!snap) {
      this.message = '작업을 먼저 불러오세요.';
      this.notify();
      return;
    }
    const draft = this.drafts.get(id);
    if (!draft || !draft.jobId) {
      this.message = '조회할 해석 작업이 없습니다. 먼저 조건 확인을 누르세요.';
      this.notify();
      return;
    }
    if (draft.jobStatus !== 'queued' && draft.jobStatus !== 'running') {
      draft.message = '이미 끝난 해석은 다시 조회하지 않습니다. 대기·진행 중일 때만 조회합니다.';
      this.notify();
      return;
    }
    const jobId = draft.jobId;
    const revision = snap.revision;
    const conditionAtRequest = draft.condition;
    const owner = this.beginRequest();
    this.notify();
    let response: Response;
    try {
      response = await this.fetchFn(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
    } catch {
      if (!this.ownsRequest(owner)) return;
      this.endRequest(owner);
      draft.message = '해석 조회에 실패했습니다. 입력은 그대로 두었습니다.';
      this.notify();
      return;
    }
    let body: unknown = null;
    try {
      body = (await response.json()) as unknown;
    } catch {
      body = null;
    }
    if (!this.ownsRequest(owner)) return;
    if (
      this.snapshot !== snap ||
      this.drafts.get(id) !== draft ||
      draft.mode !== 'D' ||
      draft.condition !== conditionAtRequest ||
      draft.jobId !== jobId
    ) {
      this.endRequest(owner);
      this.notify();
      return;
    }
    this.endRequest(owner);
    if (!response.ok) {
      draft.message = `해석 조회에 실패했습니다(${response.status}${serverErrorCode(body)}). 입력은 그대로 두었습니다.`;
      this.notify();
      return;
    }
    let job: Job;
    try {
      job = parseJob(body);
    } catch {
      draft.message = '해석 조회 응답을 해석할 수 없어 성공으로 처리하지 않았습니다.';
      this.notify();
      return;
    }
    if (job.id !== jobId || job.kind !== 'interpret_disclosure' || job.input_revision !== revision) {
      draft.message = '해석 조회 응답이 요청과 달라 폐기했습니다.';
      this.notify();
      return;
    }
    draft.jobStatus = job.status;
    if (job.status === 'succeeded' && job.result) {
      this.applyProposal(draft, id, job.result);
    } else if (job.status === 'queued' || job.status === 'running') {
      draft.message = '해석이 아직 진행 중입니다. 잠시 뒤 다시 조회하세요.';
    } else if (job.status === 'succeeded') {
      draft.interpretation = 'uninterpreted';
      draft.message = '해석 작업은 끝났지만 결과가 비어 있어 판단하지 않았습니다.';
    } else {
      draft.interpretation = 'uninterpreted';
      draft.message = `해석 작업이 ${job.status}로 끝났습니다. 조건을 고쳐 다시 확인하세요.`;
    }
    this.notify();
  }

  async apply(): Promise<void> {
    const reason = this.batchBlockReason;
    if (reason !== '') {
      this.message = reason;
      this.notify();
      return;
    }
    const snap = this.snapshot;
    if (!snap) {
      this.message = '작업을 먼저 불러오세요.';
      this.notify();
      return;
    }
    const token = this.csrfToken ?? '';
    const operations = this.collectOperations(snap).map((op) => {
      const rep = op.draft.representation;
      const preview = op.draft.preview;
      if (op.disposition !== 'allow' || !rep || !preview) {
        return { candidate_id: op.candidate.id, disposition: op.disposition };
      }
      const effectiveReusable = op.draft.reusable && REUSABLE_FORBIDDEN[rep.kind] !== true;
      return {
        candidate_id: op.candidate.id,
        disposition: op.disposition,
        representation: toWireRepresentation(rep),
        preview_id: preview.preview_id,
        projection_sha256: preview.projection_sha256,
        save_reusable_rule: effectiveReusable,
      };
    });
    const body = JSON.stringify({
      expected_revision: snap.revision,
      accept_scope_reduction: this.acceptScopeReduction,
      operations,
    });
    let key: string;
    if (this.lastBatch && this.lastBatch.taskId === snap.id && this.lastBatch.body === body) {
      key = this.lastBatch.key;
    } else {
      key = newIdempotencyKey();
      this.lastBatch = { taskId: snap.id, body, key };
    }
    const owner = this.beginRequest();
    this.notify();
    let response: Response;
    try {
      response = await this.fetchFn(`/api/v1/tasks/${encodeURIComponent(snap.id)}/decision-batches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': token,
          'Idempotency-Key': key,
        },
        credentials: 'same-origin',
        body,
      });
    } catch {
      if (!this.ownsRequest(owner)) return;
      this.endRequest(owner);
      this.message = '전체 적용 전송에 실패했습니다. 같은 내용으로 다시 누르면 같은 키로 재시도됩니다.';
      this.notify();
      return;
    }
    let responseBody: unknown = null;
    try {
      responseBody = (await response.json()) as unknown;
    } catch {
      responseBody = null;
    }
    // 요청 중에 새 작업 조회가 시작·완료됐으면 늦은 결과로 현재 화면을 덮지 않는다.
    if (!this.ownsRequest(owner)) return;
    this.endRequest(owner);
    if (!response.ok) {
      this.lastBatch = null;
      if (response.status === 409) {
        this.invalidatePreviews();
        this.message = '다른 변경과 충돌했습니다(409). 미리보기를 무효화하고 최신 상태를 다시 불러옵니다.';
        this.notify();
        await this.loadTask(snap.id);
        return;
      }
      this.message = `전체 적용에 실패했습니다(${response.status}${serverErrorCode(responseBody)}). 기존 결정은 그대로 유지됩니다.`;
      this.notify();
      return;
    }
    this.lastBatch = null;
    // 배치 결과 이후에도 현재 작업 조회를 권위로 삼아 화면을 갱신한다.
    this.message = '결정을 저장했습니다. 최신 상태를 다시 불러옵니다.';
    this.notify();
    await this.loadTask(snap.id);
  }

  async revoke(decisionId: string): Promise<void> {
    const blocked = this.writeBlockReason;
    if (blocked !== '') {
      this.message = blocked;
      this.notify();
      return;
    }
    const snap = this.snapshot;
    if (!snap) {
      this.message = '작업을 먼저 불러오세요.';
      this.notify();
      return;
    }
    const target = decisionId.trim();
    if (target === '') {
      this.message = '철회할 결정을 고르세요.';
      this.notify();
      return;
    }
    const token = this.csrfToken ?? '';
    const owner = this.beginRequest();
    this.notify();
    let response: Response;
    try {
      response = await this.fetchFn(
        `/api/v1/tasks/${encodeURIComponent(snap.id)}/decisions/${encodeURIComponent(target)}/revoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-Token': token,
            'Idempotency-Key': newIdempotencyKey(),
          },
          credentials: 'same-origin',
          body: JSON.stringify({ expected_revision: snap.revision }),
        },
      );
    } catch {
      if (!this.ownsRequest(owner)) return;
      this.endRequest(owner);
      this.message = '철회 전송에 실패했습니다. 기존 결정은 그대로 유지됩니다.';
      this.notify();
      return;
    }
    let responseBody: unknown = null;
    try {
      responseBody = (await response.json()) as unknown;
    } catch {
      responseBody = null;
    }
    if (!this.ownsRequest(owner)) return;
    this.endRequest(owner);
    if (!response.ok) {
      if (response.status === 409) {
        this.message = '다른 변경과 충돌했습니다(409). 최신 상태를 다시 불러옵니다.';
        this.notify();
        await this.loadTask(snap.id);
        return;
      }
      this.message = `철회에 실패했습니다(${response.status}${serverErrorCode(responseBody)}). 기존 결정은 그대로 유지됩니다.`;
      this.notify();
      return;
    }
    // 철회 뒤에는 과거 허용을 자동으로 되살리지 않고 작업 조회를 권위로 삼는다.
    this.message = '결정을 철회했습니다. 최신 상태를 다시 불러옵니다.';
    this.notify();
    await this.loadTask(snap.id);
  }

  // 세션을 연 뒤 CSRF 토큰을 주입한다. 빈 값은 무시해 차단 상태를 유지한다.
  setCsrfToken(token: string): void {
    if (token === '') return;
    this.csrfToken = token;
    this.notify();
  }

  private notify(): void {
    try {
      this.onChange();
    } catch {
      // 화면 콜백 오류는 상태 전이를 막지 않는다.
    }
  }

  // 비동기 요청 소유권. 가장 최근에 시작한 요청만 busy/message를 바꾼다.
  private beginRequest(): number {
    const owner = ++this.requestSeq;
    this.busy = true;
    return owner;
  }

  private ownsRequest(owner: number): boolean {
    return this.requestSeq === owner;
  }

  private endRequest(owner: number): void {
    if (this.requestSeq === owner) this.busy = false;
  }

  private blankDraft(): Draft {
    return {
      disposition: null,
      mode: null,
      condition: '',
      reusable: false,
      preview: null,
      interpretation: 'uninterpreted',
      jobId: null,
      jobStatus: null,
      representation: null,
      message: '',
    };
  }

  private ensureDraft(id: string): Draft {
    let draft = this.drafts.get(id);
    if (!draft) {
      draft = this.blankDraft();
      this.drafts.set(id, draft);
    }
    return draft;
  }

  private requireCandidate(id: string): Candidate | null {
    const snap = this.snapshot;
    if (!snap) {
      this.message = '작업을 먼저 불러오세요.';
      this.notify();
      return null;
    }
    const cand = snap.candidates.find((item) => item.id === id);
    if (!cand) {
      this.message = '목록에 없는 후보라 선택을 두지 않았습니다.';
      this.notify();
      return null;
    }
    return cand;
  }

  private describe(cand: Candidate): string {
    const short = cand.statement.length > 40 ? `${cand.statement.slice(0, 40)}…` : cand.statement;
    return `"${short}"(${cand.id})`;
  }

  private collectOperations(
    snap: Snapshot,
  ): { candidate: Candidate; draft: Draft; disposition: Disposition }[] {
    const ops: { candidate: Candidate; draft: Draft; disposition: Disposition }[] = [];
    for (const cand of snap.candidates) {
      const draft = this.drafts.get(cand.id);
      if (!draft || draft.disposition === null) continue;
      ops.push({ candidate: cand, draft, disposition: draft.disposition });
    }
    return ops;
  }

  // revision 충돌 뒤에는 어떤 미리보기도 현재 revision을 보증하지 못하므로 전부 버린다.
  private invalidatePreviews(): void {
    for (const draft of this.drafts.values()) draft.preview = null;
  }

  private allowReadyReason(snap: Snapshot, cand: Candidate, draft: Draft): string {
    const rep = draft.representation;
    if (!rep) {
      if (draft.mode === 'C') return `${this.describe(cand)}의 C(선택 필드)는 화면의 필드 선택 연결이 없어 저장할 수 없습니다.`;
      return `${this.describe(cand)}의 공개 방식(A·B·D)을 먼저 고르세요.`;
    }
    if (rep.kind === 'selected_fields') {
      return `${this.describe(cand)}의 C(선택 필드)는 화면의 필드 선택 연결이 없어 저장할 수 없습니다.`;
    }
    if (draft.mode === 'B' && cand.kind !== 'series') {
      return `${this.describe(cand)}의 B(추이 표)는 series 후보에만 쓸 수 있습니다.`;
    }
    if (draft.mode === 'D' && draft.interpretation !== 'supported') {
      return `${this.describe(cand)}의 D 조건은 해석 지원(supported) 뒤에야 저장할 수 있습니다.`;
    }
    const preview = draft.preview;
    if (!preview) return `${this.describe(cand)}의 미리보기를 먼저 확인하세요.`;
    if (preview.candidate_id !== cand.id || preview.input_revision !== snap.revision) {
      return `${this.describe(cand)}의 미리보기가 현재 revision과 맞지 않아 다시 확인해야 합니다.`;
    }
    if (representationSignature(preview.representation) !== representationSignature(rep)) {
      return `${this.describe(cand)}의 미리보기와 고른 공개 방식이 달라 다시 확인해야 합니다.`;
    }
    if (preview.preview_id === '' || preview.projection_sha256 === '') {
      return `${this.describe(cand)}의 미리보기 식별자·해시가 비어 있어 저장할 수 없습니다.`;
    }
    return '';
  }

  private applyProposal(draft: Draft, candidateId: string, result: Proposal): void {
    if (result.candidate_id !== candidateId) {
      draft.message = '해석 결과가 다른 후보를 가리켜 폐기했습니다.';
      return;
    }
    if (result.status === 'supported' && !result.requires_clarification) {
      if (!result.representation) {
        draft.interpretation = 'ambiguous';
        draft.representation = null;
        draft.preview = null;
        draft.message = '지원 판정이지만 표현이 비어 있어 확정하지 않았습니다. 조건을 고쳐 다시 확인하세요.';
        return;
      }
      draft.interpretation = 'supported';
      draft.representation = result.representation;
      draft.preview = null;
      draft.message = '조건이 지원(supported)됩니다. 미리보기를 확인한 뒤 전체 적용하세요.';
      return;
    }
    draft.representation = null;
    draft.preview = null;
    if (result.status === 'supported') {
      draft.interpretation = 'ambiguous';
      draft.message = '조건에 추가 확인이 필요해 미리보기가 차단됩니다. 조건을 고쳐 다시 확인하세요.';
    } else if (result.status === 'ambiguous') {
      draft.interpretation = 'ambiguous';
      draft.message = '조건이 모호(ambiguous)해 미리보기가 차단됩니다. 조건을 고쳐 다시 확인하세요.';
    } else {
      draft.interpretation = 'unsupported';
      draft.message = '조건이 지원되지 않아(unsupported) 미리보기가 차단됩니다. 조건을 고쳐 다시 확인하세요.';
    }
  }
}
