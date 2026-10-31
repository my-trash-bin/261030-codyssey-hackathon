// 후보 카드가 사라질 때 초점이 사라지지 않도록 대체 초점을 잡는다.
// 이전 화면의 restoreFocus 동작을 옮긴 것이다. 클릭 핸들러가 key.current에
// 'disposition:<후보 id>:exclude' 같은 초점 키를 남기면, 렌더·레이아웃이 끝난 뒤
// 같은 data-focus-key 요소를 찾아 초점을 옮기고 키를 지운다.

import { useLayoutEffect } from 'react';
import type { MutableRefObject, RefObject } from 'react';

export function useFocusFallback(
  container: RefObject<HTMLElement | null>,
  key: MutableRefObject<string | null>,
): void {
  useLayoutEffect(() => {
    const pending = key.current;
    if (pending === null) return;
    const root = container.current;
    if (!root) return;
    key.current = null;
    const target = root.querySelector(`[data-focus-key="${CSS.escape(pending)}"]`);
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  });
}
