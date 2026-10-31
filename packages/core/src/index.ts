import { CoreError, ModelError, parseGenerateRequest } from '@safehandoff/core-interface';
import type {
  AnalyzeRequest, AnalyzeResult, Candidate, CoreInfo, DisclosurePreview, DisclosureProposal, Draft, Engine, EngineConfig,
  FactPack, GenerateRequest, GenerateResult, ModelClient, ModelRequest, Representation, ReproduceRequest,
  ReproduceResult, ReproRunner, Review, TaskContext,
} from '@safehandoff/core-interface';
import { parseDraft, parseReview, validateDraft } from './validation.ts';

type Run = { calls: number; signal?: AbortSignal };
export class RealCore implements Engine {
  private readonly model?: ModelClient;
  private readonly config?: EngineConfig;
  private readonly runner?: ReproRunner;
  constructor(model?: ModelClient, config?: EngineConfig, runner?: ReproRunner) {
    this.model = model;
    this.config = config;
    this.runner = runner;
    if (config && [config.provider.max_attempts_per_step, config.workflow.max_model_calls_per_run].some(
      value => !Number.isInteger(value) || value < 1)) throw new CoreError('INVALID_CORE_INPUT');
    if (config && (!Number.isInteger(config.workflow.max_review_repairs) || config.workflow.max_review_repairs < 0)) {
      throw new CoreError('INVALID_CORE_INPUT');
    }
  }
  get info(): CoreInfo {
    return { implementation: 'real', connection: 'direct', ready: Boolean(this.model?.info.ready && this.config) };
  }
  private async call<T>(request: ModelRequest, parse: (text: string) => T, run: Run): Promise<T> {
    if (run.signal?.aborted) throw new CoreError('CORE_CANCELLED');
    if (!this.model || !this.config) throw new CoreError('CORE_NOT_IMPLEMENTED');
    for (let attempt = 0; attempt < this.config.provider.max_attempts_per_step; attempt++) {
      if (run.signal?.aborted) throw new CoreError('CORE_CANCELLED');
      if (run.calls >= this.config.workflow.max_model_calls_per_run) throw new ModelError('MODEL_BUDGET_EXCEEDED');
      run.calls++;
      try {
        const response = await this.model.complete(request, { signal: run.signal });
        if (run.signal?.aborted) throw new CoreError('CORE_CANCELLED');
        return parse(response.text);
      } catch (error) {
        if (!(error instanceof ModelError) || error.code === 'MODEL_CANCELLED' || error.code === 'MODEL_BUDGET_EXCEEDED' ||
          attempt + 1 === this.config.provider.max_attempts_per_step) throw error;
      }
    }
    throw new ModelError('MODEL_UNAVAILABLE');
  }
  private draft(pack: FactPack, run: Run, feedback?: unknown): Promise<Draft> {
    return this.call({ role: 'writer', responseFormat: 'json',
      systemPrompt: 'Return draft.v1 JSON only: {schema_version:"draft.v1",blocks:[{type:"paragraph",text:string,fact_ids:string[]}]}. ' +
        'Use only approved facts; preserve uncertainty. Blocks may also be heading (level/text), list (items with text/fact_ids), ' +
        'table_ref (table_id), excerpt_ref (excerpt_id), asset_ref (asset_id). Optional unique block_id. Never invent references.',
      input: JSON.stringify({ fact_pack: pack, ...(feedback ? { feedback } : {}) }),
    }, text => parseDraft(text, pack), run);
  }
  private check(draft: Draft, pack: FactPack, run: Run): Promise<Review> {
    validateDraft(draft, pack);
    return this.call({ role: 'reviewer', responseFormat: 'json',
      systemPrompt: 'Return JSON only with exactly these root keys: schema_version, result, issues. ' +
        'schema_version must be the literal string review.v1. A passing response is ' +
        '{"schema_version":"review.v1","result":"pass","issues":[]}. ' +
        'Other result values are needs_changes/needs_decision/error. Always include schema_version. ' +
        'Each issue requires target {kind:document or block,block_id?}, reason_code, action (string or null), ' +
        'approved_fact_ids, candidate_ids, internal_explanation. Check disclosure, uncertainty, required facts and references. ' +
        'Reason codes: UNAPPROVED_DISCLOSURE, UNSUPPORTED_CAUSAL_CLAIM, MISSING_REQUIRED_FACT, SOURCE_CONFLICT, ' +
        'UNCERTAINTY_REMOVED, INCORRECT_PROJECTION, UNAPPROVED_REFERENCE, NEEDS_DISCLOSURE_DECISION. Pass has no issues.',
      input: JSON.stringify({ draft, fact_pack: pack }),
    }, text => parseReview(text, draft, pack), run);
  }
  write(pack: FactPack): Promise<Draft> { return this.draft(pack, { calls: 0 }); }
  review(draft: Draft, pack: FactPack): Promise<Review> { return this.check(draft, pack, { calls: 0 }); }

  // Full bounded repair workflow for Engine consumers; generate deliberately uses zero repairs.
  async writeReviewed(pack: FactPack, options?: { signal?: AbortSignal; maxRepairs?: number }): Promise<{ draft: Draft; review: Review }> {
    const run: Run = { calls: 0, signal: options?.signal };
    const limit = options?.maxRepairs ?? this.config?.workflow.max_review_repairs ?? 0;
    if (!Number.isInteger(limit) || limit < 0 || limit > (this.config?.workflow.max_review_repairs ?? 0)) {
      throw new CoreError('INVALID_CORE_INPUT');
    }
    let draft = await this.draft(pack, run);
    for (let repairs = 0; ; repairs++) {
      const review = await this.check(draft, pack, run);
      if (review.result !== 'needs_changes' || repairs >= limit) return { draft, review };
      // No free-form explanations, actions or candidate IDs cross into the writer session.
      const feedback = review.issues.map(issue => ({ reason_code: issue.reason_code,
        ...(issue.target.kind === 'block' ? { block_id: issue.target.block_id } : {}),
        approved_fact_ids: issue.approved_fact_ids }));
      draft = await this.draft(pack, run, feedback);
    }
  }
  async generate(input: GenerateRequest, options?: { signal?: AbortSignal }): Promise<GenerateResult> {
    if (options?.signal?.aborted) throw new CoreError('CORE_CANCELLED');
    const approved = parseGenerateRequest(input);
    const pack: FactPack = { schema_version: 'fact_pack.v1', task_revision: 0, template_id: 'document',
      audience_type: approved.recipient, output_language: 'ko', approved_brief: approved.purpose,
      facts: approved.facts.map(fact => ({ id: fact.id, kind: 'observation', statement: fact.text })),
      required_fact_ids: approved.facts.map(fact => fact.id), tables: [], excerpt_slots: [], asset_slots: [], public_tool_results: [] };
    try {
      const { draft, review } = await this.writeReviewed(pack, { signal: options?.signal, maxRepairs: 0 });
      if (review.result !== 'pass') throw new CoreError('CORE_UNAVAILABLE');
      const body = draft.blocks.map(block => block.type === 'list' ? block.items!.map(item => `- ${item.text}`).join('\n') :
        block.text ?? '').filter(Boolean).join('\n\n');
      const title = draft.blocks.find(block => block.type === 'heading')?.text ?? approved.purpose;
      return { document: { title, body }, provenance: this.info };
    } catch (error) {
      if (error instanceof ModelError) throw new CoreError(error.code === 'MODEL_CANCELLED' ? 'CORE_CANCELLED' : 'CORE_UNAVAILABLE');
      throw error;
    }
  }
  async analyze(_request: AnalyzeRequest, options?: { signal?: AbortSignal }): Promise<AnalyzeResult> {
    if (options?.signal?.aborted) throw new CoreError('CORE_CANCELLED');
    throw new CoreError('CORE_NOT_IMPLEMENTED');
  }
  async proposeDisclosure(_candidate: Candidate, _task: TaskContext): Promise<DisclosureProposal> {
    throw new CoreError('CORE_NOT_IMPLEMENTED');
  }
  async preview(_candidate: Candidate, _representation: Representation, _inputRevision: number): Promise<DisclosurePreview> {
    throw new CoreError('CORE_NOT_IMPLEMENTED');
  }
  async reproduce(request: ReproduceRequest, options?: { signal?: AbortSignal }): Promise<ReproduceResult> {
    if (options?.signal?.aborted) throw new CoreError('CORE_CANCELLED');
    if (!this.runner || !this.config?.reproduction.enabled) throw new CoreError('CORE_NOT_IMPLEMENTED');
    return this.runner.reproduce(request, options);
  }
}
