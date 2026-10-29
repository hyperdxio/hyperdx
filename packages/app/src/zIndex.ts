import { createContext, use } from 'react';

export const ZIndexContext = createContext(0);

export function useZIndex() {
  const zIndex = use(ZIndexContext);
  return zIndex;
}
