import React from 'react';
import { parseAsJson, useQueryState } from 'nuqs';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import DBRowSidePanel from '@/components/DBRowSidePanel';
import { useSources } from '@/source';

type SidePanelState = {
  sourceId: string;
  rowWhere: string;
  tab?: string;
  dbSqlRowTableConfig?: ChartConfigWithDateRange;
};

type SidePanelStack = SidePanelState[];

export const useRowSidePanel = () => {
  const [sidePanelStack, setSidePanelStack] = useQueryState<SidePanelStack>(
    'drawer',
    parseAsJson(),
  );

  const pushSidePanel = React.useCallback(
    (sidePanel: SidePanelState, replace?: boolean) => {
      setSidePanelStack(prev => {
        const next = [...(prev || [])];
        if (replace) {
          next.pop();
        }
        next.push(sidePanel);
        return next;
      });
    },
    [setSidePanelStack],
  );

  const popSidePanel = React.useCallback(() => {
    setSidePanelStack(prev => {
      const next = [...(prev || [])];
      next.pop();
      return next;
    });
  }, [setSidePanelStack]);

  const closeSidePanel = React.useCallback(
    (index: number) => {
      setSidePanelStack(prev => {
        const next = [...(prev || [])];
        next.splice(index, 1);
        return next;
      });
    },
    [setSidePanelStack],
  );

  const sidePanel = React.useMemo(
    () => sidePanelStack?.[sidePanelStack.length - 1],
    [sidePanelStack],
  );

  return {
    sidePanel,
    sidePanelStack,
    closeSidePanel,
    pushSidePanel,
    popSidePanel,
  };
};

export const RowSidePanels = () => {
  const { sidePanelStack, closeSidePanel } = useRowSidePanel();
  const { data: sources } = useSources();

  if (!sources) {
    return null;
  }

  if (!sidePanelStack) {
    return null;
  }

  return sidePanelStack
    .map(sp => {
      const source = sources.find(s => s.id === sp.sourceId);
      return { ...sp, source: source ? source : null };
    })
    .filter(sp => sp.source)
    .map((sidePanel, index) => (
      <DBRowSidePanel
        key={index}
        onClose={() => closeSidePanel(index)}
        rowId={sidePanel.rowWhere}
        source={sidePanel.source!}
        zIndexOffset={index}
        dbSqlRowTableConfig={sidePanel.dbSqlRowTableConfig}
        isTopPanel={index === sidePanelStack.length - 1}
      />
    ));
};
