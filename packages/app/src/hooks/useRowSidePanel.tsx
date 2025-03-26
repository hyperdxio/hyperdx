import React from 'react';
import produce from 'immer';
import { parseAsArrayOf, parseAsJson, useQueryState } from 'nuqs';

import DBRowSidePanel from '@/components/DBRowSidePanel';

type SidePanelState = {
  sid: string;
  rw: string;
};

type SidePanelStack = SidePanelState[];

export const useRowSidePanel = () => {
  const [sidePanelStack, setSidePanelStack] = useQueryState<SidePanelStack>(
    'rowDetails',
    parseAsArrayOf(parseAsJson()),
  );

  const pushSidePanel = React.useCallback(
    (sidePanel: SidePanelState, replace?: boolean) =>
      setSidePanelStack(
        produce(_draft => {
          const draft = _draft || [];
          if (replace) {
            draft.pop();
          }
          draft.push(sidePanel);
          return draft;
        }),
      ),
    [setSidePanelStack],
  );

  const closeSidePanel = React.useCallback(
    (index: number) =>
      setSidePanelStack(
        produce(draft => {
          draft?.splice(index, 1);
          if (!draft?.length) {
            draft = null;
          }
        }),
      ),
    [setSidePanelStack],
  );

  const sidePanel = React.useMemo(
    () => sidePanelStack?.[sidePanelStack.length - 1],
    [sidePanelStack],
  );

  // Row Side Panel
  const openRowSidePanel = React.useCallback(
    (sid: string, rw: string, replace?: boolean) => {
      pushSidePanel({ sid, rw }, replace);
    },
    [pushSidePanel],
  );

  return {
    sidePanel,
    sidePanelStack,
    closeSidePanel,
    openRowSidePanel,
  };
};

export const RowSidePanels: React.FC = () => {
  const { sidePanelStack, closeSidePanel } = useRowSidePanel();

  return (
    <>
      {sidePanelStack?.map((sidePanel, index) => (
        <DBRowSidePanel
          key={index}
          onClose={() => closeSidePanel(index)}
          rowId={sidePanel.rw}
          sourceId={sidePanel.sid}
          zIndexOffset={index}
          isTopPanel={index === sidePanelStack.length - 1}
        />
      ))}
    </>
  );
};
