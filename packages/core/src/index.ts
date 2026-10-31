import { CoreError } from '@safehandoff/core-interface';
import type { Core, CoreInfo, GenerateRequest, GenerateResult } from '@safehandoff/core-interface';

// Implement the real generation workflow here without importing demo packages.
export class RealCore implements Core {
  readonly info: CoreInfo = { implementation: 'real', connection: 'direct', ready: false };
  async generate(_input: GenerateRequest, options?: { signal?: AbortSignal }): Promise<GenerateResult> {
    if (options?.signal?.aborted) throw new CoreError('CORE_CANCELLED');
    throw new CoreError('CORE_NOT_IMPLEMENTED');
  }
}
