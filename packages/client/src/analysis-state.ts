// 파일 → 내부 분석 POST /api/analysis 상태 경계.
//
// 계약 근거: packages/core-interface/src/workflow.ts의 AnalyzeRequest/AnalyzeResult,
// packages/core/src/evidence-parser.ts의 100/256KiB/1MiB 입력 제한, core/src/index.ts의
// analyze() 검증, server/src/app.ts의 POST /api/analysis 라우트.
//
// 정직 규칙:
// - 파일을 고르는 것만으로는 전송하지 않는다. 목적·수신처와 승인된 분석 환경 동의가
//   갖춰지고 run()이 명시적으로 호출될 때만 보낸다.
// - 파일 하나라도 형식·크기·UTF-8 검증에 실패하면 나머지만 골라 보내지 않는다.
// - 입력이 바뀌거나 취소되면 진행 중 요청을 중단하고, 늦게 도착한 응답은 채택하지
//   않는다. 실패해도 입력과 이전 성공 결과는 그대로 둔다.
// - 서버가 계약 전체를 엄격히 검증하므로 파서를 복제하지 않는다. 다만 화면이 소비하는
//   근거 필드·바이트 범위·후보/충돌 참조가 유효한지 확인하고, 어긋난 응답은 통째로
//   거부한다.
// - 결과의 후보는 모델 제안이며 확정 필수나 공개 허가가 아니다.

export type AnalysisFileFormat = 'txt' | 'log' | 'md' | 'csv' | 'json';

export interface AnalysisSource {
  id: string;
  display_name: string;
  format: AnalysisFileFormat;
  sha256: string;
  bytes: Uint8Array;
}

export type AnalysisEvidenceKind = 'byte_range' | 'csv_cell' | 'json_pointer';

export interface AnalysisEvidenceLocator {
  kind: AnalysisEvidenceKind;
  column?: string;
  pointer?: string;
  row?: number;
  value_sha256?: string;
}

export interface AnalysisEvidence {
  id: string;
  source_version_id: string;
  locator: AnalysisEvidenceLocator;
  start: number;
  end: number;
  evidence_sha256: string;
}

export type AnalysisCandidateKind = 'observation' | 'constraint' | 'hypothesis' | 'unknown' | 'identifier';
export type AnalysisUncertainty = 'observed' | 'reported' | 'inferred' | 'unknown';
export type AnalysisRelevance = 'required' | 'optional';

export interface AnalysisCandidate {
  local_key: string;
  kind: AnalysisCandidateKind;
  uncertainty: AnalysisUncertainty;
  statement: string;
  evidence_ids: string[];
  relevance: AnalysisRelevance;
  purpose_relevance: string;
}

export interface AnalysisConflict {
  local_keys: string[];
  reason: string;
}

export interface AnalysisProposals {
  schema_version: 'candidate_proposals.v1';
  candidates: AnalysisCandidate[];
  conflicts: AnalysisConflict[];
}

export interface AnalysisResult {
  task: { purpose: string; recipient: string };
  sources: AnalysisSource[];
  evidence: AnalysisEvidence[];
  proposals: AnalysisProposals;
}

export interface AnalysisProblem {
  field: 'files' | 'purpose' | 'recipient' | 'consent' | 'request';
  message: string;
}

const MAX_FILES = 100;
const MAX_FILE_BYTES = 262144;
const MAX_TOTAL_BYTES = 1048576;
const MAX_BODY_BYTES = 1572864;
const MAX_TASK_TEXT = 8192;
const MAX_EVIDENCE = 100;
const MAX_CANDIDATES = 30;
const MAX_CONFLICTS = 100;

const FORMATS: Record<string, AnalysisFileFormat> = { txt: 'txt', log: 'log', md: 'md', csv: 'csv', json: 'json' };
const EVIDENCE_KINDS: Record<string, true> = { byte_range: true, csv_cell: true, json_pointer: true };
const CANDIDATE_KINDS: Record<string, true> = {
  observation: true, constraint: true, hypothesis: true, unknown: true, identifier: true,
};
const UNCERTAINTIES: Record<string, true> = { observed: true, reported: true, inferred: true, unknown: true };
const RELEVANCES: Record<string, true> = { required: true, optional: true };

const NO_SUBTLE_MESSAGE =
  '이 주소에서는 암호화 API(crypto.subtle)를 쓸 수 없어 파일 SHA256을 계산할 수 없습니다. ' +
  'HTTPS 또는 localhost 주소에서 다시 시도하세요. LAN의 HTTP 주소에서는 분석을 실행할 수 없습니다.';
const NETWORK_MESSAGE = '분석 요청을 보내지 못했습니다. 서버 연결을 확인하세요. 자동으로 다시 시도하지 않았습니다.';
const INVALID_RESPONSE_MESSAGE =
  '분석 응답을 해석할 수 없어 성공으로 처리하지 않았습니다. 서버 응답 형식이 계약과 다릅니다.';
const CONSENT_MESSAGE =
  '설정된 분석 모델이 승인된 사내·로컬 분석 환경인지 운영 설정에서 확인한 뒤 동의에 체크해야 분석할 수 있습니다. ' +
  '동의 전에는 파일을 전송하지 않습니다.';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) throw new Error('object required');
  const keys = Object.keys(record);
  if (required.some((key) => !Object.hasOwn(record, key))) throw new Error('missing key');
  if (keys.some((key) => !required.includes(key) && !optional.includes(key))) throw new Error('unknown key');
  return record;
}

function arrayWithin(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('array required');
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error('strings required');
  return value as string[];
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function formatOf(fileName: string): AnalysisFileFormat | null {
  const match = /\.([^./\\]+)$/.exec(fileName);
  if (!match) return null;
  const extension = match[1]!.toLowerCase();
  // 상속된 Object 속성(constructor, __proto__ 등)을 지원 형식으로 오인하지 않는다.
  return Object.hasOwn(FORMATS, extension) ? FORMATS[extension]! : null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>, subtle: SubtleCrypto): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

async function readSources(files: readonly File[], subtle: SubtleCrypto): Promise<AnalysisSource[]> {
  const sources: AnalysisSource[] = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!;
    const format = formatOf(file.name);
    if (!format) throw new Error(`지원하지 않는 파일 형식입니다: ${file.name}. txt·log·md·csv·json만 보낼 수 있습니다.`);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const buffer = await file.arrayBuffer();
      bytes = new Uint8Array(buffer);
    } catch {
      throw new Error(`파일을 읽지 못했습니다: ${file.name}. 다른 파일을 골라 다시 시도하세요.`);
    }
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`UTF-8 텍스트가 아닙니다: ${file.name}. txt·log·md·csv·json은 UTF-8이어야 합니다.`);
    }
    const sha256 = await sha256Hex(bytes, subtle);
    sources.push({ id: `local_${index + 1}_${sha256.slice(0, 12)}`, display_name: file.name, format, sha256, bytes });
  }
  return sources;
}

interface WireSource {
  id: string;
  source_id: string;
  version: number;
  display_name: string;
  format: AnalysisFileFormat;
  source_slot: string;
  raw_bytes: string;
  sha256: string;
  included: true;
}

function toWireSource(source: AnalysisSource, index: number): WireSource {
  return {
    id: source.id,
    source_id: `local_source_${index + 1}`,
    version: 1,
    display_name: source.display_name,
    format: source.format,
    source_slot: `input_${index + 1}`,
    raw_bytes: toBase64(source.bytes),
    sha256: source.sha256,
    included: true,
  };
}

function serverErrorCode(body: unknown): string {
  const code = asRecord(body)?.error;
  return typeof code === 'string' && code !== '' ? ` ${code}` : '';
}

function parseLocator(value: unknown): AnalysisEvidenceLocator {
  const record = exactRecord(value, ['kind'], ['column', 'pointer', 'row', 'value_sha256']);
  const kind = asString(record.kind);
  if (!kind || EVIDENCE_KINDS[kind] !== true) throw new Error('locator kind');
  if (record.column !== undefined && typeof record.column !== 'string') throw new Error('locator column');
  if (record.pointer !== undefined && typeof record.pointer !== 'string') throw new Error('locator pointer');
  if (record.row !== undefined && asInt(record.row) === null) throw new Error('locator row');
  if (record.value_sha256 !== undefined && !isSha256(record.value_sha256)) throw new Error('locator value_sha256');
  if (kind === 'csv_cell') {
    // CSV 데이터 행은 헤더를 1행으로 세므로 첫 데이터 행이 2다.
    if (typeof record.column !== 'string' || record.column === '' || asInt(record.row) === null || (record.row as number) < 1) {
      throw new Error('csv locator');
    }
  }
  if (kind === 'json_pointer' && typeof record.pointer !== 'string') throw new Error('json locator');
  return record as unknown as AnalysisEvidenceLocator;
}

function parseEvidence(value: unknown, sources: Map<string, AnalysisSource>): AnalysisEvidence[] {
  const evidence: AnalysisEvidence[] = [];
  const seen = new Set<string>();
  for (const item of arrayWithin(value, MAX_EVIDENCE)) {
    const record = exactRecord(item, ['id', 'source_version_id', 'locator', 'start', 'end', 'evidence_sha256']);
    const id = asNonEmptyString(record.id);
    const sourceVersionId = asString(record.source_version_id);
    const source = sourceVersionId === null ? undefined : sources.get(sourceVersionId);
    const start = asInt(record.start);
    const end = asInt(record.end);
    const evidenceSha = isSha256(record.evidence_sha256) ? record.evidence_sha256 : null;
    if (!id || seen.has(id) || !source || start === null || end === null || start < 0 || end < start ||
      end > source.bytes.length || evidenceSha === null) {
      throw new Error('evidence');
    }
    seen.add(id);
    try {
      // 근거 발췌를 화면이 UTF-8로 디코드하므로 잘린 바이트 경계는 소비 불가로 본다.
      new TextDecoder('utf-8', { fatal: true }).decode(source.bytes.subarray(start, end));
    } catch {
      throw new Error('evidence bytes');
    }
    evidence.push({
      id,
      source_version_id: sourceVersionId!,
      locator: parseLocator(record.locator),
      start,
      end,
      evidence_sha256: evidenceSha,
    });
  }
  return evidence;
}

function parseCandidates(value: unknown, evidenceIds: Set<string>): AnalysisCandidate[] {
  const candidates: AnalysisCandidate[] = [];
  const keys = new Set<string>();
  for (const item of arrayWithin(value, MAX_CANDIDATES)) {
    const record = exactRecord(item,
      ['local_key', 'kind', 'uncertainty', 'statement', 'evidence_ids', 'relevance', 'purpose_relevance']);
    const localKey = asNonEmptyString(record.local_key);
    const kind = asString(record.kind);
    const uncertainty = asString(record.uncertainty);
    const relevance = asString(record.relevance);
    const statement = asNonEmptyString(record.statement);
    const purposeRelevance = asString(record.purpose_relevance);
    const evidenceIdsForCandidate = stringArray(record.evidence_ids);
    if (!localKey || keys.has(localKey) || kind === null || CANDIDATE_KINDS[kind] !== true ||
      uncertainty === null || UNCERTAINTIES[uncertainty] !== true ||
      relevance === null || RELEVANCES[relevance] !== true ||
      statement === null || purposeRelevance === null ||
      new Set(evidenceIdsForCandidate).size !== evidenceIdsForCandidate.length ||
      evidenceIdsForCandidate.some((id) => !evidenceIds.has(id))) {
      throw new Error('candidate');
    }
    keys.add(localKey);
    candidates.push({
      local_key: localKey,
      kind: kind as AnalysisCandidateKind,
      uncertainty: uncertainty as AnalysisUncertainty,
      statement,
      evidence_ids: evidenceIdsForCandidate,
      relevance: relevance as AnalysisRelevance,
      purpose_relevance: purposeRelevance,
    });
  }
  return candidates;
}

function parseConflicts(value: unknown, candidateKeys: Set<string>): AnalysisConflict[] {
  const conflicts: AnalysisConflict[] = [];
  for (const item of arrayWithin(value, MAX_CONFLICTS)) {
    const record = exactRecord(item, ['local_keys', 'reason']);
    const localKeys = stringArray(record.local_keys);
    const reason = asNonEmptyString(record.reason);
    if (reason === null || localKeys.length < 2 || new Set(localKeys).size !== localKeys.length ||
      localKeys.some((key) => !candidateKeys.has(key))) {
      throw new Error('conflict');
    }
    conflicts.push({ local_keys: localKeys, reason });
  }
  return conflicts;
}

function parseResult(
  body: unknown,
  task: { purpose: string; recipient: string },
  sources: readonly AnalysisSource[],
): AnalysisResult {
  const root = exactRecord(body, ['evidence', 'proposals']);
  const proposals = exactRecord(root.proposals, ['schema_version', 'candidates', 'conflicts']);
  if (proposals.schema_version !== 'candidate_proposals.v1') throw new Error('schema version');
  const sourceMap = new Map<string, AnalysisSource>();
  for (const source of sources) sourceMap.set(source.id, source);
  const evidence = parseEvidence(root.evidence, sourceMap);
  const candidates = parseCandidates(proposals.candidates, new Set(evidence.map((item) => item.id)));
  const conflicts = parseConflicts(proposals.conflicts, new Set(candidates.map((item) => item.local_key)));
  return {
    task: { purpose: task.purpose, recipient: task.recipient },
    sources: sources.map((source) => ({ ...source })),
    evidence,
    proposals: { schema_version: 'candidate_proposals.v1', candidates, conflicts },
  };
}

export class AnalysisWorkspace {
  purpose = '';
  recipient = '';
  consent = false;
  busy = false;
  message = '';
  problem: AnalysisProblem | null = null;
  result: AnalysisResult | null = null;

  private selectedFiles: File[] = [];
  private onChange: () => void;
  private fetchFn: typeof globalThis.fetch;
  private requestSeq = 0;
  private controller: AbortController | null = null;
  private inputSeq = 0;
  private resultInputSeq = -1;

  constructor(onChange: () => void, options?: { fetch?: typeof globalThis.fetch }) {
    this.onChange = onChange;
    // 브라우저의 window.fetch는 receiver를 요구하므로 클래스 필드로 옮겨 호출하면 Illegal invocation이 난다.
    const source = options?.fetch ?? globalThis.fetch;
    this.fetchFn = source.bind(globalThis);
  }

  get files(): readonly File[] {
    return this.selectedFiles;
  }

  get resultIsCurrent(): boolean {
    return this.result !== null && this.resultInputSeq === this.inputSeq;
  }

  setFiles(files: readonly File[]): void {
    const next = [...files];
    if (next.length === this.selectedFiles.length && next.every((file, index) => file === this.selectedFiles[index])) return;
    this.selectedFiles = next;
    this.inputSeq += 1;
    this.consent = false;
    this.problem = null;
    this.cancelledMessage('입력 파일이 바뀌어 진행 중인 분석을 취소했습니다.');
    this.notify();
  }

  setContext(purpose: string, recipient: string): void {
    if (purpose === this.purpose && recipient === this.recipient) return;
    this.purpose = purpose;
    this.recipient = recipient;
    this.inputSeq += 1;
    this.consent = false;
    this.problem = null;
    this.cancelledMessage('목적·수신처가 바뀌어 진행 중인 분석을 취소했습니다.');
    this.notify();
  }

  setConsent(consent: boolean): void {
    if (consent === this.consent) return;
    this.consent = consent;
    if (!consent) {
      this.problem = null;
      this.cancelledMessage('동의를 해제해 진행 중인 분석을 취소했습니다.');
    }
    this.notify();
  }

  cancel(): void {
    // 진행 중인 요청이 없으면 이미 표시 중인 결과·메시지를 지우지 않는다.
    if (!this.busy) return;
    this.requestSeq += 1;
    this.controller?.abort();
    this.controller = null;
    this.busy = false;
    this.problem = null;
    this.message = this.withPreviousResult('분석을 취소했습니다.');
    this.notify();
  }

  async run(): Promise<void> {
    if (this.busy) {
      this.message = '이미 분석을 진행 중입니다. 끝나거나 취소된 뒤 다시 시도하세요.';
      this.notify();
      return;
    }
    const invalid = this.validateInput();
    if (invalid) {
      this.problem = invalid;
      this.message = invalid.message;
      this.notify();
      return;
    }
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      this.problem = { field: 'request', message: NO_SUBTLE_MESSAGE };
      this.message = NO_SUBTLE_MESSAGE;
      this.notify();
      return;
    }
    const files = [...this.selectedFiles];
    const purpose = this.purpose;
    const recipient = this.recipient;
    const inputSeq = this.inputSeq;
    const owner = this.beginRequest();
    this.problem = null;
    this.message = '파일을 읽고 분석을 요청하는 중입니다.';
    this.notify();

    let sources: AnalysisSource[];
    try {
      sources = await readSources(files, subtle);
    } catch (error) {
      if (!this.ownsRequest(owner)) return;
      this.endRequest(owner);
      const candidate = error instanceof Error ? error.message : '파일을 읽지 못했습니다.';
      const hasFileDetail = candidate.startsWith('지원하지 않는') || candidate.startsWith('파일을 읽지') ||
        candidate.startsWith('UTF-8');
      const message = hasFileDetail ? candidate : `파일을 읽지 못했습니다: ${candidate}`;
      this.problem = { field: 'files', message };
      this.message = message;
      this.notify();
      return;
    }
    if (!this.ownsRequest(owner)) return;

    const wire = sources.map(toWireSource);
    const serialized = JSON.stringify({ task: { purpose, recipient }, sources: wire });
    if (new TextEncoder().encode(serialized).length > MAX_BODY_BYTES) {
      this.endRequest(owner);
      this.problem = { field: 'files', message: '선택한 파일의 전송 본문이 1.5MiB를 넘습니다. 파일 수나 크기를 줄이세요.' };
      this.message = this.problem.message;
      this.notify();
      return;
    }

    const controller = new AbortController();
    this.controller = controller;
    let response: Response;
    try {
      response = await this.fetchFn('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: serialized,
        signal: controller.signal,
      });
    } catch {
      if (!this.ownsRequest(owner)) return;
      this.endRequest(owner);
      this.releaseController(controller);
      this.failRequest(NETWORK_MESSAGE);
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
    this.releaseController(controller);
    if (!response.ok) {
      this.failRequest(this.httpFailure(response.status, serverErrorCode(body)));
      return;
    }
    let result: AnalysisResult;
    try {
      result = parseResult(body, { purpose, recipient }, sources);
    } catch {
      this.failRequest(INVALID_RESPONSE_MESSAGE);
      return;
    }
    this.result = result;
    this.resultInputSeq = inputSeq;
    this.problem = null;
    this.message =
      `분석을 마쳤습니다: 근거 ${result.evidence.length}개, 후보 ${result.proposals.candidates.length}개, ` +
      `충돌 ${result.proposals.conflicts.length}개. 후보의 required는 모델 추천이며 확정 필수나 공개 허가가 아닙니다.`;
    this.notify();
  }

  private validateInput(): AnalysisProblem | null {
    const files = this.selectedFiles;
    if (files.length === 0) {
      return { field: 'files', message: '분석할 파일을 선택하세요. 파일을 고르는 것만으로는 전송되지 않습니다.' };
    }
    if (files.length > MAX_FILES) {
      return { field: 'files', message: '한 번에 100개까지만 분석할 수 있습니다. 파일 수를 줄이세요.' };
    }
    let total = 0;
    for (const file of files) {
      if (formatOf(file.name) === null) {
        return { field: 'files', message: `지원하지 않는 파일 형식입니다: ${file.name}. txt·log·md·csv·json만 보낼 수 있습니다.` };
      }
      if (file.size > MAX_FILE_BYTES) {
        return { field: 'files', message: `파일 하나가 256KiB를 넘습니다: ${file.name}.` };
      }
      total += file.size;
    }
    if (total > MAX_TOTAL_BYTES) {
      return { field: 'files', message: '선택한 파일의 합계가 1MiB를 넘습니다. 파일 수나 크기를 줄이세요.' };
    }
    if (this.purpose.trim() === '') return { field: 'purpose', message: '분석 목적을 입력하세요.' };
    if (this.purpose.length > MAX_TASK_TEXT) return { field: 'purpose', message: '분석 목적은 8192자 이하여야 합니다.' };
    if (this.recipient.trim() === '') return { field: 'recipient', message: '수신처를 입력하세요.' };
    if (this.recipient.length > MAX_TASK_TEXT) return { field: 'recipient', message: '수신처는 8192자 이하여야 합니다.' };
    if (!this.consent) return { field: 'consent', message: CONSENT_MESSAGE };
    return null;
  }

  private httpFailure(status: number, code: string): string {
    if (status === 400) {
      return `서버가 분석 입력을 거부했습니다(400${code}). 원인을 특정할 수 없으므로 파일 형식·크기·개수·내용과 ` +
        '목적·수신처를 확인하세요. 자동으로 다시 시도하지 않았습니다.';
    }
    if (status === 413) {
      return `분석 요청 본문이 서버 한도를 넘었습니다(413${code}). 파일 수나 크기를 줄이세요.`;
    }
    if (status === 415) {
      return `분석 요청이 JSON으로 전달되지 않았다는 오류입니다(415${code}). 화면 문제로 보이니 운영 담당자에게 알리세요.`;
    }
    if (status === 503 && code.trim() === 'MODEL_BUDGET_EXCEEDED') {
      return '모델 입력 예산을 넘었습니다(503 MODEL_BUDGET_EXCEEDED). 파일 단순 크기 한도와 별개인 모델 제공자 ' +
        '설정 예산 문제이므로 자동 재시도하지 않습니다. 운영 담당자에게 문의하세요.';
    }
    if (status === 503) {
      return `분석 모델·엔진을 사용할 수 없습니다(503${code}). 자동으로 다시 시도하지 않았습니다.`;
    }
    return `분석에 실패했습니다(${status}${code}). 자동으로 다시 시도하지 않았습니다.`;
  }

  private failRequest(message: string): void {
    this.problem = { field: 'request', message };
    this.message = this.withPreviousResult(message);
    this.notify();
  }

  private cancelledMessage(reason: string): void {
    if (!this.busy) return;
    this.requestSeq += 1;
    this.controller?.abort();
    this.controller = null;
    this.busy = false;
    this.message = this.withPreviousResult(reason);
  }

  private withPreviousResult(message: string): string {
    if (this.result === null) return message;
    return this.resultIsCurrent
      ? `${message} 직전 분석 결과는 그대로 유지합니다.`
      : `${message} 이전 분석 결과는 이전 입력 기준으로 유지합니다.`;
  }

  private releaseController(controller: AbortController): void {
    if (this.controller === controller) this.controller = null;
  }

  private notify(): void {
    try {
      this.onChange();
    } catch {
      // 화면 콜백 오류는 상태 전이를 막지 않는다.
    }
  }

  // 비동기 요청 소유권. 가장 최근에 시작한 요청만 busy/message/result를 바꾼다.
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
}
