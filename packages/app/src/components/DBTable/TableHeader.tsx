import cx from 'classnames';
import { Button, Group, Text } from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconDotsVertical,
} from '@tabler/icons-react';
import { flexRender, Header } from '@tanstack/react-table';

import { UNDEFINED_WIDTH } from '@/tableUtils';

export default function TableHeader({
  isLast,
  header,
  lastItemButtons,
}: {
  isLast: boolean;
  header: Header<any, any>;
  lastItemButtons?: React.ReactNode;
}) {
  return (
    <th
      className="overflow-hidden bg-hdx-dark"
      key={header.id}
      colSpan={header.colSpan}
      style={{
        width: header.getSize() === UNDEFINED_WIDTH ? '100%' : header.getSize(),
        // Allow unknown width columns to shrink to 0
        minWidth: header.getSize() === UNDEFINED_WIDTH ? 0 : header.getSize(),
      }}
    >
      <Group wrap="nowrap" gap={0} align="center">
        {!header.column.getCanSort() ? (
          <Text truncate="end" size="xs" flex="1">
            {flexRender(header.column.columnDef.header, header.getContext())}
          </Text>
        ) : (
          <Button
            size="xxs"
            p={1}
            variant="subtle"
            color="gray"
            onClick={header.column.getToggleSortingHandler()}
            flex="1"
            justify="space-between"
            data-testid="raw-log-table-sort-button"
          >
            <>
              {header.isPlaceholder ? null : (
                <Text truncate="end" size="xs" flex="1" c="white">
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
          </Button>
        )}

        <Group gap={0} wrap="nowrap" align="center">
          {header.column.getCanResize() && !isLast && (
            <div
              onMouseDown={header.getResizeHandler()}
              onTouchStart={header.getResizeHandler()}
              className={cx(
                `resizer text-gray-600 cursor-col-resize`,
                header.column.getIsResizing() && 'isResizing',
              )}
            >
              <IconDotsVertical size={12} />
            </div>
          )}
          {isLast && (
            <Group gap={2} wrap="nowrap">
              {lastItemButtons}
            </Group>
          )}
        </Group>
      </Group>
    </th>
  );
}
