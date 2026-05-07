import React, { useContext, useEffect, useRef, useState } from 'react';
import cx from 'classnames';
import { Popover } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconCopy, IconFilter, IconFilterX } from '@tabler/icons-react';

import { copyTextWithToast } from '@/utils/clipboard';

import { RowSidePanelContext } from '../DBRowSidePanel';

import { DBRowTableIconButton } from './DBRowTableIconButton';

import styles from '../../../styles/LogTable.module.scss';

interface DBRowTableFieldWithPopoverProps {
  children: React.ReactNode;
  cellValue: unknown;
  wrapLinesEnabled: boolean;
  columnName?: string;
  tableContainerRef: HTMLDivElement | null;
  isChart?: boolean;
}

const DBRowTableFieldWithPopover = ({
  children,
  cellValue,
  tableContainerRef,
  wrapLinesEnabled,
  columnName,
  isChart = false,
}: DBRowTableFieldWithPopoverProps) => {
  const [opened, { close, open }] = useDisclosure(false);
  const [isCopied, setIsCopied] = useState(false);
  const [hoverDisabled, setHoverDisabled] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const hoverDisableTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  // Tracks the post-copy "isCopied -> isCopied=false" reset so unmount can
  // cancel it (popover and its parent row are virtualised; either can recycle
  // mid-await).
  const copyResetTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const isMountedRef = useRef(true);

  // Cleanup timeouts on unmount to prevent memory leaks and setState-after-
  // unmount warnings.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (hoverDisableTimeoutRef.current) {
        clearTimeout(hoverDisableTimeoutRef.current);
      }
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  // Get filter functionality from context
  const { onPropertyAddClick } = useContext(RowSidePanelContext);

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
    const ok = await copyTextWithToast(value, 'Copied field value');
    if (!ok || !isMountedRef.current) return;
    setIsCopied(true);
    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current);
    }
    copyResetTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setIsCopied(false);
      }
    }, 2000);
  };

  const addFilter = () => {
    if (canFilter) {
      const value =
        typeof cellValue === 'string' ? cellValue : String(cellValue ?? '');
      onPropertyAddClick(columnName, value, 'include');
      handleClick(); // Close the popover
    }
  };

  const excludeFilter = () => {
    if (canFilter) {
      const value =
        typeof cellValue === 'string' ? cellValue : String(cellValue ?? '');
      onPropertyAddClick(columnName, value, 'exclude');
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
            aria-hidden="true"
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
              data-testid="field-copy-value-button"
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
