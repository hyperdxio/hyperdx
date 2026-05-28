import React from 'react';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ChartDisplaySettingsDrawer, {
  ChartConfigDisplaySettings,
} from '../ChartDisplaySettingsDrawer';

// FormatTime depends on useUserPreferences (jotai + localStorage); mock it
// so the drawer renders in isolation.
jest.mock('@/useFormatTime', () => ({
  FormatTime: jest.fn(() => null),
}));

describe('ChartDisplaySettingsDrawer', () => {
  const baseProps = {
    opened: true,
    configType: 'sql' as const,
    settings: {} as ChartConfigDisplaySettings,
    onChange: jest.fn(),
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('color picker section', () => {
    it('shows the color picker when displayType is Number', () => {
      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...baseProps}
          displayType={DisplayType.Number}
        />,
      );

      expect(
        screen.getByTestId('color-swatch-input-trigger'),
      ).toBeInTheDocument();
    });

    it('does not show the color picker when displayType is Table', () => {
      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...baseProps}
          displayType={DisplayType.Table}
        />,
      );

      expect(
        screen.queryByTestId('color-swatch-input-trigger'),
      ).not.toBeInTheDocument();
    });

    it('calls onChange with the selected color token when Apply is clicked', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...baseProps}
          displayType={DisplayType.Number}
          onChange={onChange}
        />,
      );

      // Open the palette popover.
      await user.click(screen.getByTestId('color-swatch-input-trigger'));

      // Pick a categorical token.
      const swatch = await screen.findByTestId(
        'color-swatch-option-chart-blue',
      );
      await user.click(swatch);

      // Verify the trigger shows the selected token.
      const trigger = screen.getByTestId('color-swatch-input-trigger');
      expect(trigger).toHaveTextContent(/blue/i);

      // Apply the settings.
      await user.click(screen.getByRole('button', { name: /apply/i }));

      expect(onChange).toHaveBeenCalledTimes(1);
      // react-hook-form passes (values, event) to the onSubmit handler;
      // check the values argument directly.
      expect(onChange.mock.calls[0][0]).toMatchObject({ color: 'chart-blue' });
    });

    it('calls onChange with a semantic token when Apply is clicked', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...baseProps}
          displayType={DisplayType.Number}
          onChange={onChange}
        />,
      );

      await user.click(screen.getByTestId('color-swatch-input-trigger'));
      await user.click(
        await screen.findByTestId('color-swatch-option-chart-success'),
      );
      await user.click(screen.getByRole('button', { name: /apply/i }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0]).toMatchObject({
        color: 'chart-success',
      });
    });
  });
});
