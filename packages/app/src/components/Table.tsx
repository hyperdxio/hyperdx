import * as React from 'react';
import cx from 'classnames';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';

import { UNDEFINED_WIDTH } from '@/tableUtils';

import styles from './Table.module.scss';

type TableProps<T extends Record<string, unknown> | string[]> = {
  data?: T[];
  columns: ColumnDef<T>[];
  emptyMessage?: string;
  hideHeader?: boolean;
  borderless?: boolean;
  density?: 'zero' | 'compact' | 'normal' | 'comfortable';
  interactive?: boolean;
  tableMeta?: Record<string, any>;
  /**
   * `fixed` honours each column's `size` in pixels, which needs the table to be
   * wider than the sizes add up to — in a narrow panel the leftover column
   * collapses to its min-content width, a single character once `break-all`
   * applies. `auto` sizes columns to their content instead and lets the
   * `UNDEFINED_WIDTH` column absorb the remainder, so the layout survives at
   * any width. Prefer it wherever the table sits in a resizable panel.
   */
  layout?: 'fixed' | 'auto';
};

// TODO: Retire this component in favor of Mantine
export const Table = <T extends Record<string, unknown> | string[]>({
  data,
  columns,
  emptyMessage,
  hideHeader,
  borderless,
  density = 'normal',
  interactive,
  tableMeta,
  layout = 'fixed',
}: TableProps<T>) => {
  const table = useReactTable({
    data: data ?? [],
    columns,
    meta: tableMeta,
    getCoreRowModel: getCoreRowModel(),
  });

  if (!data?.length) {
    return <div className={styles.emptyMessage}>{emptyMessage}</div>;
  }

  // In auto layout only the absorbing column is given a width; pinning the
  // others to their `size` would reintroduce the overflow it exists to avoid.
  const columnWidth = (size: number) => {
    if (size === UNDEFINED_WIDTH) {
      return '100%';
    }
    return layout === 'auto' ? undefined : size;
  };

  return (
    <div
      className={cx(styles.tableWrapper, {
        [styles.tableLayoutAuto]: layout === 'auto',
        [styles.tableBorderless]: borderless,
        [styles.tableDensityZero]: density === 'zero',
        [styles.tableDensityCompact]: density === 'compact',
        [styles.tableDensityComfortable]: density === 'comfortable',
        [styles.tableInteractive]: interactive,
      })}
    >
      <table>
        {!hideHeader && (
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    className={cx({
                      [styles.fluidCell]:
                        header.column.getSize() === UNDEFINED_WIDTH,
                    })}
                    style={{ width: columnWidth(header.column.getSize()) }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
        )}
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr key={row.id}>
              {row.getVisibleCells().map(cell => (
                <td
                  key={cell.id}
                  className={cx({
                    [styles.fluidCell]:
                      cell.column.getSize() === UNDEFINED_WIDTH,
                  })}
                  style={{ width: columnWidth(cell.column.getSize()) }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const TableCellButton: React.FC<{
  title?: string;
  label: React.ReactNode;
  biIcon?: 'chevron-up' | 'chevron-down';
  onClick: VoidFunction;
}> = ({ onClick, title, label, biIcon }) => {
  return (
    <button className={styles.tableCellButton} title={title} onClick={onClick}>
      {!!label && <span>{label}</span>}
      {biIcon === 'chevron-up' && <IconChevronUp size={14} />}
      {biIcon === 'chevron-down' && <IconChevronDown size={14} />}
    </button>
  );
};
