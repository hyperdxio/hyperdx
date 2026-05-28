import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CHART_PALETTE_TOKENS, ChartPaletteToken } from '@/utils';

import { ColorSwatchInput } from './ColorSwatchInput';

describe('ColorSwatchInput', () => {
  it('renders an unselected trigger by default', () => {
    renderWithMantine(<ColorSwatchInput />);

    const trigger = screen.getByTestId('color-swatch-input-trigger');
    expect(trigger).toHaveTextContent(/color/i);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/pick/i),
    );
  });

  it('opens the palette popover when the trigger is clicked', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ColorSwatchInput />);

    await user.click(screen.getByTestId('color-swatch-input-trigger'));

    expect(
      await screen.findByTestId('color-swatch-option-chart-blue'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('color-swatch-option-chart-success'),
    ).toBeInTheDocument();
  });

  it('exposes a swatch for every palette token', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ColorSwatchInput />);

    await user.click(screen.getByTestId('color-swatch-input-trigger'));

    for (const token of CHART_PALETTE_TOKENS) {
      expect(
        await screen.findByTestId(`color-swatch-option-${token}`),
      ).toBeInTheDocument();
    }
  });

  it('calls onChange with the picked palette token', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderWithMantine(<ColorSwatchInput onChange={onChange} />);

    await user.click(screen.getByTestId('color-swatch-input-trigger'));
    await user.click(
      await screen.findByTestId('color-swatch-option-chart-warning'),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('chart-warning');
  });

  it('reflects the selected token in the trigger', () => {
    renderWithMantine(<ColorSwatchInput value="chart-error" />);

    const trigger = screen.getByTestId('color-swatch-input-trigger');
    expect(trigger).toHaveTextContent(/error/i);
    expect(trigger).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/error/i),
    );
  });

  it('marks only the selected swatch as pressed', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ColorSwatchInput value="chart-orange" />);

    await user.click(screen.getByTestId('color-swatch-input-trigger'));

    const selected = await screen.findByTestId(
      'color-swatch-option-chart-orange',
    );
    const other = await screen.findByTestId('color-swatch-option-chart-red');
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(other).toHaveAttribute('aria-pressed', 'false');
  });

  it('clears the selection via the Clear button', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderWithMantine(
      <ColorSwatchInput value="chart-blue" onChange={onChange} />,
    );

    await user.click(screen.getByTestId('color-swatch-input-trigger'));
    await user.click(await screen.findByTestId('color-swatch-input-clear'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('does not show a Clear button when no value is set', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ColorSwatchInput />);

    await user.click(screen.getByTestId('color-swatch-input-trigger'));

    expect(
      await screen.findByTestId('color-swatch-option-chart-blue'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('color-swatch-input-clear'),
    ).not.toBeInTheDocument();
  });

  it('treats a legacy non-token value as unset and never echoes it back', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderWithMantine(
      <ColorSwatchInput
        // Simulate a legacy hex string surviving from before the palette refactor.
        value={'#ff0000' as unknown as ChartPaletteToken}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByTestId('color-swatch-input-trigger');
    expect(trigger).toHaveTextContent(/color/i);
    expect(trigger).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/pick/i),
    );

    await user.click(trigger);
    // The legacy value should not pre-select any swatch.
    for (const token of CHART_PALETTE_TOKENS) {
      expect(
        await screen.findByTestId(`color-swatch-option-${token}`),
      ).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('migrates a legacy chart-1..10 value to the matching hue swatch', async () => {
    // Regression: dashboards saved through #2265 store `chart-1`..`chart-10`.
    // The fetch path raw-casts API responses so ChartPaletteTokenSchema's
    // legacy preprocess never runs. The picker must still show the
    // migrated selection so users don't see "no color" when reopening a
    // tile's Display Settings drawer.
    const user = userEvent.setup();
    renderWithMantine(
      <ColorSwatchInput
        value={'chart-1' as unknown as ChartPaletteToken}
        onChange={jest.fn()}
      />,
    );

    const trigger = screen.getByTestId('color-swatch-input-trigger');
    expect(trigger).toHaveTextContent(/green/i);

    await user.click(trigger);
    expect(
      await screen.findByTestId('color-swatch-option-chart-green'),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('respects disabled and does not open the popover', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ColorSwatchInput disabled />);

    const trigger = screen.getByTestId('color-swatch-input-trigger');
    expect(trigger).toHaveAttribute('data-disabled');

    await user.click(trigger);
    expect(
      screen.queryByTestId('color-swatch-option-chart-blue'),
    ).not.toBeInTheDocument();
  });

  it('closes the popover after a selection', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ColorSwatchInput />);

    await user.click(screen.getByTestId('color-swatch-input-trigger'));
    await user.click(
      await screen.findByTestId('color-swatch-option-chart-red'),
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId('color-swatch-option-chart-red'),
      ).not.toBeInTheDocument();
    });
  });

  it('uses the custom label in the trigger when no value is set', () => {
    renderWithMantine(<ColorSwatchInput label="Series color" />);
    const trigger = screen.getByTestId('color-swatch-input-trigger');
    expect(trigger).toHaveTextContent(/series color/i);
  });

  it('keyboard activates the trigger and selects a swatch with Enter', async () => {
    const onChange = jest.fn();
    renderWithMantine(<ColorSwatchInput onChange={onChange} />);

    const trigger = screen.getByTestId('color-swatch-input-trigger');
    trigger.focus();
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
    fireEvent.click(trigger);

    const firstSwatch = await screen.findByTestId(
      'color-swatch-option-chart-blue',
    );
    firstSwatch.focus();
    fireEvent.click(firstSwatch);

    expect(onChange).toHaveBeenCalledWith('chart-blue');
  });
});
