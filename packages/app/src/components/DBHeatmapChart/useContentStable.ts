import { useState } from 'react';
import { isEqual } from 'lodash';

/**
 * `value`, keeping the previous reference while its content is unchanged, so
 * a caller that rebuilds equal objects every render doesn't invalidate memos.
 */
export function useContentStable<T>(value: T): T {
  const [stable, setStable] = useState(value);
  const isSame = isEqual(stable, value);
  if (!isSame) setStable(value);
  return isSame ? stable : value;
}
