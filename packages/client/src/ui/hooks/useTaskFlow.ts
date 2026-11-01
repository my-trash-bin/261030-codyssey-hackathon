// 작업 만들기와 분석 job. 세션의 CSRF 토큰이 있어야 하며, 선택된 작업은 공개 결정 영역의
// snapshot(revision)을 그대로 따른다. 원자료·수동 후보·분석은 실제 서버 경로만 호출하고,
// 작업이 바뀌면 진행 중인 poll의 늦은 응답을 버린다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toWireSources } from '../../analysis-state.ts';
import type { WireSource } from '../../analysis-state.ts';
import {
  addManualCandidate,
  cancelAnalysis,
  createContextTask,
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

  const [consent, setConsentState] = useState(false);
  const consentRef = useRef(false);
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

  const resetConsent = useCallback((): void => {
    consentRef.current = false;
    setConsentState(false);
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
      resetConsent();
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
    resetConsent();
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
  }, [options.snapshot, refreshSources, resetConsent]);

  // 원자료 구성이 바뀌면(추가·교체·삭제) 외부 전송 동의를 해제한다.
  const sourceSignature = sources.map((source) => `${source.sourceId}:${source.version}:${source.included}`).join('|');
  const sourceSignatureRef = useRef('');
  useEffect(() => {
    if (sourceSignatureRef.current === sourceSignature) return;
    sourceSignatureRef.current = sourceSignature;
    resetConsent();
  }, [sourceSignature, resetConsent]);

  const setField = useCallback((field: StringField, value: string): void => {
    formRef.current = { ...formRef.current, [field]: value } as IntakeForm;
    setForm(formRef.current);
    setInvalidField(null);
    // 목적·수신처·공개 범위·언어가 바뀌면 분석 동의를 다시 받는다.
    if (field !== 'internalTitle' && field !== 'legacyPurpose' && field !== 'legacyRecipient') resetConsent();
    if (field === 'legacyPurpose' || field === 'legacyRecipient') resetConsent();
  }, [resetConsent]);

  const setUseLegacy = useCallback((value: boolean): void => {
    formRef.current = { ...formRef.current, useLegacy: value };
    setForm(formRef.current);
    setInvalidField(null);
    resetConsent();
  }, [resetConsent]);

  const setFiles = useCallback((next: File[]): void => {
    filesRef.current = next;
    setFilesState(next);
    setInvalidField(null);
    resetConsent();
  }, [resetConsent]);

  const setAddFiles = useCallback((next: File[]): void => {
    addFilesRef.current = next;
    setAddFilesState(next);
    resetConsent();
  }, [resetConsent]);

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

  const setConsent = useCallback((value: boolean): void => {
    consentRef.current = value;
    setConsentState(value);
  }, []);

  const buildIntake = useCallback((input: IntakeForm): TaskIntake => ({
    internal_title: input.internalTitle.trim(),
    project_id: input.projectId,
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
      report('서버 카탈로그를 아직 읽지 못해 작업을 만들 수 없습니다. 카탈로그를 확인한 뒤 다시 시도하세요.');
      return;
    }
    const input = formRef.current;
    const usable = currentCatalog.projects.length > 0 && currentCatalog.recipients.length > 0 && currentCatalog.purposes.length > 0;
    const legacy = !usable && input.useLegacy;
    if (!usable && !legacy) {
      report('카탈로그에 프로젝트·수신처·목적이 설정되지 않았습니다. 운영자가 카탈로그를 설정해야 하며, 화면이 임의 기본값을 만들지 않습니다.');
      return;
    }
    if (legacy) {
      if (input.legacyPurpose.trim() === '') { setInvalidField('legacyPurpose'); report('기존 방식의 전달 목적을 입력하세요.'); return; }
      if (input.legacyRecipient.trim() === '') { setInvalidField('legacyRecipient'); report('기존 방식의 수신처를 입력하세요.'); return; }
    } else {
      if (input.internalTitle.trim() === '') { setInvalidField('internalTitle'); report('작업 제목을 입력하세요.'); return; }
      if (input.internalTitle.trim().length > 256) { setInvalidField('internalTitle'); report('작업 제목은 256자까지 쓸 수 있습니다.'); return; }
      if (input.projectId === '') { setInvalidField('projectId'); report('프로젝트를 선택하세요.'); return; }
      if (input.purposeId === '') { setInvalidField('purposeId'); report('전달 목적을 선택하세요.'); return; }
      if (input.recipientId === '') { setInvalidField('recipientId'); report('수신처를 선택하세요.'); return; }
      if (input.audience === '') { setInvalidField('audience'); report('공개 범위를 선택하세요.'); return; }
    }
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
        const created = legacy
          ? await createContextTask(defaultFetch, token, { purpose: input.legacyPurpose.trim(), recipient: input.legacyRecipient.trim() })
          : await createTask(defaultFetch, token, buildIntake(input));
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
        report(`작업을 만들고 원자료 ${wire.length}개를 등록했습니다. 분석 동의를 확인한 뒤 분석을 시작하세요.`);
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

  const includedSources = useMemo(() => sources.filter((source) => source.included), [sources]);
  const canAddSources = selected !== null
    && addFiles.length > 0
    && !sourcesBusy
    && includedSources.every((source) => cachedSourceIds.includes(source.sourceId));

  const addSources = useCallback((): void => {
    const task = selectedRef.current;
    const token = tokenRef.current;
    if (!task || !token || removingRef.current) return;
    const chosen = addFilesRef.current;
    if (chosen.length === 0) {
      report('추가할 원자료 파일을 고르세요.');
      return;
    }
    const current = sourcesRef.current.filter((source) => source.included);
    const existing: WireSource[] = [];
    for (const source of current) {
      const cached = cacheRef.current.get(source.sourceId);
      if (!cached) {
        report('이 브라우저에 기존 원자료 내용이 남아 있지 않아 기존 판본을 그대로 두고 추가할 수 없습니다. 원자료 등록·교체로 전체 파일을 다시 고르세요.');
        return;
      }
      existing.push(cached);
    }
    const epoch = epochRef.current;
    removingRef.current = true;
    setRemovingSourceId('add');
    report('추가 원자료를 서버에 등록하는 중입니다…');
    void (async (): Promise<void> => {
      try {
        let appended: WireSource[];
        try {
          const parsed = await toWireSources(chosen, crypto.subtle);
          appended = withUniqueIds(parsed, existing.length, crypto.randomUUID().slice(0, 8));
        } catch (error) {
          if (!isCurrent(epoch)) return;
          report(error instanceof Error ? error.message : '추가할 원자료를 읽지 못했습니다.');
          return;
        }
        if (!isCurrent(epoch)) return;
        const next = [...existing, ...appended];
        const result = await replaceSources(defaultFetch, token, task.id, task.revision, next);
        if (!isCurrent(epoch)) return;
        if (!result.ok) {
          fail(result.failure);
          return;
        }
        const appendedCache = new Map(next.map((source) => [source.source_id, source]));
        cacheRef.current = appendedCache;
        taskCachesRef.current.set(task.id, appendedCache);
        setCachedSourceIds(next.map((source) => source.source_id));
        addFilesRef.current = [];
        setAddFilesState([]);
        setClearAddSignal((count) => count + 1);
        report(`원자료 ${appended.length}개를 추가해 판본 ${result.value.revision}이 되었습니다. 분석 동의를 다시 확인하세요.`);
        await loadTask(task.id);
        if (!isCurrent(epoch)) return;
        await refreshSources(task.id, epoch);
      } finally {
        if (isCurrent(epoch)) {
          removingRef.current = false;
          setRemovingSourceId(null);
        }
      }
    })();
  }, [isCurrent, loadTask, refreshSources, fail]);

  const removeSource = useCallback((sourceId: string): void => {
    const task = selectedRef.current;
    const token = tokenRef.current;
    if (!task || !token || removingRef.current) return;
    removingRef.current = true;
    setRemovingSourceId(sourceId);
    const epoch = epochRef.current;
    report('선택한 원자료를 해제하는 중입니다…');
    void (async (): Promise<void> => {
      try {
        const result = await deleteSource(defaultFetch, token, task.id, sourceId, task.revision);
        if (!isCurrent(epoch)) return;
        if (!result.ok) {
          fail(result.failure);
          return;
        }
        cacheRef.current.delete(sourceId);
        setCachedSourceIds([...cacheRef.current.keys()]);
        report(`원자료를 해제해 판본 ${result.value.revision}이 되었습니다. 분석 동의를 다시 확인하세요.`);
        await loadTask(task.id);
        if (!isCurrent(epoch)) return;
        await refreshSources(task.id, epoch);
      } finally {
        if (isCurrent(epoch)) {
          removingRef.current = false;
          setRemovingSourceId(null);
        }
      }
    })();
  }, [isCurrent, loadTask, refreshSources, fail]);

  const replaceSelectedSources = useCallback((): void => {
    const task = selectedRef.current;
    const token = tokenRef.current;
    if (!task || !token || replaceRef.current) return;
    const chosen = filesRef.current;
    if (chosen.length === 0) {
      report('교체할 원자료 파일을 하나 이상 고르세요.');
      setInvalidField('files');
      return;
    }
    const epoch = epochRef.current;
    replaceRef.current = true;
    setReplaceBusy(true);
    report('선택한 작업의 원자료를 교체하는 중입니다…');
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
        // 서버는 같은 논리 source_id·version에 다른 원문을 허용하지 않는다. 교체는 새 논리 id로 보낸다.
        wire = withUniqueIds(wire, 0, crypto.randomUUID().slice(0, 8));
        const result = await replaceSources(defaultFetch, token, task.id, task.revision, wire);
        if (!isCurrent(epoch)) return;
        if (!result.ok) {
          fail(result.failure);
          return;
        }
        const replacedCache = new Map(wire.map((source) => [source.source_id, source]));
        cacheRef.current = replacedCache;
        taskCachesRef.current.set(task.id, replacedCache);
        setCachedSourceIds(wire.map((source) => source.source_id));
        filesRef.current = [];
        setFilesState([]);
        setClearFilesSignal((count) => count + 1);
        report(`원자료 ${wire.length}개로 교체해 판본 ${result.value.revision}이 되었습니다. 분석 동의를 다시 확인하세요.`);
        await loadTask(task.id);
        if (!isCurrent(epoch)) return;
        await refreshSources(task.id, epoch);
      } finally {
        if (isCurrent(epoch)) {
          replaceRef.current = false;
          setReplaceBusy(false);
        }
      }
    })();
  }, [fail, isCurrent, loadTask, refreshSources]);

  const evidenceOptions = useMemo<EvidenceOption[]>(() => {
    const snapshot = options.snapshot;
    if (!snapshot) return [];
    const names = new Map(snapshot.sources.map((source) => [source.id, source.display_name]));
    // 원자료가 바뀐 뒤 남은 이전 근거는 서버 candidate 검증을 통과하지 못하므로 고를 수 있게 두지 않는다.
    return snapshot.evidence
      .filter((evidence) => names.has(evidence.source_version_id))
      .map((evidence) => ({
        id: evidence.id,
        label: `${names.get(evidence.source_version_id) ?? '원자료'} · ${locatorLabel(evidence.locator)} · ${evidence.start}–${evidence.end}바이트`,
      }));
  }, [options.snapshot]);

  // 근거 목록이 바뀌면 사라진 근거 선택을 남기지 않는다.
  useEffect(() => {
    const valid = new Set(evidenceOptions.map((option) => option.id));
    const next = evidenceIdsRef.current.filter((id) => valid.has(id));
    if (next.length === evidenceIdsRef.current.length) return;
    evidenceIdsRef.current = next;
    setEvidenceIds(next);
  }, [evidenceOptions]);

  const submitManual = useCallback((): void => {
    const task = selectedRef.current;
    const token = tokenRef.current;
    if (!task || !token || manualBusyRef.current) return;
    const input = manualRef.current;
    if (input.kind === '') { setManualInvalid('kind'); report('후보 종류를 선택하세요.'); return; }
    if (input.uncertainty === '') { setManualInvalid('uncertainty'); report('확실성 수준을 선택하세요.'); return; }
    if (input.statement.trim() === '') { setManualInvalid('statement'); report('후보 문장을 입력하세요.'); return; }
    if ([...input.statement.trim()].length > 8192) { setManualInvalid('statement'); report('후보 문장은 8192자까지 쓸 수 있습니다.'); return; }
    if (input.relevance === '') { setManualInvalid('relevance'); report('필수·선택 여부를 선택하세요.'); return; }
    if (input.purposeRelevance.trim() === '') { setManualInvalid('purposeRelevance'); report('목적과의 관련성을 입력하세요.'); return; }
    if ([...input.purposeRelevance.trim()].length > 8192) { setManualInvalid('purposeRelevance'); report('목적과의 관련성은 8192자까지 쓸 수 있습니다.'); return; }
    const mode = manualModeRef.current;
    const refs = evidenceIdsRef.current;
    if (mode === 'evidence' && refs.length === 0) { setManualInvalid('evidenceIds'); report('근거를 하나 이상 선택하거나 직접 메모 방식을 고르세요.'); return; }
    if (mode === 'note' && input.userNote.trim() === '') { setManualInvalid('userNote'); report('직접 메모를 입력하세요.'); return; }
    if (mode === 'note' && [...input.userNote.trim()].length > 8192) { setManualInvalid('userNote'); report('직접 메모는 8192자까지 쓸 수 있습니다.'); return; }
    const payload: ManualCandidateInput = {
      candidate: {
        kind: input.kind,
        uncertainty: input.uncertainty,
        statement: input.statement.trim(),
        relevance: input.relevance,
        purpose_relevance: input.purposeRelevance.trim(),
      },
      ...(mode === 'evidence' ? { evidence_ids: refs } : { user_note: input.userNote.trim() }),
    };
    const epoch = epochRef.current;
    manualBusyRef.current = true;
    setManualBusy(true);
    report('수동 후보를 추가하는 중입니다…');
    void (async (): Promise<void> => {
      try {
        const result = await addManualCandidate(defaultFetch, token, task.id, task.revision, payload);
        if (!isCurrent(epoch)) return;
        if (!result.ok) {
          fail(result.failure);
          return;
        }
        manualRef.current = { ...INITIAL_MANUAL, kind: input.kind, uncertainty: input.uncertainty, relevance: input.relevance };
        setManual(manualRef.current);
        evidenceIdsRef.current = [];
        setEvidenceIds([]);
        report(`수동 후보를 추가해 판본 ${result.value.revision}이 되었습니다.`);
        await loadTask(task.id);
        if (!isCurrent(epoch)) return;
        await refreshSources(task.id, epoch);
      } finally {
        if (isCurrent(epoch)) {
          manualBusyRef.current = false;
          setManualBusy(false);
        }
      }
    })();
  }, [isCurrent, loadTask, refreshSources, fail]);

  const pollJob = useCallback((taskId: string, jobId: string, epoch: number): void => {
    analysisBusyRef.current = true;
    setAnalysisBusy(true);
    const startedAt = Date.now();
    void (async (): Promise<void> => {
      try {
        for (;;) {
          await sleep(800);
          if (!isCurrent(epoch)) return;
          const token = tokenRef.current;
          if (!token) return;
          const polled = await readAnalysisJob(defaultFetch, token, taskId, jobId);
          if (!isCurrent(epoch)) return;
          if (!polled.ok) {
            fail(polled.failure);
            return;
          }
          const value = polled.value;
          jobRef.current = value;
          setJob(value);
          const seconds = Math.round((Date.now() - startedAt) / 1000);
          if (value.status === 'running' || value.status === 'cancel_requested') {
            if (seconds > 180) {
              report('3분이 지나 상태 확인을 멈췄습니다. 상태 재확인으로 이어 보거나 분석 취소를 누르세요.');
              return;
            }
            report(value.status === 'cancel_requested'
              ? `분석 취소를 요청했습니다. 서버가 멈추기를 기다리는 중입니다… ${seconds}초`
              : `분석 job이 실행 중입니다… ${seconds}초`);
            continue;
          }
          jobRef.current = null;
          setJob(null);
          if (value.status === 'succeeded') {
            report('분석이 끝났습니다. 공개 결정 단계에서 후보를 확인하세요.');
            await loadTask(taskId);
            return;
          }
          report(value.status === 'failed'
            ? `분석이 실패했습니다.${value.errorCode === null ? '' : ` (${value.errorCode})`} 원자료와 분석 환경 설정을 확인하세요.`
            : value.status === 'cancelled'
              ? '분석이 취소되었습니다. 원자료를 그대로 두고 다시 시작할 수 있습니다.'
              : '원자료나 판본이 바뀌어 분석 결과가 무효가 되었습니다. 최신 상태를 다시 확인하세요.');
          return;
        }
      } finally {
        if (isCurrent(epoch)) {
          analysisBusyRef.current = false;
          setAnalysisBusy(false);
        }
      }
    })();
  }, [isCurrent, loadTask, fail]);

  const startJob = useCallback((): void => {
    const task = selectedRef.current;
    const token = tokenRef.current;
    if (analysisBusyRef.current || !task || !token) return;
    const activeJob = jobRef.current;
    if (activeJob !== null && (activeJob.status === 'running' || activeJob.status === 'cancel_requested')) {
      report('이미 실행 중인 분석이 있습니다. 상태 재확인이나 분석 취소를 먼저 이용하세요.');
      return;
    }
    if (!consentRef.current) {
      report('원자료가 외부 분석 환경으로 전송되는 것에 동의해야 분석을 시작할 수 있습니다.');
      return;
    }
    if (!sourcesRef.current.some((source) => source.included)) {
      report('등록된 원자료가 없습니다. 원자료를 먼저 등록하세요.');
      return;
    }
    const epoch = epochRef.current;
    analysisBusyRef.current = true;
    setAnalysisBusy(true);
    let handedOff = false;
    void (async (): Promise<void> => {
      try {
        report('분석을 시작하는 중입니다…');
        const started = await startAnalysis(defaultFetch, token, task.id, task.revision);
        if (!isCurrent(epoch)) return;
        if (!started.ok) {
          fail(started.failure);
          return;
        }
        jobRef.current = started.value;
        setJob(started.value);
        // job 시작은 작업 판본을 올린다. snapshot 판본을 먼저 맞춘 뒤 poll을 잇는다.
        await loadTask(task.id);
        if (!isCurrent(epoch)) return;
        handedOff = true;
        pollJob(task.id, started.value.id, epoch);
      } finally {
        if (isCurrent(epoch) && !handedOff) {
          analysisBusyRef.current = false;
          setAnalysisBusy(false);
        }
      }
    })();
  }, [isCurrent, loadTask, pollJob, fail]);

  const cancelJob = useCallback((): void => {
    const task = selectedRef.current;
    const jobState = jobRef.current;
    const token = tokenRef.current;
    if (!task || !jobState || !token || cancelBusyRef.current) return;
    cancelBusyRef.current = true;
    setCancelBusy(true);
    const epoch = epochRef.current;
    void (async (): Promise<void> => {
      try {
        const result = await cancelAnalysis(defaultFetch, token, task.id, jobState.id, task.revision);
        if (!isCurrent(epoch)) return;
        if (!result.ok) {
          fail(result.failure);
          return;
        }
        if (result.value.requested) {
          const requested = { ...jobState, status: 'cancel_requested' as const };
          jobRef.current = requested;
          setJob(requested);
          report('분석 취소를 요청했습니다. 서버가 멈추면 상태가 취소로 바뀝니다.');
          if (!analysisBusyRef.current) pollJob(task.id, jobState.id, epoch);
          return;
        }
        jobRef.current = null;
        setJob(null);
        report('이미 끝난 분석이라 취소 요청이 접수되지 않았습니다. 상태 재확인으로 최신 결과를 확인하세요.');
      } finally {
        if (isCurrent(epoch)) {
          cancelBusyRef.current = false;
          setCancelBusy(false);
        }
      }
    })();
  }, [isCurrent, pollJob, fail]);

  const recheck = useCallback((): void => {
    const task = selectedRef.current;
    const token = tokenRef.current;
    if (!task || !token || busyRef.current) return;
    const epoch = epochRef.current;
    busyRef.current = true;
    setBusy(true);
    void (async (): Promise<void> => {
      try {
        const meta = await readTask(defaultFetch, token, task.id);
        if (!isCurrent(epoch)) return;
        if (!meta.ok) {
          fail(meta.failure);
          return;
        }
        setTaskPhase(meta.value.phase);
        await loadTask(task.id);
        if (!isCurrent(epoch)) return;
        await refreshSources(task.id, epoch);
        if (!isCurrent(epoch)) return;
        if (meta.value.currentJobId !== null && meta.value.phase === 'processing' && !analysisBusyRef.current) {
          const running: AnalysisJobState = {
            id: meta.value.currentJobId,
            revision: meta.value.revision,
            status: meta.value.cancellationRequested ? 'cancel_requested' : 'running',
            errorCode: null,
          };
          jobRef.current = running;
          setJob(running);
          report('서버에서 실행 중인 분석을 찾았습니다. 상태를 이어서 확인합니다.');
          pollJob(task.id, meta.value.currentJobId, epoch);
          return;
        }
        report(meta.value.phase === null
          ? `작업 ${task.id} 판본 ${meta.value.revision}을 서버에서 확인했습니다.`
          : `작업 ${task.id} 판본 ${meta.value.revision} · 단계 ${meta.value.phase}`);
      } finally {
        if (isCurrent(epoch)) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    })();
  }, [isCurrent, loadTask, pollJob, refreshSources, fail]);

  const catalogUsable = catalog !== null
    && catalog.projects.length > 0
    && catalog.recipients.length > 0
    && catalog.purposes.length > 0;
  const catalogNeedsSetup = catalog !== null && !catalogUsable;
  const canStart = selected !== null
    && sources.some((source) => source.included)
    && consent
    && !analysisBusy
    && (job === null || (job.status !== 'running' && job.status !== 'cancel_requested'))
    && options.csrfToken !== null;

  return {
    catalog,
    catalogBusy,
    catalogProblem,
    catalogUsable,
    catalogNeedsSetup,
    reloadCatalog,

    form,
    setField,
    setUseLegacy,
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

    consent,
    setConsent,
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
