import type { Disposition, Draft, Mode, Snapshot } from '../../disclosure-contract.ts';
import type { FieldEntry } from '../../disclosure-state.ts';
export interface DisclosuresApi {
  readonly snapshot: Snapshot | null; readonly drafts: ReadonlyMap<string, Draft>; readonly fields: ReadonlyMap<string, FieldEntry>;
  readonly busy: boolean; readonly message: string; readonly writeBlockReason: string; readonly batchBlockReason: string;
  readonly canGenerate: boolean; loadTask(id: string): Promise<void>; clearTask(): void;
  chooseDisposition(id: string, disposition: Disposition | null): void; chooseMode(id: string, mode: Mode): Draft | null;
  setCondition(id: string, text: string): void; setReusable(id: string, value: boolean): void; loadFields(id: string): Promise<void>;
  toggleField(id: string, field: string, checked: boolean): Draft | null; preview(id: string, draftAtRequest?: Draft): Promise<void>;
  interpret(id: string): Promise<void>; refreshInterpretation(id: string): Promise<void>; apply(): Promise<void>;
  revoke(decisionId: string): Promise<void>;
}
