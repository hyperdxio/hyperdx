import { useMemo } from 'react';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import {
  IconChartLine,
  IconConnection,
  IconDeviceLaptop,
  IconLogs,
} from '@tabler/icons-react';

export const SOURCE_KIND_ICONS: Record<string, React.ReactNode> = {
  [SourceKind.Log]: <IconLogs size={16} />,
  [SourceKind.Trace]: <IconConnection size={16} />,
  [SourceKind.Session]: <IconDeviceLaptop size={16} />,
  [SourceKind.Metric]: <IconChartLine size={16} />,
};

export function useSourceKindMap(sources: TSource[] | undefined) {
  return useMemo(() => {
    const map = new Map<string, SourceKind>();
    sources?.forEach(s => map.set(s.id, s.kind));
    return map;
  }, [sources]);
}

export function useFilteredSortedSourceItems({
  sources,
  allowedSourceKinds,
  connectionId,
}: {
  sources: TSource[] | undefined;
  allowedSourceKinds?: SourceKind[];
  connectionId?: string;
}) {
  return useMemo(
    () =>
      (
        sources
          ?.filter(
            source =>
              (!allowedSourceKinds ||
                allowedSourceKinds.includes(source.kind)) &&
              (!connectionId || source.connection === connectionId) &&
              !source.disabled,
          )
          .map(s => ({ value: s.id, label: s.name })) ?? []
      ).sort((a, b) => a.label.localeCompare(b.label)),
    [sources, allowedSourceKinds, connectionId],
  );
}
