import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { toWireSources } from '../../analysis-state.ts';
import type { WireSource } from '../../analysis-state.ts';
import { deleteSource, replaceSources } from '../../task-client.ts';
import type { TaskFailure, TaskSourceInfo } from '../../task-client.ts';
import { defaultFetch, withUniqueIds } from '../../task-flow-model.ts';
import type { IntakeField, SelectedTask } from '../../task-flow-model.ts';
type Ref<T> = { current: T };
interface Options {
 addFiles: File[]; addFilesRef: Ref<File[]>; cacheRef: Ref<Map<string, WireSource>>; cachedSourceIds: string[];
 epochRef: Ref<number>; fail: (failure: TaskFailure) => void; filesRef: Ref<File[]>; isCurrent: (epoch: number) => boolean;
 loadTask: (id: string) => Promise<void>; refreshSources: (id: string, epoch: number) => Promise<void>;
 removingRef: Ref<boolean>; replaceRef: Ref<boolean>; report: (message: string) => void; selected: SelectedTask | null;
 selectedRef: Ref<SelectedTask | null>; setAddFilesState: Dispatch<SetStateAction<File[]>>;
 setCachedSourceIds: Dispatch<SetStateAction<string[]>>; setClearAddSignal: Dispatch<SetStateAction<number>>;
 setClearFilesSignal: Dispatch<SetStateAction<number>>; setFilesState: Dispatch<SetStateAction<File[]>>;
 setInvalidField: Dispatch<SetStateAction<IntakeField | null>>; setRemovingSourceId: Dispatch<SetStateAction<string | null>>;
 setReplaceBusy: Dispatch<SetStateAction<boolean>>; sources: TaskSourceInfo[]; sourcesBusy: boolean;
 sourcesRef: Ref<TaskSourceInfo[]>; taskCachesRef: Ref<Map<string, Map<string, WireSource>>>; tokenRef: Ref<string | null>;
}
export function useTaskSourceActions(options: Options) {
 const { addFiles, addFilesRef, cacheRef, cachedSourceIds, epochRef, fail, filesRef, isCurrent, loadTask, refreshSources,
  removingRef, replaceRef, report, selected, selectedRef, setAddFilesState, setCachedSourceIds, setClearAddSignal,
  setClearFilesSignal, setFilesState, setInvalidField, setRemovingSourceId, setReplaceBusy, sources, sourcesBusy,
  sourcesRef, taskCachesRef, tokenRef } = options;
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
        report(`원자료 ${appended.length}개를 추가해 판본 ${result.value.revision}이 되었습니다. 다시 분석할 수 있습니다.`);
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
        report(`원자료를 해제해 판본 ${result.value.revision}이 되었습니다. 다시 분석할 수 있습니다.`);
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
        report(`원자료 ${wire.length}개로 교체해 판본 ${result.value.revision}이 되었습니다. 다시 분석할 수 있습니다.`);
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

  return { canAddSources, addSources, removeSource, replaceSelectedSources };
}
