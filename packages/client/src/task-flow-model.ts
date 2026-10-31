// 작업 만들기·분석 job 화면의 폼 상태와 표시용 도우미. 훅 본체는 useTaskFlow.ts에 두고,
// 이 모듈은 상태 모양과 서버 DTO를 옮기지 않는 순수 값·문자열만 다룬다.

import type { WireSource } from './analysis-state.ts';
import type {
  AnalysisJobState,
  Audience,
  CandidateKind,
  CandidateRelevance,
  CandidateUncertainty,
  OutputLanguage,
  TaskSourceInfo,
  WorkflowCatalog,
} from './task-client.ts';
import type { Snapshot } from './disclosure-contract.ts';

export interface TaskFlowOptions {
  csrfToken: string | null;
  onTaskLoaded: (id: string) => Promise<void> | void;
  snapshot?: Snapshot | null;
  /** 서버가 401을 답했을 때만 세션 재확인을 요청한다. 네트워크 오류로는 부르지 않는다. */
  onAuthRequired?: () => void;
}

export type StringField =
  | 'internalTitle'
  | 'projectId'
  | 'purposeId'
  | 'recipientId'
  | 'audience'
  | 'goalVariant'
  | 'outputLanguage'
  | 'legacyPurpose'
  | 'legacyRecipient';

export interface IntakeForm {
  internalTitle: string;
  projectId: string;
  purposeId: string;
  recipientId: string;
  audience: Audience | '';
  goalVariant: string;
  outputLanguage: OutputLanguage | '';
  legacyPurpose: string;
  legacyRecipient: string;
  useLegacy: boolean;
}

export type IntakeField = StringField | 'files';

export type ManualField = 'kind' | 'uncertainty' | 'statement' | 'relevance' | 'purposeRelevance' | 'userNote';

export interface ManualForm {
  kind: CandidateKind | '';
  uncertainty: CandidateUncertainty | '';
  statement: string;
  relevance: CandidateRelevance | '';
  purposeRelevance: string;
  userNote: string;
}

export type ManualMode = 'evidence' | 'note';

export interface EvidenceOption {
  id: string;
  label: string;
}

export interface SelectedTask {
  id: string;
  revision: number;
}

export interface TaskFlowApi {
  catalog: WorkflowCatalog | null;
  catalogBusy: boolean;
  catalogProblem: string;
  catalogUsable: boolean;
  catalogNeedsSetup: boolean;
  reloadCatalog: () => void;

  form: IntakeForm;
  setField: (field: StringField, value: string) => void;
  setUseLegacy: (value: boolean) => void;
  invalidField: IntakeField | null;

  files: File[];
  setFiles: (files: File[]) => void;
  clearFilesSignal: number;
  create: () => void;
  busy: boolean;

  selected: SelectedTask | null;
  taskPhase: string | null;
  sources: TaskSourceInfo[];
  sourcesBusy: boolean;
  addFiles: File[];
  setAddFiles: (files: File[]) => void;
  clearAddSignal: number;
  canAddSources: boolean;
  addSources: () => void;
  replaceSelectedSources: () => void;
  replaceBusy: boolean;
  removeSource: (sourceId: string) => void;
  removingSourceId: string | null;

  manualMode: ManualMode;
  setManualMode: (mode: ManualMode) => void;
  manual: ManualForm;
  setManualField: (field: ManualField, value: string) => void;
  evidenceOptions: EvidenceOption[];
  evidenceIds: string[];
  toggleEvidence: (id: string) => void;
  manualInvalid: ManualField | 'evidenceIds' | null;
  submitManual: () => void;
  manualBusy: boolean;

  consent: boolean;
  setConsent: (value: boolean) => void;
  job: AnalysisJobState | null;
  analysisBusy: boolean;
  cancelBusy: boolean;
  canStart: boolean;
  startJob: () => void;
  recheck: () => void;
  cancelJob: () => void;
  status: string;
}

export const INITIAL_FORM: IntakeForm = {
  internalTitle: '',
  projectId: '',
  purposeId: '',
  recipientId: '',
  audience: '',
  goalVariant: '',
  outputLanguage: '',
  legacyPurpose: '',
  legacyRecipient: '',
  useLegacy: false,
};

export const INITIAL_MANUAL: ManualForm = {
  kind: '',
  uncertainty: '',
  statement: '',
  relevance: '',
  purposeRelevance: '',
  userNote: '',
};

export const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

// 전역 fetch는 receiver를 요구하므로 호출 시점에 메서드로 부른다. 렌더마다 새 함수를 만들지 않는다.
export const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function locatorLabel(locator: Snapshot['evidence'][number]['locator']): string {
  if (locator.kind === 'csv_cell') return `CSV ${locator.column ?? ''} ${locator.row ?? ''}행`;
  if (locator.kind === 'json_pointer') return `JSON ${locator.pointer === '' ? '(root)' : locator.pointer}`;
  return '바이트 구간';
}

/** 원자료를 추가할 때 기존 logical id와 겹치지 않게 새 접미사를 붙인다. */
export function withUniqueIds(sources: readonly WireSource[], offset: number, suffix: string): WireSource[] {
  return sources.map((source, index) => ({
    ...source,
    id: `${source.id}_${suffix}`,
    source_id: `${source.source_id}_${suffix}`,
    source_slot: `input_${offset + index + 1}`,
  }));
}
