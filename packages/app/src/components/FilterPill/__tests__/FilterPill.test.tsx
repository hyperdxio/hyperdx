import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FilterPill } from '@/components/FilterPill/FilterPill';

describe('FilterPill', () => {
  it('renders field, operator, and display value', () => {
    renderWithMantine(
      <FilterPill
        field="Timestamp"
        operator="="
        value="raw"
        displayValue="formatted"
        onRemove={jest.fn()}
      />,
    );
    expect(screen.getByText('Timestamp')).toBeInTheDocument();
    expect(screen.getByText('formatted')).toBeInTheDocument();
    expect(screen.queryByText('raw')).not.toBeInTheDocument();
  });

  it('renders a range operator without a leading space', () => {
    renderWithMantine(
      <FilterPill
        field="duration"
        operator=":"
        value="100 – 500"
        onRemove={jest.fn()}
        data-testid="pill"
      />,
    );
    expect(screen.getByTestId('pill')).toHaveTextContent(
      /^duration: 100 – 500$/,
    );
  });

  it('removes without opening the popover', async () => {
    const onRemove = jest.fn();
    renderWithMantine(
      <FilterPill
        field="status"
        operator="="
        value="200"
        onRemove={onRemove}
        renderPopover={() => <div>popover content</div>}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove filter' }),
    );
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('popover content')).not.toBeInTheDocument();
  });

  it('opens the popover on click and closes it via close()', async () => {
    const onOpenedChange = jest.fn();
    renderWithMantine(
      <FilterPill
        field="status"
        operator="="
        value="200"
        onRemove={jest.fn()}
        onOpenedChange={onOpenedChange}
        renderPopover={close => <button onClick={close}>Done</button>}
        data-testid="pill"
      />,
    );
    await userEvent.click(screen.getByTestId('pill'));
    expect(onOpenedChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Done', hidden: true }),
    );
    expect(onOpenedChange).toHaveBeenLastCalledWith(false);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Done', hidden: true }),
      ).not.toBeInTheDocument(),
    );
  });

  it('does not open the popover for an invalid pill', async () => {
    renderWithMantine(
      <FilterPill
        field="status"
        operator="="
        value="200"
        isInvalid
        onRemove={jest.fn()}
        renderPopover={() => <div>popover content</div>}
        data-testid="pill"
      />,
    );
    expect(screen.getByTestId('pill')).toHaveAttribute('data-invalid', 'true');
    await userEvent.click(screen.getByTestId('pill'));
    expect(screen.queryByText('popover content')).not.toBeInTheDocument();
  });
});
