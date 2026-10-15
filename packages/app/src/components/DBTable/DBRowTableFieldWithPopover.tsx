import React, { use, useEffect, useRef, useState } from 'react';
import cx from 'classnames';
import { Popover } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconFilter, IconFilterX } from '@tabler/icons-react';

import { RowSidePanelContext } from '@/components/DBRowSidePanel';
import {
  CLIPBOARD_ERROR_MESSAGE,
  copyTextToClipboard,
} from '@/utils/clipboard';

import { DBRowTableIconButton } from './DBRowTableIconButton';

import styles from '@styles/LogTable.module.scss';

/** Filter on (`include`) or out (`exclude`) a cell's value, by its column's filter key. */
export type CellFilterHandler = (
  key: string,
  value: string,
  action: 'include' | 'exclude',
) => void;

interface DBRowTableFieldWithPopoverProps {
  children: React.ReactNode;
  cellValue: unknown;
  wrapLinesEnabled: boolean;
  columnName?: string;
  /** The value include / exclude filter on, when it differs from the cell's. */
  filterValue?: string;
  tableContainerRef: HTMLDivElement | null;
  isChart?: boolean;
  /** Leaves out the cell padding, for tables that pad their own cells. */
  inline?: boolean;
  /** Overrides the side panel context's filter handler. */
  onPropertyAddClick?: CellFilterHandler;
}

const DBRowTableFieldWithPopover = ({
  children,
  cellValue,
  tableContainerRef,
  wrapLinesEnabled,
  columnName,
  filterValue,
  isChart = false,
  inline = false,
  onPropertyAddClick: onPropertyAddClickProp,
}: DBRowTableFieldWithPopoverProps) => {
  const [opened, { close, open }] = useDisclosure(false);
  const [isCopied, setIsCopied] = useState(false);
  const [hoverDisabled, setHoverDisabled] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const hoverDisableTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Cleanup timeouts on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (hoverDisableTimeoutRef.current) {
        clearTimeout(hoverDisableTimeoutRef.current);
      }
    };
  }, []);

  // Get filter functionality from context
  const { onPropertyAddClick: onPropertyAddClickContext } =
    use(RowSidePanelContext);
  const onPropertyAddClick =
    onPropertyAddClickProp ?? onPropertyAddClickContext;

  // Check if we have both the column name and filter function available
  const canFilter = columnName && onPropertyAddClick && cellValue != null;

  const handleMouseEnter = () => {
    if (hoverDisabled) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    open();
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      close();
    }, 100); // Small delay to allow moving to popover
  };

  const handleClick = () => {
    close();
    setHoverDisabled(true);

    if (hoverDisableTimeoutRef.current) {
      clearTimeout(hoverDisableTimeoutRef.current);
    }

    // Prevent the popover from immediately reopening on hover for 1 second
    // This gives users time to move their cursor or interact with modals
    // without the popover interfering with their intended action
    hoverDisableTimeoutRef.current = setTimeout(() => {
      setHoverDisabled(false);
    }, 1000);
  };

  const copyFieldValue = async () => {
    const value =
      typeof cellValue === 'string' ? cellValue : String(cellValue ?? '');
    const copied = await copyTextToClipboard(value);
    if (!copied) {
      notifications.show({
        color: 'red',
        message: CLIPBOARD_ERROR_MESSAGE,
      });
      return;
    }
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const getFilterValue = () =>
    filterValue ??
    (typeof cellValue === 'string' ? cellValue : String(cellValue ?? ''));

  const addFilter = () => {
    if (canFilter) {
      onPropertyAddClick(columnName, getFilterValue(), 'include');
      handleClick(); // Close the popover
    }
  };

  const excludeFilter = () => {
    if (canFilter) {
      onPropertyAddClick(columnName, getFilterValue(), 'exclude');
      handleClick(); // Close the popover
    }
  };

  const buttonSize = 20;
  const gapSize = 4;
  const numberOfButtons = canFilter ? 3 : 1; // Copy + Include Filter + Exclude Filter (if filtering available)
  const numberOfGaps = numberOfButtons - 1;

  // If it's a chart, just render the children without popover functionality
  if (isChart) {
    return (
      <div
        className={cx(styles.fieldText, {
          [styles.chart]: isChart,
        })}
        style={{
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={cx(styles.fieldText, {
        [styles.truncated]: !wrapLinesEnabled && !isChart,
        [styles.wrapped]: wrapLinesEnabled,
        [styles.chart]: isChart,
        [styles.inline]: inline,
      })}
    >
      <Popover
        width={buttonSize * numberOfButtons + gapSize * numberOfGaps}
        position="top-start"
        offset={5}
        opened={opened}
        portalProps={{ target: tableContainerRef ?? undefined }}
        closeOnClickOutside={false}
        clickOutsideEvents={[]}
      >
        <Popover.Target>
          <span
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
            tabIndex={-1}
            style={{ cursor: 'pointer' }}
          >
            {children}
          </span>
        </Popover.Target>
        <Popover.Dropdown
          style={{ pointerEvents: 'auto' }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className={styles.fieldTextPopover}
        >
          <div
            style={{
              display: 'flex',
              gap: `${gapSize}px`,
              alignItems: 'center',
            }}
          >
            <DBRowTableIconButton
              onClick={copyFieldValue}
              variant="copy"
              isActive={isCopied}
              title={isCopied ? 'Copied!' : 'Copy field value'}
            >
              <IconCopy size={14} />
            </DBRowTableIconButton>
            {canFilter && (
              <>
                <DBRowTableIconButton
                  onClick={addFilter}
                  variant="copy"
                  title="Toggle filter for this value"
                >
                  <IconFilter size={14} />
                </DBRowTableIconButton>
                <DBRowTableIconButton
                  onClick={excludeFilter}
                  variant="copy"
                  title="Exclude this value"
                >
                  <IconFilterX size={14} />
                </DBRowTableIconButton>
              </>
            )}
          </div>
        </Popover.Dropdown>
      </Popover>
    </div>
  );
};

export default DBRowTableFieldWithPopover;
