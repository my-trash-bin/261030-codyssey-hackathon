// Engine-side workflow types layered on top of the narrow Core contract in index.ts.
// Field names mirror contracts/candidate_proposals.v1, fact_pack.v1, draft.v1, review.v1,
// disclosure_proposal.v1 and disclosure_preview.v1. Server-only raw_grants/supersedes_id
// stay outside this projection. Scope and applied_rule_* are included for independent
// grounding checks; this is not the full persisted task aggregate.
import type { Core } from './index.ts';
import type { ReproduceRequest, ReproduceResult } from './reproduction.ts';

export type Uncertainty = 'observed' | 'reported' | 'inferred' | 'unknown';

export interface TaskContext {
  purpose: string;
  recipient: string;
  goal_variant?: 'default' | 'observations_only' | 'reproduction_evidence';
  output_language?: string;
}

// task.v1 sources[]: id is the specific version row, source_id the stable logical source
// across versions, version the version number. Engine only ever sees `included` rows that the
// server already selected; it does not decide inclusion itself.
export interface SourceDocument {
  id: string;
  source_id: string;
  version: number;
  display_name: string;
  format: 'txt' | 'log' | 'md' | 'csv' | 'json';
  source_slot: string;
  raw_bytes: string;   // base64, matching task.v1 sources[].raw_bytes' contentEncoding
  sha256: string;
  included: boolean;
}

// -- evidence analysis (candidate_proposals.v1): pure LLM inference + deterministic server
// parsing, no tool calls -- field names mirror task.v1's evidence[] entry exactly (verified
// against contracts/task.v1.schema.json, not the older 02-evidence-analysis.md prose, which
// uses different field names for the same concept and is not wire-authoritative).
export interface EvidenceLocator {
  kind: 'byte_range' | 'csv_cell' | 'json_pointer';
  column?: string;
  pointer?: string;
  row?: number;
  value_sha256?: string;
}
export interface EvidenceSpan {
  id: string;
  source_version_id: string;   // == SourceDocument.id, the versioned row, never source_id
  locator: EvidenceLocator;
  start: number;
  end: number;
  evidence_sha256: string;
}
// The model's raw response shape (candidate_proposals.v1) -- deliberately narrower than
// task.v1's persisted `candidates[]` entry. The server adds id (replacing local_key),
// selector, origin and conflict_group/conflict_reason when it persists a response; those
// are server-assigned and do not belong on what the model returns.
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
// optional binding fields stay internal; review requires them rather than trusting a model to infer approval.
export interface Decision {
  id: string;
  candidate_id: string;
  disposition: 'allow' | 'exclude' | 'defer';
  representation: Representation;
  expires_at?: string | null;
  revoked: boolean;
  applied_rule_id: string;
  applied_rule_version: number;
  scope?: Scope;
  source_set_hash?: string;
  projection_sha256?: string;
}
export interface Scope {
  project_id: string; purpose_id: string; recipient_id: string;
  audience: 'public' | 'named_external'; skill_set_hash: string;
}
export interface Rule {
  id: string; version: number; scope: Scope; selector: string;
  representation: Representation; expires_at: string | null; revoked: boolean;
}
export interface FactGrounding {
  fact_id: string; decision_id: string; source: 'fresh_decision' | 'reused_rule';
  rule_id?: string; rule_version?: number;
}
// Internal effective snapshot. Wire Scope lacks goal_variant, so reusable rule goals
// require a separate server-owned binding rather than interpreting its absence as a wildcard.
export interface ReviewGroundingContext {
  input: ComposeFactPackInput;
  scope: Scope;
  source_set_hash: string;
  candidate_selectors: Record<string, string>;
  rule_goals: { rule_id: string; rule_version: number; goal_variant: NonNullable<TaskContext['goal_variant']> }[];
  approved_tool_results: PublicToolResult[];
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
  rules: Rule[];
}
export { composeFactPack } from './compose.ts';
export { groundFacts } from './grounding.ts';

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
  review(draft: Draft, factPack: FactPack, grounding?: ReviewGroundingContext): Promise<Review>;
  reproduce(request: ReproduceRequest, options?: { signal?: AbortSignal }): Promise<ReproduceResult>;
}
