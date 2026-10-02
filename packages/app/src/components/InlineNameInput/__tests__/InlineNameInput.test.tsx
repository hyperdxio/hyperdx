import { useForm } from 'react-hook-form';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  InlineNameInput,
  InlineNameInputControlled,
} from '@/components/InlineNameInput/InlineNameInput';

function renderInput(value = 'My dashboard') {
  const onCommit = jest.fn();
  const utils = render(
    <InlineNameInput
      value={value}
      onCommit={onCommit}
      aria-label="Dashboard name"
      placeholder="Untitled dashboard"
    />,
  );
  return { ...utils, onCommit, input: screen.getByLabelText('Dashboard name') };
}

describe('InlineNameInput', () => {
  it('commits the trimmed name on Enter', async () => {
    const user = userEvent.setup();
    const { input, onCommit } = renderInput();

    await user.clear(input);
    await user.type(input, '  Checkout latency  {Enter}');

    expect(onCommit).toHaveBeenCalledWith('Checkout latency');
    expect(input).not.toHaveFocus();
  });

  it('shows the saved value after committing, not the draft', async () => {
    const user = userEvent.setup();
    const { input, rerender } = renderInput();

    await user.type(input, ' v2{Enter}');
    expect(input).toHaveValue('My dashboard');

    rerender(
      <InlineNameInput
        value="My dashboard v2"
        onCommit={jest.fn()}
        aria-label="Dashboard name"
      />,
    );
    expect(input).toHaveValue('My dashboard v2');
  });

  it('commits on blur', async () => {
    const user = userEvent.setup();
    const { input, onCommit } = renderInput();

    await user.type(input, ' v2');
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith('My dashboard v2');
  });

  it('reverts on Escape without committing', async () => {
    const user = userEvent.setup();
    const { input, onCommit } = renderInput();

    await user.type(input, ' changed{Escape}');

    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('My dashboard');
  });

  it('reverts an empty or unchanged name without committing', async () => {
    const user = userEvent.setup();
    const { input, onCommit } = renderInput();

    await user.clear(input);
    await user.tab();
    expect(input).toHaveValue('My dashboard');

    await user.click(input);
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('picks up a new saved value when not editing', () => {
    const { rerender, input } = renderInput();

    rerender(
      <InlineNameInput
        value="Renamed elsewhere"
        onCommit={jest.fn()}
        aria-label="Dashboard name"
      />,
    );

    expect(input).toHaveValue('Renamed elsewhere');
  });

  it('exposes the name as a heading when headingLevel is set', () => {
    render(
      <InlineNameInput
        value="My dashboard"
        onCommit={jest.fn()}
        aria-label="Dashboard name"
        headingLevel={3}
      />,
    );

    expect(screen.getByRole('heading', { level: 3 })).toContainElement(
      screen.getByLabelText('Dashboard name'),
    );
  });
});

function ControlledHarness({ onSubmit }: { onSubmit: (v: unknown) => void }) {
  const { control, handleSubmit } = useForm({ defaultValues: { name: '' } });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <InlineNameInputControlled
        control={control}
        name="name"
        size="sm"
        aria-label="Tile name"
        placeholder="Untitled tile"
      />
      <button type="submit">Save</button>
    </form>
  );
}

describe('InlineNameInputControlled', () => {
  it('stores the name in the form and saves it with the form', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<ControlledHarness onSubmit={onSubmit} />);

    const input = screen.getByLabelText('Tile name');
    expect(input).toHaveAttribute('placeholder', 'Untitled tile');

    await user.type(input, 'Error rate');
    await user.tab();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith(
      { name: 'Error rate' },
      expect.anything(),
    );
  });
});
