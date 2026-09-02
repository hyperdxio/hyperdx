import { useForm } from 'react-hook-form';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ExploreSqlPanel } from '@/components/Explore/ExploreSqlPanel';
import { useConfirm } from '@/useConfirm';

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

// The real ConfirmProvider lives in pages/_app.tsx and pulls in next/router.
jest.mock('@/useConfirm', () => ({ useConfirm: jest.fn() }));

const mockUseConfirm: jest.Mock = jest.mocked(useConfirm);

const GENERATED_SQL = 'SELECT count() FROM $__sourceTable WHERE $__filters';

const noop = () => {};

function Harness({
  sqlTemplate = GENERATED_SQL,
  edited = false,
  onEdit = noop,
  onReset = noop,
}: {
  sqlTemplate?: string;
  edited?: boolean;
  onEdit?: (value: string) => void;
  onReset?: () => void;
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
      onReset={onReset}
    />
  );
}

describe('ExploreSqlPanel', () => {
  beforeEach(() => {
    mockUseConfirm.mockReturnValue(jest.fn().mockResolvedValue(true));
  });

  it('offers no reset while the query is still generated', () => {
    renderWithMantine(<Harness />);

    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reset to generated/i }),
    ).not.toBeInTheDocument();
  });

  it('offers reset once the user owns the query', () => {
    renderWithMantine(<Harness edited />);

    expect(
      screen.getByRole('button', { name: /reset to generated/i }),
    ).toBeInTheDocument();
  });

  it('confirms before discarding hand-written SQL', async () => {
    const user = userEvent.setup();
    const onReset = jest.fn();
    const confirm = jest.fn().mockResolvedValue(true);
    mockUseConfirm.mockReturnValue(confirm);

    renderWithMantine(<Harness edited onReset={onReset} />);
    await user.click(
      screen.getByRole('button', { name: /reset to generated/i }),
    );

    expect(confirm).toHaveBeenCalled();
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('keeps the edits when the reset is declined', async () => {
    const user = userEvent.setup();
    const onReset = jest.fn();
    mockUseConfirm.mockReturnValue(jest.fn().mockResolvedValue(false));

    renderWithMantine(<Harness edited onReset={onReset} />);
    await user.click(
      screen.getByRole('button', { name: /reset to generated/i }),
    );

    expect(onReset).not.toHaveBeenCalled();
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
