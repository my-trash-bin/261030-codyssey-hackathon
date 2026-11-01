// 작업 목록 화면의 상태와 요청 수명. 목록은 세션이 있을 때만 읽고,
// 작업 판본이 바뀌면 첫 페이지를 다시 조회해 phase·revision·이력을 최신으로 맞춘다.
// 삭제는 화면에서 명시 확인을 받은 뒤에만 서버로 보내며 자동 삭제하지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../disclosure-state.ts';
import { deleteTask, listTasks } from '../../task-browser-client.ts';
import type { TaskSummary } from '../../task-browser-client.ts';
import { workflowFailureMessage } from '../../workflow-client.ts';

export interface UseTaskBrowserOptions {
  csrfToken: string | null;
  snapshot: Snapshot | null;
  onTaskChanged: (id: string) => Promise<void> | void;
  /** 삭제가 끝난 뒤 메인 작업 공간의 snapshot을 비우는 선택 콜백. 없으면 안내 문구만 남긴다. */
  onTaskDeleted?: () => void;
  fetch?: typeof fetch;
}

export interface TaskBrowserApi {
  tasks: TaskSummary[];
  nextCursor: string | null;
  listBusy: boolean;
  listStatus: string;
  busyKey: string | null;
  message: string;
  selectedId: string | null;
  reload: () => void;
  loadMore: () => void;
  select: (id: string) => void;
  deleteSelected: () => void;
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function useTaskBrowser(options: UseTaskBrowserOptions): TaskBrowserApi {
  const token = options.csrfToken;
  const snapshot = options.snapshot;
  const snapshotId = snapshot?.id ?? null;
  const snapshotRevision = snapshot?.revision ?? 0;

  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [listStatus, setListStatus] = useState('세션을 열면 작업 목록을 조회합니다.');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const aliveRef = useRef(true);
  const tokenRef = useRef<string | null>(token);
  const snapshotRef = useRef<Snapshot | null>(snapshot);
  const fetchRef = useRef<typeof fetch>(options.fetch ?? defaultFetch);
  const onTaskChangedRef = useRef(options.onTaskChanged);
  const onTaskDeletedRef = useRef(options.onTaskDeleted);
  tokenRef.current = token;
  snapshotRef.current = snapshot;
  fetchRef.current = options.fetch ?? defaultFetch;
  onTaskChangedRef.current = options.onTaskChanged;
  onTaskDeletedRef.current = options.onTaskDeleted;

  const listSeqRef = useRef(0);
  const loadedRef = useRef(false);
  const listBusyRef = useRef(false);
  const nextCursorRef = useRef<string | null>(null);
  const actionRef = useRef<string | null>(null);
  listBusyRef.current = listBusy;
  nextCursorRef.current = nextCursor;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      listSeqRef.current += 1;
      actionRef.current = null;
    };
  }, []);

  const loadFirst = useCallback(async (sessionToken: string): Promise<void> => {
    const owner = ++listSeqRef.current;
    listBusyRef.current = true;
    setListBusy(true);
    if (!loadedRef.current) setListStatus('작업 목록을 불러오는 중입니다.');
    const result = await listTasks(fetchRef.current, null);
    if (!aliveRef.current || owner !== listSeqRef.current || tokenRef.current !== sessionToken) return;
    listBusyRef.current = false;
    setListBusy(false);
    if (!result.ok) {
      setListStatus(workflowFailureMessage(result.failure));
      return;
    }
    loadedRef.current = true;
    setTasks(result.value.tasks);
    setNextCursor(result.value.nextCursor);
    setListStatus(result.value.tasks.length === 0
      ? '작업이 없습니다. 작업 만들기에서 작업을 등록하면 이 목록에 나타납니다.'
      : `작업 ${result.value.tasks.length}개를 최근 수정순으로 불러왔습니다. 다음 페이지가 있으면 이어 조회할 수 있습니다.`);
  }, []);

  const loadMore = useCallback((): void => {
    const sessionToken = tokenRef.current;
    const cursor = nextCursorRef.current;
    if (sessionToken === null || cursor === null || listBusyRef.current) return;
    const owner = listSeqRef.current;
    listBusyRef.current = true;
    setListBusy(true);
    void (async (): Promise<void> => {
      const result = await listTasks(fetchRef.current, cursor);
      if (!aliveRef.current || owner !== listSeqRef.current || tokenRef.current !== sessionToken) return;
      listBusyRef.current = false;
      setListBusy(false);
      if (!result.ok) {
        setListStatus(`다음 페이지를 불러오지 못했습니다. ${workflowFailureMessage(result.failure)}`);
        return;
      }
      setTasks(previous => {
        const seen = new Set(previous.map(task => task.id));
        return [...previous, ...result.value.tasks.filter(task => !seen.has(task.id))];
      });
      setNextCursor(result.value.nextCursor);
      setListStatus(result.value.nextCursor === null
        ? '마지막 페이지까지 불러왔습니다.'
        : '다음 페이지를 이어 불러왔습니다.');
    })();
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
      listSeqRef.current += 1;
      loadedRef.current = false;
      setTasks([]);
      setNextCursor(null);
      listBusyRef.current = false;
      setListBusy(false);
      setListStatus('세션이 없어 작업 목록을 조회하지 않습니다.');
      return;
    }
    // 작업 선택이나 판본 변경(원자료·결정)마다 첫 페이지를 다시 읽어 phase를 최신으로 맞춘다.
    void loadFirst(token);
  }, [token, snapshotId, snapshotRevision, loadFirst]);

  const reload = useCallback((): void => {
    const sessionToken = tokenRef.current;
    if (sessionToken === null) {
      setListStatus('세션이 없어 작업 목록을 조회하지 않습니다.');
      return;
    }
    void loadFirst(sessionToken);
  }, [loadFirst]);

  const select = useCallback((id: string): void => {
    if (actionRef.current !== null) return;
    if (snapshotRef.current?.id === id) {
      setMessage(`작업 ${id}은(는) 이미 선택되어 있습니다.`);
      return;
    }
    actionRef.current = 'select';
    setBusyKey('select');
    setMessage(`작업 ${id}을(를) 선택하는 중입니다.`);
    void (async (): Promise<void> => {
      try {
        await onTaskChangedRef.current(id);
        if (!aliveRef.current) return;
        setMessage(`작업 ${id}을(를) 선택했습니다. 각 기능이 이 작업 판본을 기준으로 다시 조회됩니다.`);
      } catch {
        if (!aliveRef.current) return;
        setMessage('선택한 작업을 불러오지 못했습니다. 작업이 삭제되었는지 확인한 뒤 목록을 새로 고치세요.');
      } finally {
        if (aliveRef.current && actionRef.current === 'select') {
          actionRef.current = null;
          setBusyKey(null);
        }
      }
    })();
  }, []);

  const deleteSelected = useCallback((): void => {
    const sessionToken = tokenRef.current;
    const current = snapshotRef.current;
    if (sessionToken === null) {
      setMessage('세션이 없어 작업을 삭제할 수 없습니다.');
      return;
    }
    if (!current) {
      setMessage('삭제할 작업을 먼저 선택하세요. 목록의 작업을 선택하면 삭제 확인을 입력할 수 있습니다.');
      return;
    }
    if (actionRef.current !== null) return;
    actionRef.current = 'delete';
    setBusyKey('delete');
    setMessage('작업 삭제를 요청했습니다. 실행 중인 작업이 끝날 때까지 기다립니다.');
    void (async (): Promise<void> => {
      try {
        const result = await deleteTask(fetchRef.current, sessionToken, current.id, current.revision);
        if (!aliveRef.current || tokenRef.current !== sessionToken) return;
        if (!result.ok) {
          setMessage(`작업을 삭제하지 않았습니다. ${workflowFailureMessage(result.failure)}`);
          if (result.failure.kind === 'conflict') await refreshTask(current.id);
          return;
        }
        setMessage(`작업 ${result.value.id}을(를) 삭제했습니다. 저장된 재사용 규칙은 남습니다. 화면에 남은 이 작업 정보는 서버에서 더 이상 조회되지 않으므로 다른 작업을 선택하세요.`);
        await loadFirst(sessionToken);
        try {
          onTaskDeletedRef.current?.();
        } catch {
          setMessage(`작업 ${result.value.id}을(를) 삭제했지만 화면 선택을 비우지 못했습니다. 다른 작업을 선택하세요.`);
        }
      } finally {
        if (aliveRef.current && actionRef.current === 'delete') {
          actionRef.current = null;
          setBusyKey(null);
        }
      }
    })();
  }, [loadFirst, refreshTask]);

  return {
    tasks,
    nextCursor,
    listBusy,
    listStatus,
    busyKey,
    message,
    selectedId: snapshotId,
    reload,
    loadMore,
    select,
    deleteSelected,
  };
}
