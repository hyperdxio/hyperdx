import { Table } from '../../components/Table';
import { ColumnDef } from '@tanstack/react-table';
import { UNDEFINED_WIDTH } from '../../tableUtils';
const MOCK_COLUMNS: ColumnDef<any>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    size: UNDEFINED_WIDTH,
  },
  {
    accessorKey: 'age',
    header: 'Age',
    size: 120,
  },
  {
    accessorKey: 'email',
    header: 'Email',
  },
  {
    size: 300,
    accessorKey: 'company',
    header: 'Company',
  },
];

const MOCK_DATA = [
  {
    id: 1,
    name: 'John Doe',
    age: 30,
    email: 'super@test.com',
    company: 'Acme Inc.',
  },
  {
    id: 2,
    name: 'Jane Doe',
    age: 25,
    email: 'jane@test.com',
    company: 'Acme Inc.',
  },
  {
    id: 3,
    name: 'John Smith',
    age: 35,
    email: 'john@test.com',
    company: 'Acme Canada Research Inc.',
  },
];

export const Default = (props: any) => (
  <Table
    data={MOCK_DATA}
    columns={MOCK_COLUMNS}
    emptyMessage="No data available"
    {...props}
  />
);

export const Empty = (props: any) => (
  <Table
    data={[]}
    columns={MOCK_COLUMNS}
    emptyMessage="No data available"
    {...props}
  />
);

export default {
  title: 'Table',
  component: Table,
};
