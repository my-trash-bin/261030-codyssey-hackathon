import { setTimeout } from 'node:timers/promises';
import { CoreError } from '@safehandoff/core-interface';
import type { Core, CoreInfo, GenerateRequest, GenerateResult } from '@safehandoff/core-interface';

export interface ConnectionPlan { delayMs: number; failuresRemaining: number }
export class SimulatedConnection implements Core {
  private readonly target: Core;
  private plan: ConnectionPlan;
  constructor(target: Core, plan: ConnectionPlan = { delayMs: 0, failuresRemaining: 0 }) {
    this.target = target;
    this.plan = { ...plan };
  }
  get info(): CoreInfo { return { ...this.target.info, connection: 'simulated' }; }
  settings(): ConnectionPlan { return { ...this.plan }; }
  configure(plan: ConnectionPlan): void { this.plan = { ...plan }; }
  async generate(input: GenerateRequest, options?: { signal?: AbortSignal }): Promise<GenerateResult> {
    if (options?.signal?.aborted) throw new CoreError('CORE_CANCELLED');
    const { delayMs, failuresRemaining } = this.plan;
    // Consume failures at admission so concurrent requests cannot share one failure.
    if (failuresRemaining > 0) this.plan.failuresRemaining--;
    try { await setTimeout(delayMs, undefined, { signal: options?.signal }); }
    catch { throw new CoreError('CORE_CANCELLED'); }
    if (failuresRemaining > 0) throw new CoreError('CORE_UNAVAILABLE');
    const output = await this.target.generate(input, options);
    return { ...output, provenance: { ...output.provenance, connection: 'simulated' } };
  }
}
