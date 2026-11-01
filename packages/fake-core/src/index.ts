import { createHash, randomUUID } from 'node:crypto';
import { CoreError, parseGenerateRequest } from '@safehandoff/core-interface';
import type {
  AnalyzeRequest, AnalyzeResult, Candidate, CoreInfo, DisclosurePreview, DisclosureProposal, Draft, Engine,
  FactPack, GenerateRequest, GenerateResult, PublicReviewFile, Representation, ReproduceRequest, ReproduceResult,
  Review, ReviewGroundingContext, TaskContext,
} from '@safehandoff/core-interface';

export interface FakeCoreScript { title: string; opening: string; closing: string }
export const defaultScript: FakeCoreScript = {
  title: '시연용 문의 초안',
  opening: '다음 관찰과 조건을 바탕으로 문의드립니다.',
  closing: '추가 조사에 필요한 정보와 권장 대응을 안내해 주세요.',
};
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const cancelled = (signal?: AbortSignal): void => { if (signal?.aborted) throw new CoreError('CORE_CANCELLED'); };

// Deterministic presentation engine. It implements the same Engine contract as RealCore but
// never calls an external model or reproduction runner.
export class FakeCore implements Engine {
  readonly info: CoreInfo = { implementation: 'fake', connection: 'direct', ready: true };
  private script: FakeCoreScript;
  constructor(script: FakeCoreScript = defaultScript) { this.script = { ...script }; }
  configure(script: FakeCoreScript): void { this.script = { ...script }; }
  settings(): FakeCoreScript { return { ...this.script }; }
  async checkModel(options?: { signal?: AbortSignal }): Promise<void> { cancelled(options?.signal); }
  async analyze(request: AnalyzeRequest, options?: { signal?: AbortSignal }): Promise<AnalyzeResult> {
    cancelled(options?.signal);
    const source = request.sources[0];
    if (!source) return { evidence: [], proposals: { schema_version: 'candidate_proposals.v1', candidates: [], conflicts: [] } };
    const bytes = Buffer.from(source.raw_bytes, 'base64');
    const evidenceId = `demo-evidence-${source.id}`;
    return {
      evidence: [{ id: evidenceId, source_version_id: source.id, locator: { kind: 'byte_range' }, start: 0,
        end: bytes.length, evidence_sha256: hash(bytes) }],
      proposals: { schema_version: 'candidate_proposals.v1', conflicts: [], candidates: [{
        local_key: 'demo-observation', kind: 'observation', uncertainty: 'reported', relevance: 'required',
        statement: '업무 과정에서 반복 입력과 수동 대조가 관찰되었습니다.',
        purpose_relevance: `${request.task.purpose} 전달에 필요한 시연용 관찰입니다.`, evidence_ids: [evidenceId],
      }] },
    };
  }
  async proposeDisclosure(candidate: Candidate, _task: TaskContext,
    options?: { condition?: string; signal?: AbortSignal }): Promise<DisclosureProposal> {
    cancelled(options?.signal);
    return { schema_version: 'disclosure_proposal.v1', candidate_id: candidate.local_key, status: 'supported',
      representation: { kind: 'fact_summary', transform_id: '', parameters: {} }, requires_clarification: false };
  }
  async preview(candidate: Candidate, representation: Representation, inputRevision: number): Promise<DisclosurePreview> {
    if (representation.kind !== 'fact_summary') throw new CoreError('CORE_NOT_IMPLEMENTED');
    const normalized = { kind: 'fact_summary' as const, transform_id: '', parameters: {} };
    const projection = { statement: candidate.statement, columns: [], rows: [] };
    return { schema_version: 'disclosure_preview.v1', preview_id: randomUUID(), candidate_id: candidate.local_key,
      input_revision: inputRevision, representation: normalized, projection,
      projection_sha256: hash(JSON.stringify(projection)), raw_grants: [] };
  }
  async write(pack: FactPack): Promise<Draft> {
    const blocks: Draft['blocks'] = [
      { type: 'heading', level: 2, text: this.script.title },
      ...pack.facts.map(fact => ({ type: 'paragraph' as const, text: fact.statement, fact_ids: [fact.id] })),
      ...pack.tables.map(table => ({ type: 'table_ref' as const, table_id: table.id })),
    ];
    return { schema_version: 'draft.v1', blocks };
  }
  async review(_draft: Draft, _pack: FactPack, _grounding?: ReviewGroundingContext,
    options?: { files?: PublicReviewFile[]; signal?: AbortSignal }): Promise<Review> {
    cancelled(options?.signal);
    return { schema_version: 'review.v1', result: 'pass', issues: [] };
  }
  async writeReviewed(pack: FactPack, options?: { signal?: AbortSignal; maxRepairs?: number; grounding?: ReviewGroundingContext;
    finalFiles?: (draft: Draft) => PublicReviewFile[]; onProgress?: (kind: string) => void;
    onDraft?: (draft: Draft | null) => void }): Promise<{ draft: Draft; review: Review }> {
    cancelled(options?.signal);
    options?.onProgress?.('writer_started');
    const draft = await this.write(pack);
    options?.onDraft?.(draft);
    options?.onProgress?.('review_started');
    let review = await this.review(draft, pack, options?.grounding, { signal: options?.signal });
    if (review.result === 'pass' && options?.finalFiles) {
      options.onProgress?.('files_review_started');
      review = await this.review(draft, pack, options.grounding, { files: options.finalFiles(draft), signal: options.signal });
    }
    return { draft, review };
  }
  async reproduce(_request: ReproduceRequest, options?: { signal?: AbortSignal }): Promise<ReproduceResult> {
    cancelled(options?.signal); throw new CoreError('CORE_NOT_IMPLEMENTED');
  }
  async generate(input: GenerateRequest, options?: { signal?: AbortSignal }): Promise<GenerateResult> {
    if (options?.signal?.aborted) throw new CoreError('CORE_CANCELLED');
    const approved = parseGenerateRequest(input);
    const script = this.settings();
    return {
      document: {
        title: script.title,
        body: [script.opening, `목적: ${approved.purpose}\n수신자: ${approved.recipient}`,
          approved.facts.map(fact => `- ${fact.text}`).join('\n'), script.closing].join('\n\n'),
      },
      provenance: { ...this.info },
    };
  }
}
