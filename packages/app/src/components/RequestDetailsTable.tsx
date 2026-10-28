import { ReactNode } from 'react';
import { Table } from '@mantine/core';

export type RequestDetailRow = [label: string, value: ReactNode];

export function RequestDetailsTable({ rows }: { rows: RequestDetailRow[] }) {
  const visibleRows = rows.filter(([, value]) => value != null && value !== '');
  if (visibleRows.length === 0) {
    return null;
  }

  return (
    <Table
      withRowBorders={false}
      verticalSpacing={2}
      horizontalSpacing="xs"
      fz="xs"
      w="auto"
      style={{ alignSelf: 'flex-start' }}
    >
      <Table.Tbody>
        {visibleRows.map(([label, value]) => (
          <Table.Tr key={label}>
            <Table.Td
              c="dimmed"
              ps={0}
              style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}
            >
              {label}
            </Table.Td>
            <Table.Td style={{ overflowWrap: 'anywhere' }}>{value}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
