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

  it('drops pixel widths in auto layout so a narrow panel cannot squeeze the fluid column', () => {
    const { container } = render(
      <Table columns={columns} data={data} hideHeader layout="auto" />,
    );

    const [label, value] = cells(container);
    expect(label.style.width).toBe('');
    expect(value).toHaveStyle({ width: '100%' });
  });

  it('marks only the fluid column as free to break mid-word', () => {
    const { container } = render(
      <Table columns={columns} data={data} hideHeader layout="auto" />,
    );

    const [label, value] = cells(container);
    expect(label.className).not.toMatch(/fluidCell/);
    expect(value.className).toMatch(/fluidCell/);
  });

  it('marks the fluid header cell too', () => {
    const { container } = render(
      <Table columns={columns} data={data} layout="auto" />,
    );

    const headers = Array.from(container.querySelectorAll('thead th'));
    expect(headers[0].className).not.toMatch(/fluidCell/);
    expect(headers[1].className).toMatch(/fluidCell/);
  });
});
