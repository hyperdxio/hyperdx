import type { ComponentProps } from 'react';
import { SourceKind, TLogSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

import ContextSubpanel from '@/components/ContextSidePanel';
import { ROW_DATA_ALIASES } from '@/components/DBRowDataPanel';

jest.mock('nuqs', () => ({
  createParser: jest.fn(config => config),
  useQueryState: jest.fn(() => [null, jest.fn()]),
}));

jest.mock('@/source', () => ({
  useSource: jest.fn(() => ({ data: null })),
}));

jest.mock('@/components/DBRowSidePanel', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    default: () => null,
    RowSidePanelContext: React.createContext({
      setChildModalOpen: jest.fn(),
    }),
  };
});

jest.mock('@/components/DBRowTable', () => ({
  DBSqlRowTable: ({ config }: { config: { where?: string } }) => (
    <div data-testid="row-table" data-where={config.where ?? ''} />
  ),
}));

jest.mock('@/components/SearchInput/SearchWhereInput', () => {
  const React = jest.requireActual('react');
  const { useController } = jest.requireActual('react-hook-form');

  function MockSearchWhereInput({
    control,
    name,
  }: {
    control: any;
    name: string;
  }) {
    const { field } = useController({ control, name });
    return <input aria-label="custom-search" {...field} />;
  }

  return {
    __esModule: true,
    default: MockSearchWhereInput,
    getStoredLanguage: jest.fn(() => 'lucene'),
  };
});

const source: TLogSource = {
  id: 'source-id',
  kind: SourceKind.Log,
  name: 'logs',
  connection: 'conn-id',
  from: { databaseName: 'default', tableName: 'logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
  serviceNameExpression: 'ServiceName',
  resourceAttributesExpression: 'ResourceAttributes',
  eventAttributesExpression: 'LogAttributes',
};

const makeRowData = (serviceName: string) => ({
  [ROW_DATA_ALIASES.TIMESTAMP]: '2024-01-01T00:00:00Z',
  [ROW_DATA_ALIASES.SERVICE_NAME]: serviceName,
  [ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES]: {
    'service.name': serviceName,
    'host.name': `${serviceName}-host`,
  },
  [ROW_DATA_ALIASES.EVENT_ATTRIBUTES]: {
    'http.method': 'GET',
  },
  Body: `body ${serviceName}`,
});

function renderContextSubpanel(
  props: Partial<ComponentProps<typeof ContextSubpanel>> = {},
) {
  const allProps = {
    source,
    dbSqlRowTableConfig: undefined,
    rowData: makeRowData('api'),
    rowId: 'row-1',
    ...props,
  };

  return render(
    <MantineProvider>
      <ContextSubpanel {...allProps} />
    </MantineProvider>,
  );
}

describe('ContextSubpanel', () => {
  it('shows custom search input when manually selecting a pill', () => {
    renderContextSubpanel();

    expect(screen.queryByLabelText('custom-search')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('context-filter-ra:host.name'));

    expect(screen.getByLabelText('custom-search')).toBeInTheDocument();
  });

  it('clears stale custom search text when row changes', () => {
    const { rerender } = renderContextSubpanel();

    fireEvent.click(screen.getByText('Custom'));
    fireEvent.change(screen.getByLabelText('custom-search'), {
      target: { value: 'SeverityText:"ERROR"' },
    });

    rerender(
      <MantineProvider>
        <ContextSubpanel
          source={source}
          dbSqlRowTableConfig={undefined}
          rowData={makeRowData('worker')}
          rowId="row-2"
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByText('Custom'));

    expect(screen.getByLabelText('custom-search')).toHaveValue('');
  });
});
