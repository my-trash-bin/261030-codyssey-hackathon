import { CoreError, parseGenerateRequest } from '@safehandoff/core-interface';
import type { Core, CoreInfo, GenerateRequest, GenerateResult } from '@safehandoff/core-interface';

export interface FakeCoreScript { title: string; opening: string; closing: string }
export const defaultScript: FakeCoreScript = {
  title: '시연용 문의 초안',
  opening: '다음 관찰과 조건을 바탕으로 문의드립니다.',
  closing: '추가 조사에 필요한 정보와 권장 대응을 안내해 주세요.',
};
export class FakeCore implements Core {
  readonly info: CoreInfo = { implementation: 'fake', connection: 'direct', ready: true };
  private script: FakeCoreScript;
  constructor(script: FakeCoreScript = defaultScript) { this.script = { ...script }; }
  configure(script: FakeCoreScript): void { this.script = { ...script }; }
  settings(): FakeCoreScript { return { ...this.script }; }
  async generate(input: GenerateRequest, options?: { signal?: AbortSignal }): Promise<GenerateResult> {
    if (options?.signal?.aborted) throw new CoreError('CORE_CANCELLED');
    const approved = parseGenerateRequest(input);
    const script = this.settings();
    return {
      document: {
        title: script.title,
        body: [script.opening, `목적: ${approved.purpose}\n수신자: ${approved.recipient}`,
          approved.facts.map(fact => `- ${fact.text}`).join('\n'), script.closing].join('\n\n'),
      },
      provenance: { ...this.info },
    };
  }
}
