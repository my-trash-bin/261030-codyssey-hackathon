import { CoreError, ModelError } from '@safehandoff/core-interface';
import type { Engine } from '@safehandoff/core-interface';
import type { TaskStore } from './task-store.ts';
import type { AnalysisAdoption } from './analysis-store.ts';
import { TaskStoreError } from './task-error.ts';

// No SQLite transaction/lock spans the model call. This is an internal service, not an HTTP job API.
export async function runTaskAnalysis(store: TaskStore, engine: Pick<Engine, 'analyze'>, id: string, revision: number,
  options?: { signal?: AbortSignal }): Promise<AnalysisAdoption> {
  if (options?.signal?.aborted) throw new CoreError('CORE_CANCELLED');
  const job = store.analysis.start(id, revision);
  const cancel = () => { store.analysis.cancel(id, job.id); };
  options?.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await engine.analyze({ task: job.snapshot.task, sources: job.snapshot.sources }, { signal: options?.signal });
    if (options?.signal?.aborted) throw new CoreError('CORE_CANCELLED');
    return store.analysis.complete(id, job.id, result);
  } catch (error) {
    store.analysis.fail(id, job.id, error instanceof ModelError || error instanceof CoreError ? error.code :
      error instanceof TaskStoreError ? error.message : 'ANALYSIS_FAILED');
    throw error;
  } finally { options?.signal?.removeEventListener('abort', cancel); }
}
