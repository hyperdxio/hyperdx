import { useState, useCallback, memo } from 'react';
import usePortal from 'react-useportal';

import PatternSidePanel from './PatternSidePanel';
import PatternTable from './PatternTable';

import type { Pattern } from './PatternSidePanel';

function PatternTableWithSidePanel({
  config,
  isUTC,
  onShowEventsClick,
}: {
  config: {
    where: string;
    dateRange: [Date, Date];
  };
  isUTC: boolean;

  onShowEventsClick: () => void;
}) {
  const [openedPattern, setOpenedPattern] = useState<Pattern | undefined>();

  // Needed as sometimes the side panel will be contained with some
  // weird positioning and it breaks the slideout
  const { Portal } = usePortal();

  return (
    <>
      {openedPattern != null ? (
        <Portal>
          <PatternSidePanel
            pattern={openedPattern}
            onClose={() => {
              setOpenedPattern(undefined);
            }}
            config={config}
          />
        </Portal>
      ) : null}
      <PatternTable
        isUTC={isUTC}
        config={config}
        highlightedPatternId={openedPattern?.id}
        onShowEventsClick={onShowEventsClick}
        onRowExpandClick={useCallback(
          (pattern: Pattern) => {
            setOpenedPattern(pattern);
          },
          [setOpenedPattern],
        )}
      />
    </>
  );
}

export const MemoPatternTableWithSidePanel = memo(PatternTableWithSidePanel);
