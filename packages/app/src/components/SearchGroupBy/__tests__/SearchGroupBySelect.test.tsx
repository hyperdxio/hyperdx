import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { fireEvent, screen } from '@testing-library/react';

import { SearchGroupBySelect } from '@/components/SearchGroupBy/SearchGroupBySelect';
import { useAllFields } from '@/hooks/useMetadata';

jest.mock('@/hooks/useMetadata', () => ({
  useAllFields: jest.fn(() => ({
    data: [
      { path: ['ServiceName'], type: 'String', jsType: 'string' },
      {
        path: ['SeverityText'],
        type: 'LowCardinality(String)',
        jsType: 'string',
      },
      { path: ['LogAttributes', 'user'], type: 'String', jsType: 'string' },
      { path: ['dash-column'], type: 'String', jsType: 'string' },
      { path: ['Duration'], type: 'UInt64', jsType: 'number' },
    ],
  })),
  useJsonColumns: () => ({ data: [] }),
  useMapColumns: () => ({ data: ['LogAttributes'] }),
}));

// jsdom has no layout, so the real virtualizer renders no rows. Render every
// row as if visible.
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 26,
      })),
    getTotalSize: () => count * 26,
    measureElement: () => {},
  }),
}));

// CodeMirror doesn't run in jsdom.
jest.mock('@/components/SQLEditor/SQLInlineEditor', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    onSubmit,
  }: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
  }) => (
    <textarea
      data-testid="group-by-sql"
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => e.key === 'Enter' && onSubmit()}
    />
  ),
}));

const source = {
  id: 'src',
  kind: SourceKind.Log,
  name: 'Logs',
  connection: 'conn',
  from: { databaseName: 'db', tableName: 'logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Body',
  severityTextExpression: 'SeverityText',
} satisfies TSource;

const dateRange: [Date, Date] = [new Date(0), new Date(1000)];

async function renderSelect(value: string | null, onApply = jest.fn()) {
  renderWithMantine(
    <SearchGroupBySelect
      source={source}
      value={value}
      onApply={onApply}
      dateRange={dateRange}
    />,
  );
  fireEvent.click(screen.getByTestId('search-group-by-button'));
  await screen.findByTestId('search-group-by-dropdown');
  return onApply;
}

const switchTab = (name: 'Fields' | 'SQL') =>
  fireEvent.click(screen.getByText(name));

const sqlInput = () => screen.getByTestId('group-by-sql');

// `hidden`: Mantine's popover transition never finishes in jsdom.
const checkbox = (name: string) =>
  screen.getByRole('checkbox', { name, hidden: true });

describe('SearchGroupBySelect', () => {
  it('shows the source default in the trigger and checked in the list', async () => {
    await renderSelect(null);
    expect(screen.getByTestId('search-group-by-button')).toHaveTextContent(
      'SeverityText',
    );
    expect(checkbox('SeverityText')).toBeChecked();
    expect(checkbox('ServiceName')).not.toBeChecked();
  });

  it.each([
    ['', 'none'],
    ['ServiceName', 'ServiceName'],
    ["ServiceName, LogAttributes['a,b']", '2 fields'],
  ])('labels the trigger for %j', async (value, label) => {
    await renderSelect(value);
    expect(screen.getByTestId('search-group-by-button')).toHaveTextContent(
      label,
    );
  });

  it('lists low-cardinality fields first and map keys as SQL', async () => {
    await renderSelect('');
    const [first, second, third] = await screen.findAllByRole('checkbox', {
      hidden: true,
    });
    expect(first).toHaveAccessibleName('SeverityText');
    expect(second).toHaveAccessibleName('ServiceName');
    expect(third).toHaveAccessibleName("LogAttributes['user']");
  });

  it('omits non-string fields', async () => {
    await renderSelect('');
    expect(screen.getByText('ServiceName')).toBeInTheDocument();
    expect(screen.queryByText('Duration')).not.toBeInTheDocument();
  });

  it('keeps the key list from the range it opened with while the range moves', async () => {
    const props = { source, value: null, onApply: jest.fn() };
    const { rerender } = renderWithMantine(
      <SearchGroupBySelect {...props} dateRange={dateRange} />,
    );
    fireEvent.click(screen.getByTestId('search-group-by-button'));
    await screen.findByTestId('search-group-by-dropdown');

    const laterRange: [Date, Date] = [new Date(5000), new Date(6000)];
    rerender(
      <TestProviders>
        <SearchGroupBySelect {...props} dateRange={laterRange} />
      </TestProviders>,
    );
    expect(jest.mocked(useAllFields)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: true, dateRange }),
    );
    expect(checkbox('ServiceName')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('search-group-by-button'));
    fireEvent.click(screen.getByTestId('search-group-by-button'));
    expect(jest.mocked(useAllFields)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: true, dateRange: laterRange }),
    );
  });

  it('carries checkbox selections into the SQL tab', async () => {
    await renderSelect('ServiceName');
    fireEvent.click(checkbox("LogAttributes['user']"));
    switchTab('SQL');
    expect(sqlInput()).toHaveValue("ServiceName, LogAttributes['user']");
  });

  it('carries SQL edits back into the checkboxes', async () => {
    await renderSelect('ServiceName');
    switchTab('SQL');
    fireEvent.change(sqlInput(), {
      target: { value: 'SeverityText, concat(a, b)' },
    });
    switchTab('Fields');
    expect(checkbox('SeverityText')).toBeChecked();
    expect(checkbox('ServiceName')).not.toBeChecked();
    expect(checkbox('concat(a, b)')).toBeChecked();
  });

  it('quotes a hyphenated column and keeps it in sync with the SQL tab', async () => {
    const onApply = await renderSelect('ServiceName');
    fireEvent.click(checkbox('`dash-column`'));
    switchTab('SQL');
    expect(sqlInput()).toHaveValue('ServiceName, `dash-column`');

    fireEvent.change(sqlInput(), { target: { value: '`dash-column`' } });
    switchTab('Fields');
    expect(checkbox('`dash-column`')).toBeChecked();
    expect(checkbox('ServiceName')).not.toBeChecked();

    fireEvent.click(screen.getByText('Apply'));
    expect(onApply).toHaveBeenCalledWith('`dash-column`');
  });

  it('applies the checkbox selection', async () => {
    const onApply = await renderSelect('ServiceName');
    fireEvent.click(checkbox('SeverityText'));
    fireEvent.click(screen.getByText('Apply'));
    expect(onApply).toHaveBeenCalledWith('ServiceName, SeverityText');
  });

  it('applies SQL from the SQL tab on Enter', async () => {
    const onApply = await renderSelect(null);
    switchTab('SQL');
    fireEvent.change(sqlInput(), {
      target: { value: ' ServiceName ,  concat(a, b) ' },
    });
    fireEvent.keyDown(sqlInput(), { key: 'Enter' });
    expect(onApply).toHaveBeenCalledWith('ServiceName, concat(a, b)');
  });

  it('applies an empty selection as no grouping', async () => {
    const onApply = await renderSelect('ServiceName');
    fireEvent.click(screen.getByText('Clear'));
    fireEvent.click(screen.getByText('Apply'));
    expect(onApply).toHaveBeenCalledWith('');
  });

  it('resets to the source default', async () => {
    const onApply = await renderSelect('ServiceName');
    fireEvent.click(screen.getByText('Reset to default'));
    expect(onApply).toHaveBeenCalledWith(null);
  });
});
