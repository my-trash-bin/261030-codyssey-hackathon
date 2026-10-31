import { ReproError } from '@safehandoff/core-interface';
import type { ReproduceRequest, ReproduceResult, ReproRunner, ReproRunnerInfo } from '@safehandoff/core-interface';

// Implement the real Docker-backed reproduction runner here (security.md 9: pinned digest,
// network none, non-root, read-only root, CPU/memory/PID/time/output limits). Do not import
// demo packages.
export class DockerReproRunner implements ReproRunner {
  readonly info: ReproRunnerInfo = { implementation: 'docker', ready: false };
  async reproduce(_request: ReproduceRequest, options?: { signal?: AbortSignal }): Promise<ReproduceResult> {
    if (options?.signal?.aborted) throw new ReproError('REPRO_CANCELLED');
    throw new ReproError('REPRO_UNAVAILABLE');
  }
}
