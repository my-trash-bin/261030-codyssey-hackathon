// 작업 이력과 실행 정보. 선택한 작업의 events를 시간순으로 읽고,
// duration_ms/usage처럼 서버가 측정하지 않은 값은 null 그대로 두어 화면이 수치를 추측하지 않게 한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../disclosure-state.ts';
import { listTaskEvents, readRuntime } from '../../task-browser-client.ts';
import type { TaskEvent, WorkflowRuntime } from '../../task-browser-client.ts';
import { workflowFailureMessage } from '../../workflow-client.ts';

export interface UseTaskHistoryOptions {
  csrfToken: string | null;
  snapshot: Snapshot | null;
  fetch?: typeof fetch;
}

export interface TaskHistoryApi {
  events: TaskEvent[];
  eventsStatus: string;
  eventsBusy: boolean;
  eventsMore: boolean;
  runtime: WorkflowRuntime | null;
  runtimeStatus: string;
  runtimeBusy: boolean;
  refreshEvents: () => void;
  loadMoreEvents: () => void;
  refreshRuntime: () => void;
}

// 서버는 이력 요청마다 최대 100개를 시간순으로 돌려준다. 한 번의 요청으로 더 받을 수 있는지 판단한다.
const EVENT_PAGE_SIZE = 100;

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function useTaskHistory(options: UseTaskHistoryOptions): TaskHistoryApi {
  const token = options.csrfToken;
  const snapshot = options.snapshot;
  const snapshotId = snapshot?.id ?? null;
  const snapshotRevision = snapshot?.revision ?? 0;

  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [eventsStatus, setEventsStatus] = useState('작업을 선택하면 이력을 조회합니다.');
  const [eventsBusy, setEventsBusy] = useState(false);
  const [eventsMore, setEventsMore] = useState(false);
  const [runtime, setRuntime] = useState<WorkflowRuntime | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState('세션을 열면 실행 정보를 조회합니다.');
  const [runtimeBusy, setRuntimeBusy] = useState(false);

  const aliveRef = useRef(true);
  const tokenRef = useRef<string | null>(token);
  const snapshotRef = useRef<Snapshot | null>(snapshot);
  const fetchRef = useRef<typeof fetch>(options.fetch ?? defaultFetch);
  tokenRef.current = token;
  snapshotRef.current = snapshot;
  fetchRef.current = options.fetch ?? defaultFetch;

  const eventsSeqRef = useRef(0);
  const runtimeSeqRef = useRef(0);
  const eventCursorRef = useRef(0);
  const eventsBusyRef = useRef(false);
  eventsBusyRef.current = eventsBusy;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      eventsSeqRef.current += 1;
      runtimeSeqRef.current += 1;
    };
  }, []);

  const loadRuntime = useCallback(async (sessionToken: string): Promise<void> => {
    const owner = ++runtimeSeqRef.current;
    setRuntimeBusy(true);
    setRuntimeStatus('실행 정보를 조회하는 중입니다.');
    const result = await readRuntime(fetchRef.current);
    if (!aliveRef.current || owner !== runtimeSeqRef.current || tokenRef.current !== sessionToken) return;
    setRuntimeBusy(false);
    if (!result.ok) {
      setRuntime(null);
      setRuntimeStatus(`실행 정보를 확인하지 못했습니다. ${workflowFailureMessage(result.failure)}`);
      return;
    }
    setRuntime(result.value);
    setRuntimeStatus('실행 정보는 서버 설정 값입니다. 모델 호출 성공이나 승인 완료를 뜻하지 않습니다.');
  }, []);

  const loadEvents = useCallback(async (sessionToken: string, taskId: string): Promise<void> => {
    const owner = ++eventsSeqRef.current;
    eventsBusyRef.current = true;
    setEventsBusy(true);
    setEventsStatus('작업 이력을 불러오는 중입니다.');
    const result = await listTaskEvents(fetchRef.current, taskId, 0);
    if (!aliveRef.current || owner !== eventsSeqRef.current || tokenRef.current !== sessionToken || snapshotRef.current?.id !== taskId) return;
    eventsBusyRef.current = false;
    setEventsBusy(false);
    if (!result.ok) {
      setEvents([]);
      setEventsMore(false);
      setEventsStatus(`작업 이력을 불러오지 못했습니다. ${workflowFailureMessage(result.failure)}`);
      return;
    }
    setEvents(result.value);
    eventCursorRef.current = result.value.at(-1)?.seq ?? 0;
    setEventsMore(result.value.length === EVENT_PAGE_SIZE);
    setEventsStatus(result.value.length === 0
      ? '이 작업에는 아직 이력이 없습니다.'
      : `이력 ${result.value.length}개를 시간순으로 불러왔습니다.`);
  }, []);

  useEffect(() => {
    if (token === null) {
      runtimeSeqRef.current += 1;
      setRuntime(null);
      setRuntimeBusy(false);
      setRuntimeStatus('세션이 없어 실행 정보를 조회하지 않습니다.');
      return;
    }
    void loadRuntime(token);
  }, [token, loadRuntime]);

  useEffect(() => {
    if (token === null) {
      eventsSeqRef.current += 1;
      setEvents([]);
      setEventsBusy(false);
      setEventsMore(false);
      setEventsStatus('세션이 없어 작업 이력을 조회하지 않습니다.');
      return;
    }
    if (snapshotId === null) {
      eventsSeqRef.current += 1;
      setEvents([]);
      setEventsBusy(false);
      setEventsMore(false);
      setEventsStatus('선택한 작업이 없습니다. 작업 목록에서 작업을 선택하면 이력을 조회합니다.');
      return;
    }
    void loadEvents(token, snapshotId);
  }, [token, snapshotId, snapshotRevision, loadEvents]);

  const refreshEvents = useCallback((): void => {
    const sessionToken = tokenRef.current;
    const current = snapshotRef.current;
    if (sessionToken === null) {
      setEventsStatus('세션이 없어 작업 이력을 조회하지 않습니다.');
      return;
    }
    if (!current) {
      setEventsStatus('선택한 작업이 없습니다. 작업 목록에서 작업을 선택하세요.');
      return;
    }
    void loadEvents(sessionToken, current.id);
  }, [loadEvents]);

  const loadMoreEvents = useCallback((): void => {
    const sessionToken = tokenRef.current;
    const current = snapshotRef.current;
    if (sessionToken === null || !current || eventsBusyRef.current) return;
    const owner = eventsSeqRef.current;
    const after = eventCursorRef.current;
    eventsBusyRef.current = true;
    setEventsBusy(true);
    void (async (): Promise<void> => {
      const result = await listTaskEvents(fetchRef.current, current.id, after);
      if (!aliveRef.current || owner !== eventsSeqRef.current || tokenRef.current !== sessionToken || snapshotRef.current?.id !== current.id) return;
      eventsBusyRef.current = false;
      setEventsBusy(false);
      if (!result.ok) {
        setEventsStatus(`다음 이력을 불러오지 못했습니다. ${workflowFailureMessage(result.failure)}`);
        return;
      }
      setEvents(previous => {
        const seen = new Set(previous.map(event => event.seq));
        return [...previous, ...result.value.filter(event => !seen.has(event.seq))];
      });
      eventCursorRef.current = result.value.at(-1)?.seq ?? after;
      setEventsMore(result.value.length === EVENT_PAGE_SIZE);
      setEventsStatus(result.value.length === EVENT_PAGE_SIZE
        ? '이력을 추가로 불러왔습니다. 서버 한도에 따라 더 있을 수 있습니다.'
        : '마지막 이력까지 불러왔습니다.');
    })();
  }, []);

  const refreshRuntime = useCallback((): void => {
    const sessionToken = tokenRef.current;
    if (sessionToken === null) {
      setRuntimeStatus('세션이 없어 실행 정보를 조회하지 않습니다.');
      return;
    }
    void loadRuntime(sessionToken);
  }, [loadRuntime]);

  return {
    events,
    eventsStatus,
    eventsBusy,
    eventsMore,
    runtime,
    runtimeStatus,
    runtimeBusy,
    refreshEvents,
    loadMoreEvents,
    refreshRuntime,
  };
}
