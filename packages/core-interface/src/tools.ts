// Registered-tool envelope (extensions.md §4-5, tool_request.v1) and the two adapter shapes
// it runs on: deterministic builtin functions and the sandboxed process adapter. F08's
// ReproRunner stays its own first-class port (run_repro_v1 is just a typed wrapper around it,
// per extensions.md's tool table); this file covers the other registered tools.
//
// Process tools reuse DockerReproRunner's container-execution primitive (pinned image digest,
// network none, non-root, read-only root, capability drop, CPU/memory/PID/time/output limits)
// rather than a shared supertype -- there is only one concrete instance (DockerReproRunner) to
// generalize from so far. Mounts are always read-only bind mounts, never OverlayFS: nothing
// here needs a writable merged view of pack files, only a separate tmpfs scratch directory,
// which DockerReproRunner already does for /out.

// tool_request.v1's example schema fixes `arguments` to one tool's shape (seed/codepoint_count,
// matching make_synthetic_inputs_v1); the envelope itself is generic across tool_ids, so this
// port keeps `arguments` opaque to the caller's chosen tool.
export interface ToolRequest<TArgs = unknown> {
  tool_id: string;
  tool_version: string;
  task_id: string;
  revision: number;
  grant_ids: string[];
  arguments: TArgs;
}

// extensions.md §4: "결과는 status, public_result, internal_diagnostics를 분리한다.
// public_result도 현재 공개 결정과 연결된 필드만 writer에 전달한다." internal_diagnostics
// never reaches a model prompt.
export type ToolResultStatus = 'ok' | 'denied' | 'unknown' | 'error' | 'timeout';
export interface ToolResult<TPublic = unknown> {
  status: ToolResultStatus;
  public_result: TPublic | null;
  internal_diagnostics: unknown;
}

// extensions.md §1: "결정적 변환 ... builtin 함수". Pure, no process, no network -- the
// derive_series_v1/render_timeline_v1/make_config_example_v1/make_synthetic_inputs_v1/
// render_approved_excerpt_v1 tools belong here, not behind ProcessToolRunner.
export interface BuiltinTool<TArgs = unknown, TPublic = unknown> {
  readonly tool_id: string;
  readonly kind: 'builtin';
  run(request: ToolRequest<TArgs>): ToolResult<TPublic>;
}

// extensions.md §5: "process 등록에는 실행 파일·이미지 digest, 고정 argv, input/output
// schema, 마운트 허용 파일, 시간·출력·자원 상한을 포함한다. 요청에서 argv나 mount 경로를
// 받지 않는다." The registration is fixed ahead of time by whoever installs the tool; a
// ToolRequest can never change argv or mounts.
export interface ToolMount { readonly host_path: string; readonly container_path: string }
export interface ToolRegistration {
  readonly tool_id: string;
  readonly tool_version: string;
  readonly image_digest: string;
  readonly argv: string[];
  readonly mounts: ToolMount[];   // always read-only; there is no writable mount for tools
  readonly timeoutMs: number;
}
export interface ProcessToolRunnerInfo { implementation: 'docker' | 'fake'; ready: boolean }
export interface ProcessToolRunner {
  readonly info: ProcessToolRunnerInfo;
  run<TArgs, TPublic>(
    registration: ToolRegistration,
    request: ToolRequest<TArgs>,
    options?: { signal?: AbortSignal },
  ): Promise<ToolResult<TPublic>>;
}

// -- the one required process checker (extensions.md §8, docs/features/07-domain-extensions.md
// §5 "맥락 예외"): check_doc_ip_context_v1 --
export interface ContextCheckUpstream { id: string; address: string }
export interface ContextCheckRequest {         // == context_check_request.v1
  schema_version: 'context_check_request.v1';
  finding_id: string;
  artifact_set_hash: string;
  detector_id: string;
  field_path: string;
  provenance: string;
  product_id: string;
  rule_active: boolean;
  config: { upstreams: ContextCheckUpstream[]; route: { upstream_id: string } };
}
export type ContextCheckStatus = 'allowed' | 'denied' | 'unknown' | 'error';
export interface ContextCheckResult {          // == context_check.v1
  schema_version: 'context_check.v1';
  finding_id: string;
  artifact_set_hash: string;
  status: ContextCheckStatus;
  reason_code: string;
}

// extensions.md §4: "실행 가능 도구는 앱 registry ∩ 역할 허용 목록 ∩ 선택 팩 ∩ 현재
// 결정의 교집합이다." Pure set intersection over already-resolved id lists; the registry/
// role-list/decision lookups themselves are server-owned state, wired next round. Signature
// only.
export declare function resolveToolAccess(options: {
  registeredToolIds: string[];
  roleAllowedToolIds: string[];
  packToolIds: string[];
  grantedToolIds: string[];
}): string[];
