import { useCallback, useEffect, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { addManualCandidate } from '../../task-client.ts';
import type { ManualCandidateInput, TaskFailure } from '../../task-client.ts';
import type { Snapshot } from '../../disclosure-contract.ts';
import { defaultFetch, INITIAL_MANUAL, locatorLabel } from '../../task-flow-model.ts';
import type { EvidenceOption, ManualField, ManualForm, ManualMode, SelectedTask } from '../../task-flow-model.ts';
type Ref<T> = { current: T };
interface Options { epochRef: Ref<number>; evidenceIdsRef: Ref<string[]>; fail: (failure: TaskFailure) => void;
 isCurrent: (epoch: number) => boolean; loadTask: (id: string) => Promise<void>; manualBusyRef: Ref<boolean>;
 manualModeRef: Ref<ManualMode>; manualRef: Ref<ManualForm>; refreshSources: (id: string, epoch: number) => Promise<void>;
 report: (message: string) => void; selectedRef: Ref<SelectedTask | null>; setEvidenceIds: Dispatch<SetStateAction<string[]>>;
 setManual: Dispatch<SetStateAction<ManualForm>>; setManualBusy: Dispatch<SetStateAction<boolean>>;
 setManualInvalid: Dispatch<SetStateAction<ManualField | 'evidenceIds' | null>>; snapshot?: Snapshot | null; tokenRef: Ref<string | null>; }
export function useTaskManualActions(options: Options) {
 const { epochRef, evidenceIdsRef, fail, isCurrent, loadTask, manualBusyRef, manualModeRef, manualRef, refreshSources,
  report, selectedRef, setEvidenceIds, setManual, setManualBusy, setManualInvalid, snapshot, tokenRef } = options;
  const evidenceOptions = useMemo<EvidenceOption[]>(() => {
    if (!snapshot) return [];
    const names = new Map(snapshot.sources.map((source) => [source.id, source.display_name]));
    // 원자료가 바뀐 뒤 남은 이전 근거는 서버 candidate 검증을 통과하지 못하므로 고를 수 있게 두지 않는다.
    return snapshot.evidence
      .filter((evidence) => names.has(evidence.source_version_id))
      .map((evidence) => ({
        id: evidence.id,
        label: `${names.get(evidence.source_version_id) ?? '원자료'} · ${locatorLabel(evidence.locator)} · ${evidence.start}–${evidence.end}바이트`,
      }));
  }, [snapshot]);

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

  return { evidenceOptions, submitManual };
}
