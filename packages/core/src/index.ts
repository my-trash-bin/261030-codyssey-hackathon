import { CoreError, ModelError, groundFacts, parseGenerateRequest } from '@safehandoff/core-interface';
import type {
  AnalyzeRequest, AnalyzeResult, Candidate, CoreInfo, DisclosurePreview, DisclosureProposal, Draft, Engine, EngineConfig,
  FactPack, GenerateRequest, GenerateResult, ModelClient, ModelRequest, Representation, ReproduceRequest,
  ReproduceResult, ReproRunner, Review, ReviewGroundingContext, TaskContext,
} from '@safehandoff/core-interface';
import { parseDraft, parseReview, validateDraft } from './validation.ts';
import { approvedRequestGrounding, validateProjectionHashes } from './fresh-grounding.ts';

import type { TranscriptRun, TranscriptSink } from './transcript.ts';

type Run = { trace?: TranscriptRun; calls: number; signal?: AbortSignal; grounding?: ReviewGroundingContext };
export class RealCore implements Engine {
  private readonly model?: ModelClient;
  private readonly config?: EngineConfig;
  private readonly runner?: ReproRunner;
  private readonly clock: () => number;
  private readonly transcripts?: TranscriptSink;
  constructor(model?: ModelClient, config?: EngineConfig, runner?: ReproRunner, clock: () => number = Date.now, transcripts?: TranscriptSink) {
    this.transcripts = transcripts;
    this.clock = clock;
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
      run.trace?.emit('model_started', { role: request.role, call: run.calls, attempt: attempt + 1 }, request);
      try {
        const response = await this.model.complete(request, { signal: run.signal });
        if (run.signal?.aborted) throw new CoreError('CORE_CANCELLED');
        const parsed = parse(response.text);
        run.trace?.emit('model_completed', { role: request.role, call: run.calls, usage: response.usage },
          request.role === 'writer' ? parsed : undefined);
        return parsed;
      } catch (error) {
        run.trace?.emit('model_failed', { role: request.role, call: run.calls,
          code: error instanceof ModelError || error instanceof CoreError ? error.code : 'UNEXPECTED_ERROR' });
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
  private groundingReview(pack: FactPack, context?: ReviewGroundingContext): Review | null {
    try { if (!context) throw new Error(); validateProjectionHashes(context); groundFacts(context, pack, this.clock()); return null; }
    catch { return { schema_version: 'review.v1', result: 'needs_decision', issues: [{ target: { kind: 'document' },
      reason_code: 'NEEDS_DISCLOSURE_DECISION', action: null, approved_fact_ids: pack.facts.map(fact => fact.id),
      candidate_ids: [], internal_explanation: 'Current decision or reusable-rule grounding is missing or invalid.' }] }; }
  }
  private async check(draft: Draft, pack: FactPack, run: Run): Promise<Review> {
    validateDraft(draft, pack);
    const denied = this.groundingReview(pack, run.grounding);
    if (denied) { run.trace?.emit('review_completed', { result: denied.result, grounding: 'denied' }); return denied; }
    const grounding = groundFacts(run.grounding!, pack, this.clock());
    const review = await this.call({ role: 'reviewer', responseFormat: 'json',
      systemPrompt: 'Return JSON only with exactly these root keys: schema_version, result, issues. ' +
        'schema_version must be the literal string review.v1. A passing response is ' +
        '{"schema_version":"review.v1","result":"pass","issues":[]}. ' +
        'Other result values are needs_changes/needs_decision/error. Always include schema_version. ' +
        'Every fact must have grounding: fresh_decision or reused_rule with rule id/version. ' +
        'If a statement depends on previous permission or an ungrounded prior approval, return needs_decision with ' +
        'NEEDS_DISCLOSURE_DECISION. Never create or infer disclosure permission. ' +
        'Each issue requires target {kind:document or block,block_id?}, reason_code, action (string or null), ' +
        'approved_fact_ids, candidate_ids, internal_explanation. Check disclosure, uncertainty, required facts and references. ' +
        'Reason codes: UNAPPROVED_DISCLOSURE, UNSUPPORTED_CAUSAL_CLAIM, MISSING_REQUIRED_FACT, SOURCE_CONFLICT, ' +
        'UNCERTAINTY_REMOVED, INCORRECT_PROJECTION, UNAPPROVED_REFERENCE, NEEDS_DISCLOSURE_DECISION. Pass has no issues.',
      input: JSON.stringify({ draft, fact_pack: pack, grounding }),
    }, text => parseReview(text, draft, pack), run);
    const result = this.groundingReview(pack, run.grounding) ?? review;
    run.trace?.emit('review_completed', { result: result.result, reasons: result.issues.map(issue => issue.reason_code) });
    return result;
  }
  private async traced<T>(operation: string, work: (trace?: TranscriptRun) => Promise<T>): Promise<T> {
    const trace = this.transcripts?.start(operation);
    try {
      trace?.emit('run_started', { model_mode: this.model?.info.provider === 'fake' ? 'fixture' : 'live', recording: true });
      const result = await work(trace);
      trace?.emit('run_completed');
      return result;
    } catch (error) {
      trace?.emit('run_failed', { code: error instanceof CoreError || error instanceof ModelError ? error.code : 'UNEXPECTED_ERROR' });
      throw error;
    } finally { trace?.close(); }
  }
  write(pack: FactPack): Promise<Draft> { return this.traced('write', trace => this.draft(pack, { calls: 0, trace })); }
  review(draft: Draft, pack: FactPack, grounding?: ReviewGroundingContext): Promise<Review> {
    return this.traced('review', trace => this.check(structuredClone(draft), structuredClone(pack), { calls: 0, trace, grounding: grounding ? structuredClone(grounding) : undefined }));
  }

  // Full bounded repair workflow for Engine consumers; generate deliberately uses zero repairs.
  async writeReviewed(pack: FactPack, options?: { signal?: AbortSignal; maxRepairs?: number; grounding?: ReviewGroundingContext }): Promise<{ draft: Draft; review: Review }> {
    return this.traced('writeReviewed', trace => this.writeReviewedRun(pack, options, trace));
  }
  private async writeReviewedRun(pack: FactPack, options?: { signal?: AbortSignal; maxRepairs?: number; grounding?: ReviewGroundingContext }, trace?: TranscriptRun): Promise<{ draft: Draft; review: Review }> {
    pack = structuredClone(pack);
    const run: Run = { trace, calls: 0, signal: options?.signal, grounding: options?.grounding ? structuredClone(options.grounding) : undefined };
    const limit = options?.maxRepairs ?? this.config?.workflow.max_review_repairs ?? 0;
    if (!Number.isInteger(limit) || limit < 0 || limit > (this.config?.workflow.max_review_repairs ?? 0)) {
      throw new CoreError('INVALID_CORE_INPUT');
    }
    if (run.signal?.aborted) throw new CoreError('CORE_CANCELLED');
    if (!this.model || !this.config) throw new CoreError('CORE_NOT_IMPLEMENTED');
    const denied = this.groundingReview(pack, run.grounding);
    if (denied) trace?.emit('review_completed', { result: denied.result, grounding: 'denied' });
    if (denied) return { draft: { schema_version: 'draft.v1', blocks: [] }, review: denied };
    let draft = await this.draft(pack, run);
    for (let repairs = 0; ; repairs++) {
      const review = await this.check(draft, pack, run);
      if (review.result !== 'needs_changes' || repairs >= limit) return { draft, review };
      // No free-form explanations, actions or candidate IDs cross into the writer session.
      const feedback = review.issues.map(issue => ({ reason_code: issue.reason_code,
        ...(issue.target.kind === 'block' ? { block_id: issue.target.block_id } : {}),
        approved_fact_ids: issue.approved_fact_ids }));
      const expired = this.groundingReview(pack, run.grounding);
      if (expired) return { draft, review: expired };
      trace?.emit('repair_started', { repair: repairs + 1 });
      draft = await this.draft(pack, run, feedback);
    }
  }
  async generate(input: GenerateRequest, options?: { signal?: AbortSignal }): Promise<GenerateResult> {
    if (options?.signal?.aborted) throw new CoreError('CORE_CANCELLED');
    const approved = parseGenerateRequest(input);
    const pack: FactPack = { schema_version: 'fact_pack.v1', task_revision: 0, template_id: 'document',
      audience_type: approved.recipient, output_language: 'ko', approved_brief: '',
      facts: approved.facts.map(fact => ({ id: fact.id, kind: 'observation', statement: fact.text, uncertainty: 'reported' })),
      required_fact_ids: approved.facts.map(fact => fact.id), tables: [], excerpt_slots: [], asset_slots: [], public_tool_results: [] };
    try {
      const { draft, review } = await this.writeReviewed(pack, { signal: options?.signal, maxRepairs: 0, grounding: approvedRequestGrounding(approved, pack) });
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
    return this.traced('reproduce', async trace => {
      trace?.emit('reproduction_started');
      const result = await this.runner!.reproduce(request, options);
      trace?.emit('reproduction_completed', {}, result);
      return result;
    });
  }
}

export { createBuiltinTools, builtinArgumentsHash } from './builtin-tools.ts';
export type { BuiltinAuthority, BuiltinToolId } from './builtin-tools.ts';

export { FileTranscriptSink } from './transcript.ts';
export type { TranscriptEvent, TranscriptRun, TranscriptSink } from './transcript.ts';
