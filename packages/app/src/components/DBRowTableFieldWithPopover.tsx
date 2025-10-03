import React, { useRef, useState } from 'react';
import cx from 'classnames';
import { Popover } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconCopy, IconFilterPlus } from '@tabler/icons-react';

import DBRowTableIconButton from './DBRowTableIconButton';

import styles from '../../styles/LogTable.module.scss';

export interface DBRowTableFieldWithPopoverProps {
  children: React.ReactNode;
  cellValue: any;
  wrapLinesEnabled: boolean;
}

export const DBRowTableFieldWithPopover = ({
  children,
  cellValue,
  wrapLinesEnabled,
}: DBRowTableFieldWithPopoverProps) => {
  const [opened, { close, open }] = useDisclosure(false);
  const [isCopied, setIsCopied] = useState(false);
  const [hoverDisabled, setHoverDisabled] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const hoverDisableTimeoutRef = useRef<NodeJS.Timeout>();

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
    const value = typeof cellValue === 'string' ? cellValue : `${cellValue}`;
    await navigator.clipboard.writeText(value);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const buttonSize = 20;
  const gapSize = 4;
  const numberOfButtons = 2;
  const numberOfGaps = numberOfButtons - 1;

  return (
    <div
      className={cx(styles.fieldText, {
        [styles.truncated]: !wrapLinesEnabled,
        [styles.wrapped]: wrapLinesEnabled,
      })}
    >
      <Popover
        width={buttonSize * numberOfButtons + gapSize * numberOfGaps}
        position="top-start"
        offset={5}
        opened={opened}
      >
        <Popover.Target>
          <span
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
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
            <DBRowTableIconButton
              onClick={() => {
                // TODO: Implement add filter functionality
              }}
              variant="copy"
              title="Add filter (coming soon)"
            >
              <IconFilterPlus size={14} />
            </DBRowTableIconButton>
          </div>
        </Popover.Dropdown>
      </Popover>
    </div>
  );
};

export default DBRowTableFieldWithPopover;
