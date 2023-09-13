import { createContext, useContext } from 'react';

export const ZIndexContext = createContext(0);

export function useZIndex() {
  const zIndex = useContext(ZIndexContext);
  return zIndex;
}
