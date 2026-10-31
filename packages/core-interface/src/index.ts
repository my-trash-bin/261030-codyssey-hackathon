// This package is the only shared dependency of server, cores and connectors.
// It contains no Node APIs, persistence, HTTP or implementation imports.
//
// Core below is the narrow, committed writer+reviewer contract: approved facts in, a
// document out. The wider pipeline (evidence analysis, disclosure assistance, reproduction)
// is Engine in workflow.ts, which extends Core — see workflow.ts for why decide() is not
// part of either.
export interface ApprovedFact { id: string; text: string }
export interface GenerateRequest {
  purpose: string;
  recipient: string;
  facts: ApprovedFact[];
}
export interface CoreInfo {
  implementation: 'fake' | 'real';
  connection: 'direct' | 'simulated';
  ready: boolean;
}
export interface GenerateResult {
  document: { title: string; body: string };
  provenance: CoreInfo;
}
export interface Core {
  readonly info: CoreInfo;
  generate(input: GenerateRequest, options?: { signal?: AbortSignal }): Promise<GenerateResult>;
}
export type CoreErrorCode = 'INVALID_CORE_INPUT' | 'CORE_NOT_IMPLEMENTED' | 'CORE_UNAVAILABLE' | 'CORE_CANCELLED';
export class CoreError extends Error {
  readonly code: CoreErrorCode;
  constructor(code: CoreErrorCode) { super(code); this.code = code; }
}
export function parseGenerateRequest(value: unknown): GenerateRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CoreError('INVALID_CORE_INPUT');
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).sort().join(',') !== 'facts,purpose,recipient' ||
      typeof fields.purpose !== 'string' || !fields.purpose.trim() ||
      typeof fields.recipient !== 'string' || !fields.recipient.trim() ||
      !Array.isArray(fields.facts) || fields.facts.length < 1 || fields.facts.length > 40) {
    throw new CoreError('INVALID_CORE_INPUT');
  }
  const seen = new Set<string>();
  const facts: ApprovedFact[] = fields.facts.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CoreError('INVALID_CORE_INPUT');
    const fact = value as Record<string, unknown>;
    if (Object.keys(fact).sort().join(',') !== 'id,text' || typeof fact.id !== 'string' || !fact.id ||
        typeof fact.text !== 'string' || !fact.text.trim() || seen.has(fact.id)) throw new CoreError('INVALID_CORE_INPUT');
    seen.add(fact.id);
    return { id: fact.id, text: fact.text };
  });
  return { purpose: fields.purpose, recipient: fields.recipient, facts };
}
export * from './workflow.ts';
export * from './reproduction.ts';
export * from './model.ts';
export * from './skills.ts';
export * from './tools.ts';
