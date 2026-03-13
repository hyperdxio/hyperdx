import cx from 'classnames';
import { Group, Text, UnstyledButton } from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconGripVertical,
  IconX,
} from '@tabler/icons-react';
import { flexRender, Header } from '@tanstack/react-table';

import { UNDEFINED_WIDTH } from '@/tableUtils';

import { DBRowTableIconButton } from './DBRowTableIconButton';

import headerStyles from './TableHeader.module.scss';

export default function TableHeader({
  isLast,
  header,
  lastItemButtons,
  onRemoveColumn,
}: {
  isLast: boolean;
  header: Header<any, any>;
  lastItemButtons?: React.ReactNode;
  onRemoveColumn?: () => void;
}) {
  'use no memo'; // todo: table headers arent being resized properly with the react compiler
  return (
    <th
      className={cx('overflow-hidden', {
        [headerStyles.headerCellWithAction]: !!onRemoveColumn,
      })}
      key={header.id}
      colSpan={header.colSpan}
      style={{
        width: header.getSize() === UNDEFINED_WIDTH ? '100%' : header.getSize(),
        minWidth: header.getSize() === UNDEFINED_WIDTH ? 0 : header.getSize(),
        textAlign: 'left',
      }}
    >
      <Group wrap="nowrap" gap={0} align="center">
        {!header.column.getCanSort() ? (
          <Text truncate="end" size="xs" flex="1">
            {flexRender(header.column.columnDef.header, header.getContext())}
          </Text>
        ) : (
          <UnstyledButton
            className={headerStyles.sortButton}
            onClick={header.column.getToggleSortingHandler()}
            flex="1"
            data-testid="raw-log-table-sort-button"
          >
            <>
              {header.isPlaceholder ? null : (
                <Text truncate="end" size="xs" flex="1">
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </Text>
              )}

              {header.column.getIsSorted() && (
                <div
                  data-testid="raw-log-table-sort-indicator"
                  className={
                    header.column.getIsSorted() === 'asc'
                      ? 'sorted-asc'
                      : 'sorted-desc'
                  }
                >
                  <>
                    {header.column.getIsSorted() === 'asc' ? (
                      <IconArrowUp size={12} />
                    ) : (
                      <IconArrowDown size={12} />
                    )}
                  </>
                </div>
              )}
            </>
          </UnstyledButton>
        )}

        <Group gap={0} wrap="nowrap" align="center">
          {onRemoveColumn && (
            <div className={headerStyles.headerRemoveButton}>
              <DBRowTableIconButton
                onClick={onRemoveColumn}
                title="Remove column"
                variant="copy"
                iconSize={10}
              >
                <IconX size={10} />
              </DBRowTableIconButton>
            </div>
          )}
          {header.column.getCanResize() && !isLast && (
            <div
              onMouseDown={header.getResizeHandler()}
              onTouchStart={header.getResizeHandler()}
              className={cx(
                `resizer ${headerStyles.cursorColResize}`,
                header.column.getIsResizing() && 'isResizing',
              )}
            >
              <IconGripVertical size={12} />
            </div>
          )}
          {isLast && (
            <Group gap={2} wrap="nowrap" align="center">
              {lastItemButtons}
            </Group>
          )}
        </Group>
      </Group>
    </th>
  );
}
