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

  describe('fit y-axis to data setting', () => {
    it('shows the "Fit Y-Axis to Data" checkbox for line charts', () => {
      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...baseProps}
          displayType={DisplayType.Line}
        />,
      );

      expect(
        screen.getByRole('checkbox', { name: /fit y-axis to data/i }),
      ).toBeInTheDocument();
    });

    it('does not show the "Fit Y-Axis to Data" checkbox for table charts', () => {
      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...baseProps}
          displayType={DisplayType.Table}
        />,
      );

      expect(
        screen.queryByRole('checkbox', { name: /fit y-axis to data/i }),
      ).not.toBeInTheDocument();
    });

    it('defaults to unchecked (lower bound = 0)', () => {
      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...baseProps}
          displayType={DisplayType.Line}
        />,
      );

      expect(
        screen.getByRole('checkbox', { name: /fit y-axis to data/i }),
      ).not.toBeChecked();
    });

    it('calls onChange with fitYAxisToData = true when enabled and applied', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...baseProps}
          displayType={DisplayType.Line}
          onChange={onChange}
        />,
      );

      await user.click(
        screen.getByRole('checkbox', { name: /fit y-axis to data/i }),
      );
      await user.click(screen.getByRole('button', { name: /apply/i }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0]).toMatchObject({
        fitYAxisToData: true,
      });
    });
  });

  describe('series limit setting', () => {
    const builderProps = { ...baseProps, configType: 'builder' as const };

    it('shows the Series Limit input for builder line charts', () => {
      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...builderProps}
          displayType={DisplayType.Line}
        />,
      );

      expect(
        screen.getByRole('textbox', { name: /series limit/i }),
      ).toBeInTheDocument();
    });

    it('does not show the Series Limit input for raw SQL line charts', () => {
      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...baseProps}
          displayType={DisplayType.Line}
        />,
      );

      expect(
        screen.queryByRole('textbox', { name: /series limit/i }),
      ).not.toBeInTheDocument();
    });

    it('does not show the Series Limit input for table charts', () => {
      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...builderProps}
          displayType={DisplayType.Table}
        />,
      );

      expect(
        screen.queryByRole('textbox', { name: /series limit/i }),
      ).not.toBeInTheDocument();
    });

    it('calls onChange with the entered seriesLimit when applied', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...builderProps}
          displayType={DisplayType.Line}
          onChange={onChange}
        />,
      );

      await user.type(
        screen.getByRole('textbox', { name: /series limit/i }),
        '25',
      );
      await user.click(screen.getByRole('button', { name: /apply/i }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0]).toMatchObject({ seriesLimit: 25 });
    });

    // Emits null (not undefined) so the cleared/disabled state survives JSON
    // round-tripping through the URL query state; undefined would be dropped,
    // letting RHF's `values` sync restore the stale value.
    it('clears seriesLimit to null (disabled) when emptied', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...builderProps}
          displayType={DisplayType.Line}
          settings={{ seriesLimit: 10 } as ChartConfigDisplaySettings}
          onChange={onChange}
        />,
      );

      await user.clear(screen.getByRole('textbox', { name: /series limit/i }));
      await user.click(screen.getByRole('button', { name: /apply/i }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0].seriesLimit).toBeNull();
    });
  });

  describe('number format persistence', () => {
    // A duration number tile (e.g. p95 Duration from a trace source) auto-detects
    // a duration format from the datasource; the drawer receives it as
    // `defaultNumberFormat` and shows it as the fallback when no explicit
    // numberFormat is set.
    const durationFormat = { output: 'duration' as const, factor: 1e-9 };
    const numberBuilderProps = {
      ...baseProps,
      configType: 'builder' as const,
      displayType: DisplayType.Number,
    };

    it('does not persist the auto-detected format when Apply is clicked without changing it', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...numberBuilderProps}
          defaultNumberFormat={durationFormat}
          onChange={onChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: /apply/i }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0].numberFormat).toBeUndefined();
    });

    it('persists the format when the user changes the output format', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...numberBuilderProps}
          defaultNumberFormat={durationFormat}
          onChange={onChange}
        />,
      );

      await user.selectOptions(
        screen.getByRole('combobox', { name: /output format/i }),
        'number',
      );
      await user.click(screen.getByRole('button', { name: /apply/i }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0].numberFormat).toMatchObject({
        output: 'number',
      });
    });

    it('preserves an existing explicit format when only another setting changes', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...numberBuilderProps}
          settings={
            {
              numberFormat: { output: 'currency', currencySymbol: '$' },
            } as ChartConfigDisplaySettings
          }
          onChange={onChange}
        />,
      );

      // Change the tile color, not the format.
      await user.click(screen.getByTestId('color-swatch-input-trigger'));
      await user.click(
        await screen.findByTestId('color-swatch-option-chart-blue'),
      );
      await user.click(screen.getByRole('button', { name: /apply/i }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0]).toMatchObject({
        color: 'chart-blue',
        numberFormat: { output: 'currency' },
      });
    });

    // Switching the output to Duration on a tile whose source is a nanosecond
    // Duration column should seed the factor from the source precision (1e-9),
    // not keep the prior Seconds factor (which would read the value as seconds).
    it('seeds the duration factor from the source precision when output switches to Duration', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...numberBuilderProps}
          settings={
            {
              numberFormat: { output: 'number', factor: 1 },
            } as ChartConfigDisplaySettings
          }
          defaultNumberFormat={durationFormat}
          onChange={onChange}
        />,
      );

      await user.selectOptions(
        screen.getByRole('combobox', { name: /output format/i }),
        'duration',
      );
      await user.click(screen.getByRole('button', { name: /apply/i }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0].numberFormat).toMatchObject({
        output: 'duration',
        factor: 1e-9,
      });
    });

    // With no source-derived duration format (non-duration source), switching
    // to Duration must not force a factor; the prior value (Seconds = 1) stays
    // and the user picks the input unit manually as before.
    it('does not force a factor when no source duration format is available', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsDrawer
          {...numberBuilderProps}
          settings={
            {
              numberFormat: { output: 'number', factor: 1 },
            } as ChartConfigDisplaySettings
          }
          onChange={onChange}
        />,
      );

      await user.selectOptions(
        screen.getByRole('combobox', { name: /output format/i }),
        'duration',
      );
      await user.click(screen.getByRole('button', { name: /apply/i }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0].numberFormat).toMatchObject({
        output: 'duration',
        factor: 1,
      });
    });
  });
});
