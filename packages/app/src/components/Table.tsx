import * as React from 'react';
import cx from 'classnames';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';

import { UNDEFINED_WIDTH } from '../tableUtils';

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
};

// TODO: Retire this component in favor of Mantine
export const Table = <T extends Record<string, unknown> | string[]>({
  data = [],
  columns,
  emptyMessage,
  hideHeader,
  borderless,
  density = 'normal',
  interactive,
  tableMeta,
}: TableProps<T>) => {
  const table = useReactTable({
    data,
    columns,
    meta: tableMeta,
    getCoreRowModel: getCoreRowModel(),
  });

  if (!data.length) {
    return <div className={styles.emptyMessage}>{emptyMessage}</div>;
  }

  return (
    <div
      className={cx(styles.tableWrapper, {
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
                    style={{
                      width:
                        header.column.getSize() === UNDEFINED_WIDTH
                          ? '100%'
                          : header.column.getSize(),
                    }}
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
                  style={{
                    width:
                      cell.column.getSize() === UNDEFINED_WIDTH
                        ? '100%'
                        : cell.column.getSize(),
                  }}
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

export const TableCellButton: React.VFC<{
  title?: string;
  label: React.ReactNode;
  biIcon?: string;
  onClick: VoidFunction;
}> = ({ onClick, title, label, biIcon }) => {
  return (
    <button className={styles.tableCellButton} title={title} onClick={onClick}>
      {label && <span>{label}</span>}
      {biIcon ? <i className={`bi bi-${biIcon}`} /> : null}
    </button>
  );
};
