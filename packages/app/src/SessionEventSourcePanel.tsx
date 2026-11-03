import { ComponentProps, use, useEffect } from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Loader } from '@mantine/core';

import {
  DBRowSidePanelInner,
  RowSidePanelContext,
} from '@/components/DBRowSidePanel';
import { useSource } from '@/source';

type EventPanelProps = ComponentProps<typeof DBRowSidePanelInner>;

/**
 * The session drawer's event view. A browser log event opens on its log
 * source; everything else on the trace source passed in `source`.
 */
export default function SessionEventSourcePanel({
  sourceId,
  ...props
}: EventPanelProps & { sourceId?: string }) {
  return sourceId ? (
    <LogSourceEventPanel {...props} sourceId={sourceId} />
  ) : (
    <DBRowSidePanelInner {...props} />
  );
}

function LogSourceEventPanel({
  sourceId,
  ...props
}: EventPanelProps & { sourceId: string }) {
  const { data: source, isLoading } = useSource({
    id: sourceId,
    kinds: [SourceKind.Log],
  });
  const context = use(RowSidePanelContext);
  const { onNavigateToParent } = props;
  const isMissing = !isLoading && source == null;

  // A link to a deleted source falls back to the session.
  useEffect(() => {
    if (isMissing) {
      onNavigateToParent?.();
    }
  }, [isMissing, onNavigateToParent]);

  if (source == null) {
    return <Loader />;
  }
  return (
    <RowSidePanelContext value={{ ...context, source }}>
      <DBRowSidePanelInner {...props} source={source} />
    </RowSidePanelContext>
  );
}
