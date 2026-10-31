// 공개 결정 reducer의 액션과 요청 시점 조건. 상태 전이 입력만 표현하고 로직은 두지 않는다.
import type { Disposition, Job, Mode, Preview, Snapshot } from './disclosure-contract.ts';

// 요청 시점의 초안·스냅샷 조건. 응답이 도착했을 때 사용자가 같은 화면을 보고 있는지 판단한다.
export interface PreviewRequest {
  loadSeq: number;
  revision: number;
  candidateId: string;
  mode: Mode;
  condition: string;
  signature: string;
}

export interface JobRequest {
  loadSeq: number;
  revision: number;
  condition: string;
  jobId: string | null;
}

export type PreviewOutcome =
  | { kind: 'network' }
  | { kind: 'http'; status: number; code: string }
  | { kind: 'unreadable' }
  | { kind: 'ok'; preview: Preview };

export type JobOutcome =
  | { kind: 'network' }
  | { kind: 'http'; status: number; code: string }
  | { kind: 'unreadable' }
  | { kind: 'ok'; job: Job };

export type DisclosuresAction =
  | { type: 'task/load-start' }
  | { type: 'task/loaded'; taskId: string; snapshot: Snapshot }
  | { type: 'task/unreadable' }
  | { type: 'task/mismatch' }
  | { type: 'task/network-error' }
  | { type: 'task/http-error'; status: number; code: string }
  | { type: 'request/start' }
  | { type: 'request/end' }
  | { type: 'notice'; message: string }
  | { type: 'draft/notice'; id: string; message: string }
  | { type: 'draft/select'; id: string; disposition: Disposition | null }
  | { type: 'draft/mode'; id: string; mode: Mode }
  | { type: 'draft/condition'; id: string; text: string }
  | { type: 'draft/reusable'; id: string; value: boolean }
  | { type: 'scope/reduction'; value: boolean }
  | { type: 'draft/preview-result'; id: string; request: PreviewRequest; result: PreviewOutcome }
  | { type: 'draft/job-result'; id: string; usage: 'interpret' | 'refresh'; request: JobRequest; result: JobOutcome }
  | { type: 'batch/sent' }
  | { type: 'batch/conflict' }
  | { type: 'batch/failed'; status: number; code: string }
  | { type: 'batch/network-error' }
  | { type: 'revoke/sent' }
  | { type: 'revoke/conflict' }
  | { type: 'revoke/failed'; status: number; code: string }
  | { type: 'revoke/network-error' }
  | { type: 'reload/consumed' };
