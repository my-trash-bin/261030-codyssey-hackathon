import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

// Node 테스트 파일마다 별도 프로세스에서 실행된다. File·fetch·crypto는 Node 구현을 유지한다.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import('react-dom/client');
// React DOM은 import 시 DOM 가용 여부를 저장하므로 테스트 DOM 등록 뒤에 로드한다.

export interface HookResult<T> {
  result: { readonly current: T };
  unmount: () => Promise<void>;
}

/** 실제 React root에서 훅을 실행한다. 명령 호출은 React act 안에서 수행한다. */
export async function renderHook<T>(useHook: () => T): Promise<HookResult<T>> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let current!: T;
  function Probe(): null {
    current = useHook();
    return null;
  }
  try {
    await act(async () => { root.render(createElement(Probe)); });
  } catch (error) {
    await act(async () => { root.unmount(); });
    container.remove();
    throw error;
  }
  return {
    result: { get current(): T { return current; } },
    unmount: async (): Promise<void> => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}
