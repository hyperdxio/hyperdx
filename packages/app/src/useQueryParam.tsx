import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useRouter } from 'next/router';

import { usePrevious } from './utils';

type QueryParamContextType = Record<string, any> & {
  setState: (state: any) => void;
};

const QueryParamContext = createContext<QueryParamContextType>({
  setState: _ => {},
});

export const QueryParamProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const router = useRouter();

  const prevRouterQuery = usePrevious(router.query);

  const setState = useCallback(
    (state: Record<string, any>) => {
      // eslint-disable-next-line react-hooks/immutability
      setCache(oldCache => {
        const newCache = {
          ...oldCache,
          ...state,
        };
        const { setState: _, ...newQuery } = newCache;

        router.push({
          query: newQuery,
        });

        return newCache;
      });
    },
    [router],
  );

  const initState: QueryParamContextType = {
    setState,
  };

  const [cache, setCache] = useState(initState);

  // Update cache if query param changes
  useEffect(() => {
    if (router.isReady && prevRouterQuery != router.query) {
      setCache(oldCache => ({ ...oldCache, ...router.query }));
    }
  }, [setState, router.isReady, router.query, cache, prevRouterQuery]);

  return (
    <QueryParamContext.Provider value={cache}>
      {children}
    </QueryParamContext.Provider>
  );
};
