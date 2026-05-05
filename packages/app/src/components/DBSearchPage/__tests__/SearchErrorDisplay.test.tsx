import React from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { SearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchErrorDisplay } from '../SearchErrorDisplay';

jest.mock('@/components/ChartSQLPreview', () => ({
  SQLPreview: ({ data }: { data: string }) => <pre>{data}</pre>,
}));

jest.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => (
    <pre data-testid="codemirror">{value}</pre>
  ),
}));

const baseChartConfig: SearchChartConfig = {
  select: 'Timestamp',
  from: { databaseName: 'db', tableName: 'logs' },
  where: 'level = "error"',
  whereLanguage: 'sql',
  timestampValueExpression: 'Timestamp',
  connection: 'conn',
  displayType: DisplayType.Search,
  orderBy: 'Timestamp DESC',
  source: 'source-1',
} as any;

describe('SearchErrorDisplay', () => {
  it('renders the error message', () => {
    renderWithMantine(
      <SearchErrorDisplay
        chartConfig={baseChartConfig}
        queryError={new Error('boom')}
        whereSuggestions={undefined}
        onAcceptSuggestion={jest.fn()}
      />,
    );
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByText('Error Message:')).toBeInTheDocument();
  });

  it('renders SELECT / WHERE / ORDER BY chart config preview', () => {
    renderWithMantine(
      <SearchErrorDisplay
        chartConfig={baseChartConfig}
        queryError={new Error('boom')}
        whereSuggestions={undefined}
        onAcceptSuggestion={jest.fn()}
      />,
    );
    expect(screen.getByText('SELECT')).toBeInTheDocument();
    expect(screen.getByText('ORDER BY')).toBeInTheDocument();
    expect(screen.getByText('WHERE')).toBeInTheDocument();
  });

  it('shows "Searched For" label when whereLanguage is lucene and renders CodeMirror', () => {
    renderWithMantine(
      <SearchErrorDisplay
        chartConfig={{ ...baseChartConfig, whereLanguage: 'lucene' }}
        queryError={new Error('boom')}
        whereSuggestions={undefined}
        onAcceptSuggestion={jest.fn()}
      />,
    );
    expect(screen.getByText('Searched For')).toBeInTheDocument();
    expect(screen.getByTestId('codemirror')).toBeInTheDocument();
  });

  it('renders the original ClickHouse query when error is a ClickHouseQueryError', () => {
    const chError = new ClickHouseQueryError('chboom', 'SELECT * FROM x');
    renderWithMantine(
      <SearchErrorDisplay
        chartConfig={baseChartConfig}
        queryError={chError}
        whereSuggestions={undefined}
        onAcceptSuggestion={jest.fn()}
      />,
    );
    expect(screen.getByText('Original Query:')).toBeInTheDocument();
    expect(screen.getByText('SELECT * FROM x')).toBeInTheDocument();
  });

  it('omits the Query Helper section when there are no suggestions', () => {
    renderWithMantine(
      <SearchErrorDisplay
        chartConfig={baseChartConfig}
        queryError={new Error('boom')}
        whereSuggestions={[]}
        onAcceptSuggestion={jest.fn()}
      />,
    );
    expect(screen.queryByText('Query Helper')).toBeNull();
  });

  it('renders Query Helper suggestions and invokes onAcceptSuggestion with corrected text', async () => {
    const onAcceptSuggestion = jest.fn();
    const suggestion = {
      userMessage: (key: string) => `did you mean ${key}: foo`,
      corrected: () => 'level = "error"',
    };
    renderWithMantine(
      <SearchErrorDisplay
        chartConfig={baseChartConfig}
        queryError={new Error('boom')}
        whereSuggestions={[suggestion]}
        onAcceptSuggestion={onAcceptSuggestion}
      />,
    );
    expect(screen.getByText('Query Helper')).toBeInTheDocument();
    expect(screen.getByText('did you mean where: foo')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onAcceptSuggestion).toHaveBeenCalledWith('level = "error"');
  });
});
