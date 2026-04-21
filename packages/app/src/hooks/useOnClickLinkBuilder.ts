import { useMemo } from 'react';
import { renderOnClickSearch } from '@hyperdx/common-utils/dist/core/linkUrlBuilder';
import { OnClick, SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';

import { useSources } from '@/source';

function isLogOrTraceSource(source: TSource): boolean {
  return source.kind === SourceKind.Log || source.kind === SourceKind.Trace;
}

/**
 * Returns a function that, given some row data, produces a URL for the
 * configured onClick action. Errors (unresolved names, malformed templates,
 * unknown sources) surface as Mantine toast notifications; the function
 * returns null in error cases.
 */
export function useOnClickLinkBuilder({
  onClick,
  dateRange,
}: {
  onClick: OnClick | undefined;
  dateRange: [Date, Date];
}): ((row: Record<string, unknown>) => string | null) | null {
  const { data: sources } = useSources();

  const sourceIdsByName = useMemo(
    () =>
      new Map(
        sources?.filter(isLogOrTraceSource).map(s => [s.name, s.id]) ?? [],
      ),
    [sources],
  );

  return useMemo(() => {
    if (!onClick) return null;

    return (row: Record<string, unknown>) => {
      const showError = (message: string) => {
        notifications.show({
          id: message,
          color: 'red',
          title: 'Link error',
          message,
        });
      };

      const renderResult = renderOnClickSearch({
        onClick,
        row,
        sourceIdsByName,
        dateRange,
      });

      if (!renderResult.ok) {
        showError(renderResult.error);
        return null;
      }

      return renderResult.url;
    };
  }, [onClick, sourceIdsByName, dateRange]);
}
