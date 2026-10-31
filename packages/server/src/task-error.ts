export class TaskStoreError extends Error {
  constructor(code: 'INVALID_TASK_INPUT' | 'TASK_NOT_FOUND' | 'REVISION_CONFLICT' | 'INVALID_DECISION' | 'IDEMPOTENCY_CONFLICT' |
    'INVALID_ANALYSIS' | 'ANALYSIS_NOT_FOUND') { super(code); }
}
