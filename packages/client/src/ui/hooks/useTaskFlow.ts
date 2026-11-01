// 작업 만들기와 분석 job. 세션의 CSRF 토큰이 있어야 하며, 선택된 작업은 공개 결정 영역의
// snapshot(revision)을 그대로 따른다. 원자료·수동 후보·분석은 실제 서버 경로만 호출하고,
// 작업이 바뀌면 진행 중인 poll의 늦은 응답을 버린다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTaskSourceActions } from './useTaskSourceActions.ts';
import { useTaskManualActions } from './useTaskManualActions.ts';
import { useTaskAnalysisActions } from './useTaskAnalysisActions.ts';
import { toWireSources } from '../../analysis-state.ts';
import type { WireSource } from '../../analysis-state.ts';
import {
  addManualCandidate,
  cancelAnalysis,
  createTask,
  deleteSource,
  readAnalysisJob,
  readCatalog,
  readTask,
  readTaskSources,
  replaceSources,
  startAnalysis,
  taskFailureMessage,
} from '../../task-client.ts';
import type {
  AnalysisJobState,
  Audience,
  CandidateKind,
  CandidateRelevance,
  CandidateUncertainty,
  ManualCandidateInput,
  OutputLanguage,
  TaskFailure,
  TaskIntake,
  TaskSourceInfo,
  WorkflowCatalog,
} from '../../task-client.ts';
import type { Snapshot } from '../../disclosure-contract.ts';

export type {
  EvidenceOption,
  IntakeField,
  IntakeForm,
  ManualField,
  ManualForm,
  ManualMode,
  SelectedTask,
  StringField,
  TaskFlowApi,
  TaskFlowOptions,
} from '../../task-flow-model.ts';
import { defaultFetch, INITIAL_FORM, INITIAL_MANUAL, locatorLabel, sleep, withUniqueIds } from '../../task-flow-model.ts';
import type {
  EvidenceOption,
  IntakeField,
  IntakeForm,
  ManualField,
  ManualForm,
  ManualMode,
  SelectedTask,
  StringField,
  TaskFlowApi,
  TaskFlowOptions,
} from '../../task-flow-model.ts';

export function useTaskFlow(options: TaskFlowOptions): TaskFlowApi {
  const tokenRef = useRef<string | null>(options.csrfToken);
  tokenRef.current = options.csrfToken;
  const onTaskLoadedRef = useRef(options.onTaskLoaded);
  onTaskLoadedRef.current = options.onTaskLoaded;
  const onAuthRequiredRef = useRef(options.onAuthRequired);
  onAuthRequiredRef.current = options.onAuthRequired;

  const [catalog, setCatalog] = useState<WorkflowCatalog | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogProblem, setCatalogProblem] = useState('');
  const catalogRef = useRef<WorkflowCatalog | null>(null);
  const [catalogReload, setCatalogReload] = useState(0);

  const [form, setForm] = useState<IntakeForm>(INITIAL_FORM);
  const formRef = useRef<IntakeForm>(INITIAL_FORM);
  const [invalidField, setInvalidField] = useState<IntakeField | null>(null);

  const [files, setFilesState] = useState<File[]>([]);
  const filesRef = useRef<File[]>([]);
  const [clearFilesSignal, setClearFilesSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const [selected, setSelected] = useState<SelectedTask | null>(null);
  const selectedRef = useRef<SelectedTask | null>(null);
  const [taskPhase, setTaskPhase] = useState<string | null>(null);
  const [sources, setSources] = useState<TaskSourceInfo[]>([]);
  const sourcesRef = useRef<TaskSourceInfo[]>([]);
  const [sourcesBusy, setSourcesBusy] = useState(false);

  const [addFiles, setAddFilesState] = useState<File[]>([]);
  const addFilesRef = useRef<File[]>([]);
  const [clearAddSignal, setClearAddSignal] = useState(0);
  const [cachedSourceIds, setCachedSourceIds] = useState<string[]>([]);
  const cacheRef = useRef<Map<string, WireSource>>(new Map());
  // 작업별 원자료 원문 캐시. 같은 파일 이름이라도 작업이 다르면 source_id가 겹치므로 섞지 않는다.
  const taskCachesRef = useRef<Map<string, Map<string, WireSource>>>(new Map());
  const [removingSourceId, setRemovingSourceId] = useState<string | null>(null);
  const removingRef = useRef(false);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const replaceRef = useRef(false);

  const [manualMode, setManualModeState] = useState<ManualMode>('evidence');
  const manualModeRef = useRef<ManualMode>('evidence');
  const [manual, setManual] = useState<ManualForm>(INITIAL_MANUAL);
  const manualRef = useRef<ManualForm>(INITIAL_MANUAL);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const evidenceIdsRef = useRef<string[]>([]);
  const [manualInvalid, setManualInvalid] = useState<ManualField | 'evidenceIds' | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const manualBusyRef = useRef(false);

  const [job, setJob] = useState<AnalysisJobState | null>(null);
  const jobRef = useRef<AnalysisJobState | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const analysisBusyRef = useRef(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const cancelBusyRef = useRef(false);
  const [status, setStatus] = useState('');
  // 화면에 남길 실행 결과 문구. 빈 값이면 화면이 현재 작업 상태에 맞는 안내를 대신 보여 준다.
  const report = useCallback((message: string): void => { setStatus(message); }, []);

  const aliveRef = useRef(true);
  // 작업 전환마다 올린다. 늦게 도착한 이전 작업의 응답은 이 값이 달라져 버려진다.
  const epochRef = useRef(0);

  const isCurrent = useCallback((epoch: number): boolean => aliveRef.current && epochRef.current === epoch, []);

  const fail = useCallback((failure: TaskFailure): void => {
    report(taskFailureMessage(failure));
    if (failure.kind === 'auth') onAuthRequiredRef.current?.();
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const loadTask = useCallback(async (id: string): Promise<void> => {
    try {
      await onTaskLoadedRef.current(id);
    } catch {
      // snapshot 로더는 자기 상태 문구로 실패를 알린다. 여기서 흐름을 끊지 않는다.
    }
  }, []);

  const refreshSources = useCallback(async (taskId: string, epoch: number): Promise<void> => {
    const token = tokenRef.current;
    if (!token) return;
    setSourcesBusy(true);
    const result = await readTaskSources(defaultFetch, token, taskId);
    if (!isCurrent(epoch)) return;
    setSourcesBusy(false);
    if (!result.ok) {
      fail(result.failure);
      return;
    }
    sourcesRef.current = result.value;
    setSources(result.value);
  }, [isCurrent, fail]);

  // 카탈로그는 세션이 열릴 때 한 번 실제 서버에서 읽는다. 실패를 빈 카탈로그로 꾸미지 않는다.
  useEffect(() => {
    if (options.csrfToken === null) {
      catalogRef.current = null;
      setCatalog(null);
      setCatalogProblem('');
      setCatalogBusy(false);
      return;
    }
    let active = true;
    setCatalogBusy(true);
    setCatalogProblem('');
    void (async (): Promise<void> => {
      const result = await readCatalog(defaultFetch, options.csrfToken as string);
      if (!active) return;
      setCatalogBusy(false);
      if (!result.ok) {
        setCatalogProblem(`카탈로그를 불러오지 못했습니다. ${taskFailureMessage(result.failure)}`);
        return;
      }
      catalogRef.current = result.value;
      setCatalog(result.value);
    })();
    return () => { active = false; };
  }, [options.csrfToken, catalogReload]);

  const reloadCatalog = useCallback((): void => {
    setCatalogReload((count) => count + 1);
  }, []);

  // 선택 작업은 공개 결정 영역의 snapshot 판본을 따른다. 다른 기능이 판본을 올려도 여기서 즉시 맞춘다.
  useEffect(() => {
    const snapshot = options.snapshot ?? null;
    if (snapshot === null) {
      // 작업이 사라져도 이전 작업의 늦은 원자료 응답이 화면을 덮지 않게 세대를 올린다.
      epochRef.current += 1;
      selectedRef.current = null;
      setSelected(null);
      setTaskPhase(null);
      analysisBusyRef.current = false;
      setAnalysisBusy(false);
      jobRef.current = null;
      setJob(null);
      sourcesRef.current = [];
      setSources([]);
      setSourcesBusy(false);

      return;
    }
    const next = { id: snapshot.id, revision: snapshot.revision };
    const previous = selectedRef.current;
    selectedRef.current = next;
    setSelected(next);
    if (previous !== null && previous.id === snapshot.id) return;
    // 작업이 바뀌면 이전 작업의 poll·후보·원자료 상태를 남기지 않는다.
    epochRef.current += 1;
    jobRef.current = null;
    setJob(null);
    analysisBusyRef.current = false;
    setAnalysisBusy(false);
    setTaskPhase(null);

    sourcesRef.current = [];
    setSources([]);
    const cachedBytes = taskCachesRef.current.get(snapshot.id) ?? new Map<string, WireSource>();
    cacheRef.current = cachedBytes;
    setCachedSourceIds([...cachedBytes.keys()]);
    setAddFilesState([]);
    addFilesRef.current = [];
    evidenceIdsRef.current = [];
    setEvidenceIds([]);
    setManualInvalid(null);
    void refreshSources(snapshot.id, epochRef.current);
  }, [options.snapshot, refreshSources]);

  const setField = useCallback((field: StringField, value: string): void => {
    formRef.current = { ...formRef.current, [field]: value } as IntakeForm;
    setForm(formRef.current);
    setInvalidField(null);
  }, []);

  const setFiles = useCallback((next: File[]): void => {
    filesRef.current = next;
    setFilesState(next);
    setInvalidField(null);

  }, []);

  const setAddFiles = useCallback((next: File[]): void => {
    addFilesRef.current = next;
    setAddFilesState(next);

  }, []);

  const setManualMode = useCallback((mode: ManualMode): void => {
    manualModeRef.current = mode;
    setManualModeState(mode);
    setManualInvalid(null);
  }, []);

  const setManualField = useCallback((field: ManualField, value: string): void => {
    manualRef.current = { ...manualRef.current, [field]: value } as ManualForm;
    setManual(manualRef.current);
    setManualInvalid(null);
  }, []);

  const toggleEvidence = useCallback((id: string): void => {
    const current = evidenceIdsRef.current;
    const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    evidenceIdsRef.current = next;
    setEvidenceIds(next);
    setManualInvalid(null);
  }, []);

  const buildIntake = useCallback((input: IntakeForm): TaskIntake => ({
    internal_title: input.internalTitle.trim(),
    purpose_id: input.purposeId,
    recipient_id: input.recipientId,
    audience: input.audience as Audience,
    skill_ids: [],
    ...(input.goalVariant === '' ? {} : { goal_variant: input.goalVariant }),
    ...(input.outputLanguage === '' ? {} : { output_language: input.outputLanguage as OutputLanguage }),
  }), []);

  const create = useCallback((): void => {
    if (busyRef.current) return;
    const token = tokenRef.current;
    if (!token) {
      report('세션을 먼저 여세요. 작업 생성과 원자료 등록은 인증된 세션에서만 됩니다.');
      return;
    }
    const currentCatalog = catalogRef.current;
    if (currentCatalog === null) {
      report('작업 설정을 불러온 뒤 다시 시도하세요.');
      return;
    }
    const input = formRef.current;
    if (input.internalTitle.trim() === '') { setInvalidField('internalTitle'); report('작업 제목을 입력하세요.'); return; }
    if (input.internalTitle.trim().length > 256) { setInvalidField('internalTitle'); report('작업 제목은 256자까지 쓸 수 있습니다.'); return; }
    if (input.purposeId === '') { setInvalidField('purposeId'); report('전달 목적을 선택하세요.'); return; }
    if (input.recipientId === '') { setInvalidField('recipientId'); report('수신처를 선택하세요.'); return; }
    if (input.audience === '') { setInvalidField('audience'); report('공개 범위를 선택하세요.'); return; }
    const chosen = filesRef.current;
    if (chosen.length === 0) {
      setInvalidField('files');
      report('원자료 파일을 하나 이상 고르세요.');
      return;
    }
    const epoch = epochRef.current;
    busyRef.current = true;
    setBusy(true);
    report('원자료를 읽는 중입니다…');
    void (async (): Promise<void> => {
      try {
        let wire: WireSource[];
        try {
          wire = await toWireSources(chosen, crypto.subtle);
        } catch (error) {
          if (!isCurrent(epoch)) return;
          report(error instanceof Error ? error.message : '원자료를 읽지 못했습니다.');
          return;
        }
        if (!isCurrent(epoch)) return;
        report('작업을 만드는 중입니다…');
        const created = await createTask(defaultFetch, token, buildIntake(input));
        if (!isCurrent(epoch)) return;
        if (!created.ok) {
          fail(created.failure);
          return;
        }
        report('원자료를 등록하는 중입니다…');
        const registered = await replaceSources(defaultFetch, token, created.value.id, created.value.revision, wire);
        if (!isCurrent(epoch)) return;
        if (!registered.ok) {
          report(`작업은 만들어졌지만 원자료 등록에 실패했습니다. ${taskFailureMessage(registered.failure)}`);
          return;
        }
        const createdCache = new Map(wire.map((source) => [source.source_id, source]));
        cacheRef.current = createdCache;
        taskCachesRef.current.set(created.value.id, createdCache);
        setCachedSourceIds(wire.map((source) => source.source_id));
        filesRef.current = [];
        setFilesState([]);
        setClearFilesSignal((count) => count + 1);
        // 만든 작업의 입력이 폼에 남으면 수정 화면처럼 보인다. 다음 작업은 빈 폼에서 시작한다.
        formRef.current = INITIAL_FORM;
        setForm(INITIAL_FORM);
        report(`작업을 만들고 원자료 ${wire.length}개를 등록했습니다. 분석을 시작하세요.`);
        await loadTask(created.value.id);
      } finally {
        // 작업을 새로 만들면 snapshot 작업 id가 바뀌어 epoch가 올라간다. 이 작업 자신의 busy는 풀어야 한다.
        if (aliveRef.current) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    })();
  }, [buildIntake, isCurrent, loadTask, fail]);

  const { canAddSources, addSources, removeSource, replaceSelectedSources } = useTaskSourceActions({
    addFiles, addFilesRef, cacheRef, cachedSourceIds, epochRef, fail, filesRef, isCurrent, loadTask, refreshSources,
    removingRef, replaceRef, report, selected, selectedRef, setAddFilesState, setCachedSourceIds, setClearAddSignal,
    setClearFilesSignal, setFilesState, setInvalidField, setRemovingSourceId, setReplaceBusy, sources, sourcesBusy,
    sourcesRef, taskCachesRef, tokenRef,
  });

  const { evidenceOptions, submitManual } = useTaskManualActions({
    epochRef, evidenceIdsRef, fail, isCurrent, loadTask, manualBusyRef, manualModeRef, manualRef, refreshSources,
    report, selectedRef, setEvidenceIds, setManual, setManualBusy, setManualInvalid, snapshot: options.snapshot, tokenRef,
  });

  const { canStart, startJob, recheck, cancelJob } = useTaskAnalysisActions({
    analysisBusy, analysisBusyRef, busyRef, cancelBusyRef, csrfToken: options.csrfToken, epochRef, fail, isCurrent,
    job, jobRef, loadTask, refreshSources, report, selected, selectedRef, setAnalysisBusy, setBusy, setCancelBusy,
    setJob, setTaskPhase, sources, sourcesRef, tokenRef,
  });

  return {
    catalog,
    catalogBusy,
    catalogProblem,
    reloadCatalog,

    form,
    setField,
    invalidField,

    files,
    setFiles,
    clearFilesSignal,
    create,
    busy,

    selected,
    taskPhase,
    sources,
    sourcesBusy,
    addFiles,
    setAddFiles,
    clearAddSignal,
    canAddSources,
    addSources,
    replaceSelectedSources,
    replaceBusy,
    removeSource,
    removingSourceId,

    manualMode,
    setManualMode,
    manual,
    setManualField,
    evidenceOptions,
    evidenceIds,
    toggleEvidence,
    manualInvalid,
    submitManual,
    manualBusy,

    job,
    analysisBusy,
    cancelBusy,
    canStart,
    startJob,
    recheck,
    cancelJob,
    status,
  };
}
