import React from 'react';
import { randomUUID } from 'crypto';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SeriesColorPopover from '@/components/SeriesColorPopover';

// The jsdom test environment may not expose crypto.randomUUID, which
// ColorRulesEditor uses for stable dnd keys. Back it with Node's
// implementation when absent so the rules path is deterministic.
if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: {},
    configurable: true,
  });
}
if (typeof globalThis.crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: randomUUID,
    configurable: true,
  });
}

describe('SeriesColorPopover', () => {
  it('writes the picked static color live (no Apply)', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    renderWithMantine(<SeriesColorPopover onChange={onChange} />);

    await user.click(screen.getByTestId('series-color-button'));
    expect(
      await screen.findByTestId('series-color-popover'),
    ).toBeInTheDocument();
    // There is no Apply button — edits commit to the draft immediately.
    expect(screen.queryByTestId('series-color-apply')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('color-swatch-input-trigger'));
    await user.click(
      await screen.findByTestId('color-swatch-option-chart-blue'),
    );

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ color: 'chart-blue' }),
      ),
    );
  });

  it('clears color and rules live when Clear is clicked', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    renderWithMantine(
      <SeriesColorPopover color="chart-error" onChange={onChange} />,
    );

    await user.click(screen.getByTestId('series-color-button'));
    await user.click(await screen.findByTestId('series-color-clear'));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        color: undefined,
        colorRules: undefined,
      }),
    );
  });
});
