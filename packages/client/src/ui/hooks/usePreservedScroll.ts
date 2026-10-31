// 미리보기 표의 가로 스크롤 위치를 유지한다.
// 표를 다시 그리면 스크롤이 0으로 돌아가므로, 스크롤 위치를 ref에 남기고
// 내용 키(미리보기 id)가 바뀐 뒤 다시 넣는다.

import { useLayoutEffect, useRef } from 'react';
import type { RefObject, UIEvent } from 'react';

export function usePreservedScroll(contentKey: string): {
  ref: RefObject<HTMLDivElement | null>;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const scrollLeft = useRef(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (node) node.scrollLeft = scrollLeft.current;
  }, [contentKey]);

  return {
    ref,
    onScroll: (event: UIEvent<HTMLDivElement>): void => {
      scrollLeft.current = event.currentTarget.scrollLeft;
    },
  };
}
