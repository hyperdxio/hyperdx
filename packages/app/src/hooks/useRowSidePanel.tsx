import React from 'react';
import LZString from 'lz-string';
import { createParser, useQueryState } from 'nuqs';
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

// Compress and decompress the value to save space in the URL
const deflateParser = createParser({
  parse: (value: string) => {
    return JSON.parse(LZString.decompressFromBase64(value)) as SidePanelStack;
  },
  serialize: (value: SidePanelStack) => {
    return LZString.compressToBase64(JSON.stringify(value));
  },
});

export const useRowSidePanel = () => {
  const [sidePanelStack, setSidePanelStack] = useQueryState<SidePanelStack>(
    'sp',
    deflateParser,
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

  const updateSidePanelState = React.useCallback(
    (index: number, update: Partial<SidePanelState>) => {
      setSidePanelStack(prev => {
        const next = [...(prev || [])];
        next[index] = { ...next[index], ...update };
        return next;
      });
    },
    [setSidePanelStack],
  );

  return {
    sidePanel,
    sidePanelStack,
    closeSidePanel,
    pushSidePanel,
    popSidePanel,
    updateSidePanelState,
  };
};

export const RowSidePanels = () => {
  const { sidePanelStack, closeSidePanel, updateSidePanelState } =
    useRowSidePanel();
  const { data: sources } = useSources();

  if (!sources) {
    return null;
  }

  if (!sidePanelStack) {
    return null;
  }

  // Rendering only the top side panel is slow due to remounting all components
  // const topLevelSidePanel = React.useMemo(() => {
  //   const sidePanel = sidePanelStack?.[sidePanelStack?.length - 1];
  //   const source = sources?.find(s => s.id === sidePanel?.sourceId);

  //   if (!sidePanel || !source) {
  //     return null;
  //   }

  //   const topIndex = sidePanelStack.length - 1;

  //   return (
  //     <DBRowSidePanel
  //       onClose={() => closeSidePanel(topIndex)}
  //       rowId={sidePanel.rowWhere}
  //       source={source}
  //       zIndexOffset={topIndex}
  //       tab={sidePanel.tab || 'overview'}
  //       setTab={tab => {
  //         updateSidePanelState(topIndex, { tab });
  //       }}
  //       dbSqlRowTableConfig={sidePanel.dbSqlRowTableConfig}
  //     />
  //   );
  // }, [closeSidePanel, sidePanelStack, sources, updateSidePanelState]);

  // return topLevelSidePanel;

  return sidePanelStack
    .map(sp => {
      const source = sources.find(s => s.id === sp.sourceId);
      if (!source) {
        return { ...sp, source: null };
      }
      return { ...sp, source };
    })
    .filter(sp => sp.source)
    .map((sidePanel, index) => (
      <DBRowSidePanel
        key={index}
        onClose={() => closeSidePanel(index)}
        rowId={sidePanel.rowWhere}
        source={sidePanel.source!}
        zIndexOffset={index}
        tab={sidePanel.tab || 'overview'}
        setTab={tab => {
          updateSidePanelState(index, { tab });
        }}
        dbSqlRowTableConfig={sidePanel.dbSqlRowTableConfig}
        isTopPanel={index === sidePanelStack.length - 1}
      />
    ));
};
