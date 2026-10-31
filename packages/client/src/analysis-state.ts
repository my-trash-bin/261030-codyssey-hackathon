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
export const MAX_BODY_BYTES = 1572864;
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

export const NO_SUBTLE_MESSAGE =
  '이 주소에서는 암호화 API(crypto.subtle)를 쓸 수 없어 파일 SHA256을 계산할 수 없습니다. ' +
  'HTTPS 또는 localhost 주소에서 다시 시도하세요. LAN의 HTTP 주소에서는 분석을 실행할 수 없습니다.';
export const NETWORK_MESSAGE = '분석 요청을 보내지 못했습니다. 서버 연결을 확인하세요. 자동으로 다시 시도하지 않았습니다.';
export const INVALID_RESPONSE_MESSAGE =
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

export async function readSources(files: readonly File[], subtle: SubtleCrypto): Promise<AnalysisSource[]> {
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

export interface WireSource {
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

export function toWireSource(source: AnalysisSource, index: number): WireSource {
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

// v1 작업 원자료 등록용 변환. 파일 수·크기 한도까지 여기서 검사한다.
export async function toWireSources(files: readonly File[], subtle: SubtleCrypto): Promise<WireSource[]> {
  if (files.length === 0) throw new Error('원자료 파일을 하나 이상 고르세요.');
  if (files.length > MAX_FILES) throw new Error(`원자료는 ${MAX_FILES}개까지 등록할 수 있습니다.`);
  let total = 0;
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}이(가) 파일 한도 ${MAX_FILE_BYTES / 1024} KiB를 넘습니다.`);
    total += file.size;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error(`선택한 파일 합계가 한도 ${MAX_TOTAL_BYTES / 1048576} MiB를 넘습니다.`);
  return (await readSources(files, subtle)).map(toWireSource);
}

export function serverErrorCode(body: unknown): string {
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

export function parseResult(
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

// run()이 실제 전송 전에 확인하는 입력 조건. 서버 검증을 대신하지 않고 화면 차단 사유만 만든다.
export interface AnalysisInput {
  files: readonly File[];
  purpose: string;
  recipient: string;
  consent: boolean;
}

export function validateAnalysisInput(input: AnalysisInput): AnalysisProblem | null {
  const { files, purpose, recipient, consent } = input;
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
  if (purpose.trim() === '') return { field: 'purpose', message: '분석 목적을 입력하세요.' };
  if (purpose.length > MAX_TASK_TEXT) return { field: 'purpose', message: '분석 목적은 8192자 이하여야 합니다.' };
  if (recipient.trim() === '') return { field: 'recipient', message: '수신처를 입력하세요.' };
  if (recipient.length > MAX_TASK_TEXT) return { field: 'recipient', message: '수신처는 8192자 이하여야 합니다.' };
  if (!consent) return { field: 'consent', message: CONSENT_MESSAGE };
  return null;
}

export function analysisHttpFailure(status: number, code: string): string {
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
