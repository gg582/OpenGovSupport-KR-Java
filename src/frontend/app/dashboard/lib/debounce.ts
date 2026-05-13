/**
 * 지정한 ms 동안 추가 호출이 없을 때만 fn 을 실행하는 디바운스 래퍼.
 * React 의 useMemo + useEffect cleanup 과 함께 쓰인다.
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  ms: number,
): {
  (...args: Parameters<T>): void;
  cancel(): void;
  flush(): void;
} {
  let t: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const d = (...args: Parameters<T>) => {
    lastArgs = args;
    if (t !== null) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn.apply(null, lastArgs!);
      lastArgs = null;
    }, ms);
  };

  d.cancel = () => {
    if (t !== null) {
      clearTimeout(t);
      t = null;
    }
    lastArgs = null;
  };

  d.flush = () => {
    if (t !== null) {
      clearTimeout(t);
      t = null;
      if (lastArgs) {
        fn.apply(null, lastArgs);
        lastArgs = null;
      }
    }
  };

  return d;
}
