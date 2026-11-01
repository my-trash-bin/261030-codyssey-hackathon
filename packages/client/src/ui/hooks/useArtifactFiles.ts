import { useCallback } from 'react';
import { artifactFailureMessage, readArtifactFile, readExportBytes, saveDownload, sha256Hex } from '../../artifacts-client.ts';
import type { ArtifactFileMeta, HumanReviewChecklist } from '../../artifacts-client.ts';
import { downloadReason } from './artifacts-hook-model.ts';
import type { State } from './artifacts-hook-model.ts';
interface Options { aliveRef: { current: boolean }; taskIdRef: { current: string | null }; stateRef: { current: State };
 commit: (patch: Partial<State>) => void; fetchFn: typeof fetch; notify: (taskId: string) => Promise<void>; refresh: (taskId: string) => Promise<boolean>; }
export function useArtifactFiles({ aliveRef, commit, fetchFn, notify, refresh, stateRef, taskIdRef }: Options) {
  const openFile = useCallback((path: string): void => {
    const current = stateRef.current;
    const artifact = current.artifact;
    if (artifact === null) return;
    const meta: ArtifactFileMeta | undefined = artifact.files.find((file) => file.path === path);
    if (meta === undefined) {
      commit({ message: `파일 목록에 ${path}가 없습니다.` });
      return;
    }
    void (async (): Promise<void> => {
      commit({ fileBusy: true, message: `${path} 내용을 읽는 중입니다…` });
      const result = await readArtifactFile(fetchFn, artifact.id, path);
      if (!aliveRef.current || taskIdRef.current !== artifact.taskId) return;
      if (!result.ok) {
        commit({ fileBusy: false, message: `${path}를 읽지 못했습니다. ${artifactFailureMessage(result.failure)}` });
        return;
      }
      const digest = await sha256Hex(result.value.bytes);
      if (!aliveRef.current || taskIdRef.current !== artifact.taskId) return;
      if (digest !== null && digest !== meta.sha256) {
        commit({ fileBusy: false, message: `${path} 내용이 파일 목록의 해시와 달라 표시하지 않았습니다.` });
        return;
      }
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(result.value.bytes);
      } catch {
        commit({ fileBusy: false, message: `${path}는 UTF-8 텍스트가 아니어서 화면에 표시하지 않습니다.` });
        return;
      }
      commit({ fileBusy: false, file: { path, text }, message: `${path} 내용을 표시합니다.` });
    })();
  }, [commit, fetchFn]);

  const closeFile = useCallback((): void => {
    commit({ file: null });
  }, [commit]);

  const download = useCallback((path: string | null): void => {
    const current = stateRef.current;
    const exportInfo = current.exportInfo;
    const reason = downloadReason(current);
    if (reason !== '') {
      commit({ message: reason });
      return;
    }
    if (exportInfo === null) return;
    const label = path === null ? 'archive' : path;
    void (async (): Promise<void> => {
      commit({ downloadBusy: label, message: `${path === null ? '확정 ZIP' : path}을 내려받는 중입니다…` });
      const result = await readExportBytes(fetchFn, exportInfo.id, path);
      if (!aliveRef.current) return;
      if (!result.ok) {
        commit({ downloadBusy: null, message: `내보내기를 내려받지 못했습니다. ${artifactFailureMessage(result.failure)}` });
        const invalidated = result.failure.kind === 'conflict' || result.failure.code === 'EXPORT_INVALIDATED';
        if (invalidated) {
          commit({ exportInfo: null });
          const taskId = stateRef.current.taskId;
          if (taskId !== null) {
            await refresh(taskId);
            await notify(taskId);
          }
        }
        return;
      }
      const saved = saveDownload(result.value);
      commit({
        downloadBusy: null,
        message: saved
          ? `${result.value.filename}을(를) 내려받기 시작했습니다.`
          : '브라우저가 파일 저장을 시작하지 못했습니다. 다운로드가 성공한 것으로 표시하지 않습니다.',
      });
    })();
  }, [commit, fetchFn, notify, refresh]);

  const downloadArchive = useCallback((): void => {
    download(null);
  }, [download]);

  const downloadFile = useCallback((path: string): void => {
    download(path);
  }, [download]);

  const reload = useCallback((): void => {
    const taskId = stateRef.current.taskId;
    if (taskId === null) return;
    void (async (): Promise<void> => {
      commit({ busy: true, message: '작업 정보를 다시 불러오는 중입니다…' });
      const loaded = await refresh(taskId);
      if (!aliveRef.current) return;
      if (loaded) commit({ message: '작업 정보를 서버 판본으로 다시 불러왔습니다.' });
      await notify(taskId);
    })();
  }, [commit, notify, refresh]);

  const setChecklist = useCallback((next: HumanReviewChecklist): void => {
    commit({ checklist: next });
  }, [commit]);

  const setFallbackReason = useCallback((text: string): void => {
    commit({ fallbackReason: text });
  }, [commit]);

  return { openFile, closeFile, downloadArchive, downloadFile, reload, setChecklist, setFallbackReason };
}
