import { useCallback, useLayoutEffect, useRef } from 'react';

export const useStableCallback = <T extends (...args: any[]) => any>(
  callback: T,
) => {
  const callbackRef = useRef<T>(callback);

  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  return useCallback(
    // eslint-disable-next-line react-hooks/use-memo, @typescript-eslint/no-unsafe-type-assertion
    ((...args: Parameters<T>) => callbackRef.current(...args)) as T,
    [],
  );
};
