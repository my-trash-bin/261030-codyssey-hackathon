// 선택한 파일 → v1 작업 원자료(PUT /tasks/{id}/sources) 변환 경계.
//
// 계약 근거: packages/core/src/evidence-parser.ts의 입력 한도, server/src/app.ts의 원자료 snapshot
// 교체 라우트. stateless `POST /api/analysis` 화면은 제거됐고 이 모듈은 파일 등록 변환만 맡는다.
//
// 정직 규칙:
// - 파일을 고르는 것만으로 전송하지 않는다. 훅이 원자료 등록 명령을 낼 때만 변환한다.
// - 파일 하나라도 형식·크기·UTF-8 검증에 실패하면 나머지만 골라 보내지 않는다.
// - 서버가 계약 전체를 엄격히 검증하므로 파서를 복제하지 않는다.

export type AnalysisFileFormat = 'txt' | 'log' | 'md' | 'csv' | 'json';

export interface AnalysisSource {
  id: string;
  display_name: string;
  format: AnalysisFileFormat;
  sha256: string;
  bytes: Uint8Array;
}

const MAX_FILES = 100;
const MAX_FILE_BYTES = 262144;
const MAX_TOTAL_BYTES = 1048576;

const FORMATS: Record<string, AnalysisFileFormat> = { txt: 'txt', log: 'log', md: 'md', csv: 'csv', json: 'json' };

export const NO_SUBTLE_MESSAGE =
  '이 주소에서는 암호화 API(crypto.subtle)를 쓸 수 없어 파일 SHA256을 계산할 수 없습니다. ' +
  'HTTPS 또는 localhost 주소에서 다시 시도하세요. LAN의 HTTP 주소에서는 원자료를 등록할 수 없습니다.';

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
      bytes = new Uint8Array(await file.arrayBuffer());
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
export async function toWireSources(files: readonly File[], subtle: SubtleCrypto | undefined): Promise<WireSource[]> {
  if (!subtle) throw new Error(NO_SUBTLE_MESSAGE);
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
