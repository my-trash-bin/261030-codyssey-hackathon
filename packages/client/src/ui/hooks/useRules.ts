// 재사용 규칙 화면의 상태와 요청 수명. 목록은 세션이 있을 때만 읽고,
// 선택한 작업의 intake가 없으면 저장·적용이 불가능한 이유를 서버 값으로 설명한다.
// 작업 판본 충돌(409)은 전체 거부로 알리고 작업을 다시 조회한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../disclosure-state.ts';
import {
  applyRules,
  buildRuleRepresentation,
  createRuleVersion,
  listRules,
  readTaskDetail,
  revokeRule,
  saveRule,
} from '../../rules-client.ts';
import type { Representation } from '../../disclosure-contract.ts';
import type { RuleRecord, RuleRef, RuleTransformId, TaskDetail } from '../../rules-client.ts';
import { workflowFailureMessage } from '../../workflow-client.ts';

export interface UseRulesOptions {
  csrfToken: string | null;
  snapshot: Snapshot | null;
  onTaskChanged: (id: string) => Promise<void> | void;
  fetch?: typeof fetch;
}

export interface RuleVersionDraft {
  transformId: RuleTransformId;
  decimalPlaces: number;
  /** ISO 시각 또는 null. null이면 만료 없이 저장한다. */
  expiresAt: string | null;
}

export interface RulesApi {
  rules: RuleRecord[];
  rulesStatus: string;
  rulesBusy: boolean;
  taskDetail: TaskDetail | null;
  taskStatus: string;
  busyKey: string | null;
  message: string;
  refresh: () => void;
  saveFromDecision: (decisionId: string) => void;
  createVersion: (ruleId: string, expectedVersion: number, draft: RuleVersionDraft) => void;
  revoke: (ruleId: string, expectedVersion: number) => void;
  apply: (refs: readonly RuleRef[]) => void;
}

// 전역 fetch는 receiver를 요구하므로 호출 시점에 메서드로 부른다.
const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function useRules(options: UseRulesOptions): RulesApi {
  const token = options.csrfToken;
  const snapshot = options.snapshot;
  const snapshotId = snapshot?.id ?? null;

  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [rulesStatus, setRulesStatus] = useState('세션을 열면 규칙 목록을 조회합니다.');
  const [rulesBusy, setRulesBusy] = useState(false);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [taskStatus, setTaskStatus] = useState('작업을 선택하면 저장 범위를 확인합니다.');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const aliveRef = useRef(true);
  const tokenRef = useRef<string | null>(token);
  const snapshotRef = useRef<Snapshot | null>(snapshot);
  const fetchRef = useRef<typeof fetch>(options.fetch ?? defaultFetch);
  const onTaskChangedRef = useRef(options.onTaskChanged);
  tokenRef.current = token;
  snapshotRef.current = snapshot;
  fetchRef.current = options.fetch ?? defaultFetch;
  onTaskChangedRef.current = options.onTaskChanged;

  const rulesSeqRef = useRef(0);
  const detailSeqRef = useRef(0);
  const rulesLoadedRef = useRef(false);
  const actionRef = useRef<string | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      rulesSeqRef.current += 1;
      detailSeqRef.current += 1;
      actionRef.current = null;
    };
  }, []);

  const loadRules = useCallback(async (sessionToken: string): Promise<void> => {
    const owner = ++rulesSeqRef.current;
    setRulesBusy(true);
    if (!rulesLoadedRef.current) setRulesStatus('규칙 목록을 불러오는 중입니다.');
    const result = await listRules(fetchRef.current);
    if (!aliveRef.current || owner !== rulesSeqRef.current || tokenRef.current !== sessionToken) return;
    setRulesBusy(false);
    if (!result.ok) {
      setRulesStatus(workflowFailureMessage(result.failure));
      return;
    }
    rulesLoadedRef.current = true;
    setRules(result.value);
    setRulesStatus(result.value.length === 0
      ? '저장된 규칙이 없습니다. 작업의 허용 결정에서 규칙을 저장할 수 있습니다.'
      : `규칙 ${result.value.length}개를 불러왔습니다. 규칙마다 최신 판본만 표시합니다.`);
  }, []);

  const loadDetail = useCallback(async (sessionToken: string, taskId: string): Promise<void> => {
    const owner = ++detailSeqRef.current;
    setTaskDetail(null);
    setTaskStatus('작업의 저장 범위를 확인하는 중입니다.');
    const result = await readTaskDetail(fetchRef.current, taskId);
    if (!aliveRef.current || owner !== detailSeqRef.current || tokenRef.current !== sessionToken || snapshotRef.current?.id !== taskId) return;
    if (!result.ok) {
      setTaskStatus(`작업의 저장 범위를 확인하지 못했습니다. ${workflowFailureMessage(result.failure)}`);
      return;
    }
    setTaskDetail(result.value);
    setTaskStatus(result.value.intake === null
      ? `작업 ${result.value.id}은(는) catalog intake가 없는 작업입니다. 규칙 저장은 서버가 422 RULE_SCOPE_REQUIRED로 거부하고, 명시 적용도 거부합니다.`
      : '이 작업과 저장 범위가 정확히 같은 규칙만 적용됩니다.');
  }, []);

  const refreshTask = useCallback(async (taskId: string): Promise<void> => {
    try {
      await onTaskChangedRef.current(taskId);
    } catch {
      setMessage('작업을 다시 불러오지 못했습니다. 작업 목록에서 다시 선택하세요.');
    }
  }, []);

  useEffect(() => {
    if (token === null) {
      rulesSeqRef.current += 1;
      rulesLoadedRef.current = false;
      setRules([]);
      setRulesBusy(false);
      setRulesStatus('세션이 없어 규칙 목록을 조회하지 않습니다.');
      return;
    }
    void loadRules(token);
  }, [token, loadRules]);

  useEffect(() => {
    if (token === null) {
      detailSeqRef.current += 1;
      setTaskDetail(null);
      setTaskStatus('세션이 없어 작업 정보를 조회하지 않습니다.');
      return;
    }
    if (snapshotId === null) {
      detailSeqRef.current += 1;
      setTaskDetail(null);
      setTaskStatus('선택한 작업이 없습니다. 1단계에서 작업을 고르세요.');
      return;
    }
    void loadDetail(token, snapshotId);
  }, [token, snapshotId, loadDetail]);

  const refresh = useCallback((): void => {
    const sessionToken = tokenRef.current;
    if (sessionToken === null) {
      setRulesStatus('세션이 없어 규칙 목록을 조회하지 않습니다.');
      return;
    }
    void loadRules(sessionToken);
    if (snapshotId !== null) void loadDetail(sessionToken, snapshotId);
  }, [loadDetail, loadRules, snapshotId]);

  const saveFromDecision = useCallback((decisionId: string): void => {
    const sessionToken = tokenRef.current;
    const current = snapshotRef.current;
    if (sessionToken === null) {
      setMessage('세션이 없어 규칙을 저장할 수 없습니다.');
      return;
    }
    if (!current) {
      setMessage('먼저 작업을 고르세요. 규칙은 현재 작업의 허용 결정에서만 저장합니다.');
      return;
    }
    if (actionRef.current !== null) return;
    actionRef.current = 'save';
    setBusyKey('save');
    setMessage('선택한 결정에서 규칙을 저장하는 중입니다…');
    void (async (): Promise<void> => {
      try {
        const result = await saveRule(fetchRef.current, sessionToken, {
          taskId: current.id,
          expectedRevision: current.revision,
          decisionId,
        });
        if (!aliveRef.current || tokenRef.current !== sessionToken) return;
        if (!result.ok) {
          setMessage(`규칙을 저장하지 않았습니다. ${workflowFailureMessage(result.failure)}`);
          if (result.failure.kind === 'conflict') {
            await refreshTask(current.id);
            void loadRules(sessionToken);
          }
          return;
        }
        setMessage(`규칙 ${result.value.id} 판본 ${result.value.version}을 저장했습니다. 다른 작업에는 자동 적용되지 않고 명시 적용할 때만 쓰입니다.`);
        await loadRules(sessionToken);
      } finally {
        if (aliveRef.current && actionRef.current === 'save') {
          actionRef.current = null;
          setBusyKey(null);
        }
      }
    })();
  }, [loadRules, refreshTask]);

  const createVersion = useCallback((ruleId: string, expectedVersion: number, draft: RuleVersionDraft): void => {
    const sessionToken = tokenRef.current;
    if (sessionToken === null) {
      setMessage('세션이 없어 규칙 판본을 만들 수 없습니다.');
      return;
    }
    if (actionRef.current !== null) return;
    let representation: Representation;
    try {
      representation = buildRuleRepresentation(draft);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '표현 변환 값을 확인하세요.');
      return;
    }
    let expiresAt: string | null = null;
    if (draft.expiresAt !== null && draft.expiresAt.trim() !== '') {
      const at = Date.parse(draft.expiresAt);
      if (!Number.isFinite(at)) {
        setMessage('만료 시각 형식이 올바르지 않습니다. 비우면 만료되지 않습니다.');
        return;
      }
      if (at <= Date.now()) {
        setMessage('만료 시각은 지금보다 뒤여야 합니다. 비우면 만료되지 않습니다.');
        return;
      }
      expiresAt = new Date(at).toISOString();
    }
    actionRef.current = 'version';
    setBusyKey('version');
    setMessage(`규칙 ${ruleId}의 새 판본을 만드는 중입니다.`);
    void (async (): Promise<void> => {
      try {
        const result = await createRuleVersion(fetchRef.current, sessionToken, ruleId, expectedVersion, representation, expiresAt);
        if (!aliveRef.current || tokenRef.current !== sessionToken) return;
        if (!result.ok) {
          setMessage(`규칙 판본을 만들지 않았습니다. ${workflowFailureMessage(result.failure)}`);
          if (result.failure.kind === 'conflict') await loadRules(sessionToken);
          return;
        }
        setMessage(`규칙 ${result.value.id} 판본 ${result.value.version}을 만들었습니다. 과거 판본은 새 적용에 쓰이지 않습니다.`);
        await loadRules(sessionToken);
      } finally {
        if (aliveRef.current && actionRef.current === 'version') {
          actionRef.current = null;
          setBusyKey(null);
        }
      }
    })();
  }, [loadRules]);

  const revoke = useCallback((ruleId: string, expectedVersion: number): void => {
    const sessionToken = tokenRef.current;
    if (sessionToken === null) {
      setMessage('세션이 없어 규칙을 철회할 수 없습니다.');
      return;
    }
    if (actionRef.current !== null) return;
    actionRef.current = 'revoke';
    setBusyKey('revoke');
    setMessage(`규칙 ${ruleId}의 전 판본을 철회하는 중입니다.`);
    void (async (): Promise<void> => {
      try {
        const result = await revokeRule(fetchRef.current, sessionToken, ruleId, expectedVersion);
        if (!aliveRef.current || tokenRef.current !== sessionToken) return;
        if (!result.ok) {
          setMessage(`규칙을 철회하지 않았습니다. ${workflowFailureMessage(result.failure)}`);
          if (result.failure.kind === 'conflict') await loadRules(sessionToken);
          return;
        }
        const affected = result.value.affectedTasks;
        setMessage(affected.length === 0
          ? `규칙 ${ruleId}의 전 판본을 철회했습니다. 영향을 받는 작업은 없습니다.`
          : `규칙 ${ruleId}의 전 판본을 철회했습니다. 작업 ${affected.length}개의 판본이 올라갔습니다: ${affected.join(', ')}.`);
        const current = snapshotRef.current;
        if (current && affected.includes(current.id)) await refreshTask(current.id);
        await loadRules(sessionToken);
      } finally {
        if (aliveRef.current && actionRef.current === 'revoke') {
          actionRef.current = null;
          setBusyKey(null);
        }
      }
    })();
  }, [loadRules, refreshTask]);

  const apply = useCallback((refs: readonly RuleRef[]): void => {
    const sessionToken = tokenRef.current;
    const current = snapshotRef.current;
    if (sessionToken === null) {
      setMessage('세션이 없어 규칙을 적용할 수 없습니다.');
      return;
    }
    if (!current) {
      setMessage('먼저 작업을 선택하세요. 규칙 적용은 선택한 현재 작업 판본으로만 요청합니다.');
      return;
    }
    if (refs.length === 0) {
      setMessage('적용할 규칙을 하나 이상 선택하세요.');
      return;
    }
    if (actionRef.current !== null) return;
    actionRef.current = 'apply';
    setBusyKey('apply');
    setMessage(`규칙 ${refs.length}개를 작업 ${current.id}에 적용하는 중입니다. 서버는 전체 성공 또는 전체 거부만 합니다.`);
    void (async (): Promise<void> => {
      try {
        const result = await applyRules(fetchRef.current, sessionToken, current.id, current.revision, refs);
        if (!aliveRef.current || tokenRef.current !== sessionToken) return;
        if (!result.ok) {
          setMessage(`규칙을 적용하지 않았습니다. ${workflowFailureMessage(result.failure)}`);
          if (result.failure.kind === 'conflict') {
            await refreshTask(current.id);
            void loadRules(sessionToken);
          }
          return;
        }
        setMessage(`규칙 ${refs.length}개를 적용했습니다. 후보·결정을 서버에서 다시 조회합니다.`);
        await refreshTask(current.id);
      } finally {
        if (aliveRef.current && actionRef.current === 'apply') {
          actionRef.current = null;
          setBusyKey(null);
        }
      }
    })();
  }, [loadRules, refreshTask]);

  return {
    rules,
    rulesStatus,
    rulesBusy,
    taskDetail,
    taskStatus,
    busyKey,
    message,
    refresh,
    saveFromDecision,
    createVersion,
    revoke,
    apply,
  };
}
