// Engine-side workflow types layered on top of the narrow Core contract in index.ts.
// Field names mirror contracts/candidate_proposals.v1, fact_pack.v1, draft.v1, review.v1,
// disclosure_proposal.v1 and disclosure_preview.v1. Server-only audit fields from task.v1
// (raw_grants, scope, applied_rule_*, supersedes_id) are intentionally omitted here: core
// only needs the fields it actually consumes, not the full persisted task aggregate.
import type { Core } from './index.ts';
import type { ReproduceRequest, ReproduceResult } from './reproduction.ts';

export type Uncertainty = 'observed' | 'reported' | 'inferred' | 'unknown';

export interface TaskContext {
  purpose: string;
  recipient: string;
  goal_variant?: 'default' | 'observations_only' | 'reproduction_evidence';
  output_language?: string;
}

export interface SourceDocument {
  id: string;
  format: 'txt' | 'log' | 'md' | 'csv' | 'json';
  display_name: string;
  raw_bytes: string;
}

// -- evidence analysis (candidate_proposals.v1): pure LLM inference + deterministic server
// parsing, no tool calls --
export interface EvidenceLocator {
  kind: 'byte_range' | 'csv_cell' | 'json_pointer';
  start?: number;
  end?: number;
  row?: number;
  column?: string;
  pointer?: string;
}
export interface EvidenceSpan {
  id: string;
  source_id: string;
  locator: EvidenceLocator;
  evidence_sha256: string;
}
export type CandidateKind = 'observation' | 'constraint' | 'hypothesis' | 'unknown' | 'identifier';
export interface Candidate {
  local_key: string;
  kind: CandidateKind;
  uncertainty: Uncertainty;
  statement: string;
  evidence_ids: string[];
  relevance: 'required' | 'optional';
  purpose_relevance: string;
}
export interface CandidateConflict { local_keys: string[]; reason: string }
export interface CandidateProposals {
  schema_version: 'candidate_proposals.v1';
  candidates: Candidate[];
  conflicts: CandidateConflict[];
}
export interface AnalyzeRequest { task: TaskContext; sources: SourceDocument[] }
export interface AnalyzeResult { evidence: EvidenceSpan[]; proposals: CandidateProposals }

// -- disclosure assistance (disclosure_proposal.v1 / disclosure_preview.v1): the model may
// propose and preview a representation, but the actual Decision is made by a human and owned
// by server --
export type RepresentationKind =
  | 'fact_summary' | 'derived_table' | 'selected_fields' | 'exact_value' | 'approved_excerpt';
export interface Representation {
  kind: RepresentationKind;
  transform_id?: string;
  parameters?: Record<string, number>;
}
export interface DisclosureProposal {
  schema_version: 'disclosure_proposal.v1';
  candidate_id: string;
  status: 'supported' | 'ambiguous' | 'unsupported';
  representation: Representation | null;
  requires_clarification: boolean;
}
export interface DisclosurePreview {
  schema_version: 'disclosure_preview.v1';
  preview_id: string;
  candidate_id: string;
  input_revision: number;
  representation: Representation;
  projection: { statement: string; columns: string[]; rows: string[][]; excerpt?: string };
  projection_sha256: string;
}
// Reduced projection of task.v1's decision ledger: server owns raw_grants/scope/
// source_set_hash/applied_rule_* for audit; core only needs enough to compose a fact pack.
export interface Decision {
  id: string;
  candidate_id: string;
  disposition: 'allow' | 'exclude' | 'defer';
  representation: Representation;
  expires_at?: string | null;
  revoked: boolean;
}

// -- approved fact pack (fact_pack.v1): a deterministic, non-LLM transform of decisions --
export interface Fact { id: string; kind: string; statement: string; uncertainty?: Uncertainty }
export interface TableSlot {
  id: string;
  file_name?: string;
  columns: string[];
  rows: string[][];
  numeric_columns?: number[];
}
export interface AssetSlot { id: string; bytes?: string }
export interface ExcerptSlot { id: string; bytes?: string }
export interface PublicToolResult { status: string; reason_code: string }
export interface FactPack {
  schema_version: 'fact_pack.v1';
  task_revision: number;
  template_id: string;
  audience_type: string;
  output_language: string;
  approved_brief: string;
  facts: Fact[];
  required_fact_ids: string[];
  tables: TableSlot[];
  excerpt_slots: ExcerptSlot[];
  asset_slots: AssetSlot[];
  public_tool_results: PublicToolResult[];
}
export interface ComposeFactPackInput {
  task: TaskContext;
  task_revision: number;
  template_id: string;
  audience_type: string;
  candidates: Candidate[];
  decisions: Decision[];
  previews: DisclosurePreview[];
}
export { composeFactPack } from './compose.ts';

// -- writer (draft.v1): receives only the approved fact pack, never raw sources --
export type DocBlockType = 'heading' | 'paragraph' | 'list' | 'table_ref' | 'excerpt_ref' | 'asset_ref';
export interface DocListItem { text: string; fact_ids: string[] }
export interface DocBlock {
  block_id?: string;
  type: DocBlockType;
  text?: string;
  level?: number;
  items?: DocListItem[];
  table_id?: string;
  excerpt_id?: string;
  asset_id?: string;
  fact_ids?: string[];
}
export interface Draft { schema_version: 'draft.v1'; blocks: DocBlock[] }

// -- reviewer (review.v1): automatic model re-check, bounded rewrite loop driven by
// fact id + reason code only --
export type ReviewResultKind = 'pass' | 'needs_changes' | 'needs_decision' | 'error';
export type ReviewReasonCode =
  | 'UNAPPROVED_DISCLOSURE'
  | 'UNSUPPORTED_CAUSAL_CLAIM'
  | 'MISSING_REQUIRED_FACT'
  | 'SOURCE_CONFLICT'
  | 'UNCERTAINTY_REMOVED'
  | 'INCORRECT_PROJECTION'
  | 'UNAPPROVED_REFERENCE'
  | 'NEEDS_DISCLOSURE_DECISION';
export interface ReviewTarget {
  kind: 'block' | 'document' | 'file';
  block_id?: string;
  artifact_file_id?: string;
}
export interface ReviewIssue {
  target: ReviewTarget;
  reason_code: ReviewReasonCode;
  action: string | null;
  approved_fact_ids: string[];
  candidate_ids: string[];
  internal_explanation: string;
}
export interface Review { schema_version: 'review.v1'; result: ReviewResultKind; issues: ReviewIssue[] }

// -- the full pipeline. Core (generate) is the writer+reviewer subset; Engine adds analysis,
// disclosure assistance and reproduction around it. decide() is deliberately absent: disclosure
// decisions are made by a human and persisted by server, not produced by the engine. --
export interface Engine extends Core {
  analyze(request: AnalyzeRequest, options?: { signal?: AbortSignal }): Promise<AnalyzeResult>;
  proposeDisclosure(candidate: Candidate, task: TaskContext): Promise<DisclosureProposal>;
  preview(candidate: Candidate, representation: Representation, inputRevision: number): Promise<DisclosurePreview>;
  write(factPack: FactPack): Promise<Draft>;
  review(draft: Draft, factPack: FactPack): Promise<Review>;
  reproduce(request: ReproduceRequest, options?: { signal?: AbortSignal }): Promise<ReproduceResult>;
}
