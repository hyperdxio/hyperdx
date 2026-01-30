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

export function useQueryParam<T>(
  key: string,
  defaultValue: T,
  options: {
    queryParamConfig: {
      encode: (
        value: T | undefined,
      ) => string | (string | null)[] | null | undefined;
      decode: (
        input: string | (string | null)[] | null | undefined,
      ) => T | undefined;
    };
  } = {
    queryParamConfig: {
      encode: (value: T | undefined) => JSON.stringify(value),
      decode: (input: string | (string | null)[] | null | undefined) =>
        Array.isArray(input)
          ? input.map(i => (i != null ? JSON.parse(i) : undefined))
          : input != null
            ? JSON.parse(input)
            : undefined,
    },
  },
): [T, (value: T) => void] {
  const qParamContext = useContext(QueryParamContext);

  const setValue = (value: T) => {
    qParamContext.setState({ [key]: options.queryParamConfig.encode(value) });
  };

  const value =
    options.queryParamConfig.decode(qParamContext[key]) ?? defaultValue;

  return [value, setValue];
}
