import { ColumnDef } from '@tanstack/react-table';
import { render } from '@testing-library/react';

import { Table } from '@/components/Table';
import { UNDEFINED_WIDTH } from '@/tableUtils';

type Row = { label: string; value: string };

const columns: ColumnDef<Row>[] = [
  {
    accessorKey: 'label',
    header: 'Label',
    size: 260,
    cell: ({ row }) => <span>{row.original.label}</span>,
  },
  {
    accessorKey: 'value',
    header: 'Value',
    size: UNDEFINED_WIDTH,
    cell: ({ row }) => <span>{row.original.value}</span>,
  },
];

const data: Row[] = [{ label: 'URL', value: 'https://example.com/a/b/c' }];

const cells = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLTableCellElement>('tbody td'));

describe('Table', () => {
  it('pins sized columns to their pixel width in the default fixed layout', () => {
    const { container } = render(
      <Table columns={columns} data={data} hideHeader />,
    );

    const [label, value] = cells(container);
    expect(label).toHaveStyle({ width: '260px' });
    expect(value).toHaveStyle({ width: '100%' });
  });
});
