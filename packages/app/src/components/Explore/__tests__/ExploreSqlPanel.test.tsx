import { useForm } from 'react-hook-form';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ExploreSqlPanel } from '@/components/Explore/ExploreSqlPanel';

// The real editor pulls in CodeMirror and the ClickHouse metadata hooks; this
// suite is about the panel's own chrome, so it stands in for the editor and
// exposes the header actions it is handed.
jest.mock('@/components/Explore/ExploreRawSqlEditor', () => ({
  __esModule: true,
  ExploreRawSqlEditor: ({
    headerActions,
    onValueChange,
  }: {
    headerActions?: React.ReactNode;
    onValueChange?: (value: string) => void;
  }) => (
    <div>
      {headerActions}
      <button type="button" onClick={() => onValueChange?.('SELECT 2')}>
        simulate typing
      </button>
    </div>
  ),
}));

const GENERATED_SQL = 'SELECT count() FROM $__sourceTable WHERE $__filters';

const noop = () => {};

function Harness({
  sqlTemplate = GENERATED_SQL,
  edited = false,
  onEdit = noop,
}: {
  sqlTemplate?: string;
  edited?: boolean;
  onEdit?: (value: string) => void;
}) {
  const { control } = useForm({ defaultValues: { sqlTemplate } });
  return (
    <ExploreSqlPanel
      control={control}
      name="sqlTemplate"
      tableConnections={[]}
      sqlTemplate={sqlTemplate}
      edited={edited}
      onEdit={onEdit}
    />
  );
}

describe('ExploreSqlPanel', () => {
  it('has no reset action, since leaving Advanced mode discards edits', () => {
    renderWithMantine(<Harness edited />);

    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reset/i }),
    ).not.toBeInTheDocument();
  });

  it('warns that the search box no longer applies once $__filters is gone', () => {
    renderWithMantine(
      <Harness edited sqlTemplate="SELECT count() FROM logs" />,
    );

    expect(screen.getByText(/no longer uses/i)).toBeInTheDocument();
  });

  it('stays quiet while the query still carries $__filters', () => {
    renderWithMantine(<Harness edited sqlTemplate={GENERATED_SQL} />);

    expect(screen.queryByText(/no longer uses/i)).not.toBeInTheDocument();
  });

  it('does not warn about a generated query, which always has the macro', () => {
    renderWithMantine(<Harness sqlTemplate="SELECT count() FROM logs" />);

    expect(screen.queryByText(/no longer uses/i)).not.toBeInTheDocument();
  });

  it('reports the new text when the user types, so the caller can take over', async () => {
    const user = userEvent.setup();
    const onEdit = jest.fn();
    renderWithMantine(<Harness onEdit={onEdit} />);

    await user.click(screen.getByRole('button', { name: 'simulate typing' }));

    expect(onEdit).toHaveBeenCalledWith('SELECT 2');
  });
});
