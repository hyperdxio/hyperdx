import React from 'react';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ChartDisplaySettingsSection, {
  ChartConfigDisplaySettings,
} from '@/components/ChartDisplaySettingsDrawer';

// Mantine's Combobox (used by the number format Select) calls scrollIntoView
// when its dropdown opens; jsdom lacks it.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

// FormatTime depends on useUserPreferences (jotai + localStorage); mock it
// so the section renders in isolation.
jest.mock('@/useFormatTime', () => ({
  FormatTime: jest.fn(() => null),
}));

// The Display section writes live (debounced) to the tile draft — there is no
// Apply button — so assertions wait for the latest onChange payload.
const lastOnChangeArg = (onChange: jest.Mock) =>
  onChange.mock.calls[onChange.mock.calls.length - 1][0];

describe('ChartDisplaySettingsSection', () => {
  const baseProps = {
    configType: 'sql' as const,
    settings: {} as ChartConfigDisplaySettings,
    onChange: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('color picker section', () => {
    it('shows the color picker when displayType is Number', () => {
      renderWithMantine(
        <ChartDisplaySettingsSection
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
        <ChartDisplaySettingsSection
          {...baseProps}
          displayType={DisplayType.Table}
        />,
      );

      expect(
        screen.queryByTestId('color-swatch-input-trigger'),
      ).not.toBeInTheDocument();
    });

    it('writes the selected color token live', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsSection
          {...baseProps}
          displayType={DisplayType.Number}
          onChange={onChange}
        />,
      );

      await user.click(screen.getByTestId('color-swatch-input-trigger'));
      await user.click(
        await screen.findByTestId('color-swatch-option-chart-blue'),
      );

      await waitFor(() =>
        expect(lastOnChangeArg(onChange)).toMatchObject({
          color: 'chart-blue',
        }),
      );
    });

    it('writes a semantic color token live', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsSection
          {...baseProps}
          displayType={DisplayType.Number}
          onChange={onChange}
        />,
      );

      await user.click(screen.getByTestId('color-swatch-input-trigger'));
      await user.click(
        await screen.findByTestId('color-swatch-option-chart-success'),
      );

      await waitFor(() =>
        expect(lastOnChangeArg(onChange)).toMatchObject({
          color: 'chart-success',
        }),
      );
    });
  });

  describe('fit y-axis to data setting', () => {
    it('shows the "Fit Y-Axis to Data" checkbox for line charts', () => {
      renderWithMantine(
        <ChartDisplaySettingsSection
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
        <ChartDisplaySettingsSection
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
        <ChartDisplaySettingsSection
          {...baseProps}
          displayType={DisplayType.Line}
        />,
      );

      expect(
        screen.getByRole('checkbox', { name: /fit y-axis to data/i }),
      ).not.toBeChecked();
    });

    it('writes fitYAxisToData = true live when enabled', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsSection
          {...baseProps}
          displayType={DisplayType.Line}
          onChange={onChange}
        />,
      );

      await user.click(
        screen.getByRole('checkbox', { name: /fit y-axis to data/i }),
      );

      await waitFor(() =>
        expect(lastOnChangeArg(onChange)).toMatchObject({
          fitYAxisToData: true,
        }),
      );
    });
  });

  describe('series limit setting', () => {
    const builderProps = { ...baseProps, configType: 'builder' as const };

    it('shows the Series Limit input for builder line charts', () => {
      renderWithMantine(
        <ChartDisplaySettingsSection
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
        <ChartDisplaySettingsSection
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
        <ChartDisplaySettingsSection
          {...builderProps}
          displayType={DisplayType.Table}
        />,
      );

      expect(
        screen.queryByRole('textbox', { name: /series limit/i }),
      ).not.toBeInTheDocument();
    });

    it('writes the entered seriesLimit live', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsSection
          {...builderProps}
          displayType={DisplayType.Line}
          onChange={onChange}
        />,
      );

      await user.type(
        screen.getByRole('textbox', { name: /series limit/i }),
        '25',
      );

      await waitFor(() =>
        expect(lastOnChangeArg(onChange)).toMatchObject({ seriesLimit: 25 }),
      );
    });

    // Emits null (not undefined) so the cleared/disabled state survives JSON
    // round-tripping through the URL query state; undefined would be dropped,
    // letting RHF's `values` sync restore the stale value.
    it('clears seriesLimit to null (disabled) when emptied', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsSection
          {...builderProps}
          displayType={DisplayType.Line}
          settings={{ seriesLimit: 10 } as ChartConfigDisplaySettings}
          onChange={onChange}
        />,
      );

      await user.clear(screen.getByRole('textbox', { name: /series limit/i }));

      await waitFor(() =>
        expect(lastOnChangeArg(onChange).seriesLimit).toBeNull(),
      );
    });
  });

  describe('categorical series limit setting (pie/bar)', () => {
    const builderProps = { ...baseProps, configType: 'builder' as const };

    it.each([DisplayType.Pie, DisplayType.Bar])(
      'shows the Series Limit input for builder %s charts',
      displayType => {
        renderWithMantine(
          <ChartDisplaySettingsSection
            {...builderProps}
            displayType={displayType}
          />,
        );

        expect(
          screen.getByRole('textbox', { name: /series limit/i }),
        ).toBeInTheDocument();
      },
    );

    it('does not show the Series Limit input for raw SQL pie charts', () => {
      renderWithMantine(
        <ChartDisplaySettingsSection
          {...baseProps}
          displayType={DisplayType.Pie}
        />,
      );

      expect(
        screen.queryByRole('textbox', { name: /series limit/i }),
      ).not.toBeInTheDocument();
    });

    it('writes the entered seriesLimit live', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsSection
          {...builderProps}
          displayType={DisplayType.Bar}
          onChange={onChange}
        />,
      );

      await user.type(
        screen.getByRole('textbox', { name: /series limit/i }),
        '10',
      );

      await waitFor(() =>
        expect(lastOnChangeArg(onChange)).toMatchObject({ seriesLimit: 10 }),
      );
    });

    // Emits null (not undefined) for the same URL round-tripping reason as
    // the time-chart series limit above.
    it('clears seriesLimit to null (disabled) when emptied', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsSection
          {...builderProps}
          displayType={DisplayType.Pie}
          settings={{ seriesLimit: 10 } as ChartConfigDisplaySettings}
          onChange={onChange}
        />,
      );

      await user.clear(screen.getByRole('textbox', { name: /series limit/i }));

      await waitFor(() =>
        expect(lastOnChangeArg(onChange).seriesLimit).toBeNull(),
      );
    });
  });

  describe('alternate row background setting', () => {
    const builderProps = { ...baseProps, configType: 'builder' as const };

    it('shows the toggle for builder table charts', () => {
      renderWithMantine(
        <ChartDisplaySettingsSection
          {...builderProps}
          displayType={DisplayType.Table}
        />,
      );

      expect(
        screen.getByRole('checkbox', { name: /alternate row background/i }),
      ).toBeInTheDocument();
    });

    it('shows the toggle for raw SQL table charts', () => {
      renderWithMantine(
        <ChartDisplaySettingsSection
          {...baseProps}
          displayType={DisplayType.Table}
        />,
      );

      expect(
        screen.getByRole('checkbox', { name: /alternate row background/i }),
      ).toBeInTheDocument();
    });

    it('does not show the toggle for line charts', () => {
      renderWithMantine(
        <ChartDisplaySettingsSection
          {...builderProps}
          displayType={DisplayType.Line}
        />,
      );

      expect(
        screen.queryByRole('checkbox', { name: /alternate row background/i }),
      ).not.toBeInTheDocument();
    });

    it('does not show the toggle for number tiles', () => {
      renderWithMantine(
        <ChartDisplaySettingsSection
          {...builderProps}
          displayType={DisplayType.Number}
        />,
      );

      expect(
        screen.queryByRole('checkbox', { name: /alternate row background/i }),
      ).not.toBeInTheDocument();
    });

    it('writes alternateRowBackground = true live when enabled', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsSection
          {...builderProps}
          displayType={DisplayType.Table}
          onChange={onChange}
        />,
      );

      await user.click(
        screen.getByRole('checkbox', { name: /alternate row background/i }),
      );

      await waitFor(() =>
        expect(lastOnChangeArg(onChange)).toMatchObject({
          alternateRowBackground: true,
        }),
      );
    });

    it('writes alternateRowBackground = true live for raw SQL table charts', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsSection
          {...baseProps}
          displayType={DisplayType.Table}
          onChange={onChange}
        />,
      );

      await user.click(
        screen.getByRole('checkbox', { name: /alternate row background/i }),
      );

      await waitFor(() =>
        expect(lastOnChangeArg(onChange)).toMatchObject({
          alternateRowBackground: true,
        }),
      );
    });
  });

  describe('display group by columns on left setting', () => {
    const builderProps = { ...baseProps, configType: 'builder' as const };

    it('shows the toggle for builder table charts', () => {
      renderWithMantine(
        <ChartDisplaySettingsSection
          {...builderProps}
          displayType={DisplayType.Table}
        />,
      );

      expect(
        screen.getByRole('checkbox', {
          name: /display group by columns on left/i,
        }),
      ).toBeInTheDocument();
    });

    it('does not show the toggle for raw SQL table charts', () => {
      renderWithMantine(
        <ChartDisplaySettingsSection
          {...baseProps}
          displayType={DisplayType.Table}
        />,
      );

      // Group By ordering needs the builder select structure, so it stays
      // builder-only even though Alternate Row Background is shown for SQL.
      expect(
        screen.queryByRole('checkbox', {
          name: /display group by columns on left/i,
        }),
      ).not.toBeInTheDocument();
    });
  });

  describe('number format persistence', () => {
    // A duration number tile (e.g. p95 Duration from a trace source) auto-detects
    // a duration format from the datasource; the section receives it as
    // `defaultNumberFormat` and shows it as the fallback when no explicit
    // numberFormat is set.
    const durationFormat = { output: 'duration' as const, factor: 1e-9 };
    const numberBuilderProps = {
      ...baseProps,
      configType: 'builder' as const,
      displayType: DisplayType.Number,
    };

    it('does not persist the auto-detected format when only another setting changes', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsSection
          {...numberBuilderProps}
          defaultNumberFormat={durationFormat}
          onChange={onChange}
        />,
      );

      // Change the color, never touch the format.
      await user.click(screen.getByTestId('color-swatch-input-trigger'));
      await user.click(
        await screen.findByTestId('color-swatch-option-chart-blue'),
      );

      await waitFor(() => expect(onChange).toHaveBeenCalled());
      expect(lastOnChangeArg(onChange).numberFormat).toBeUndefined();
    });

    it('persists the format when the user changes the output format', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsSection
          {...numberBuilderProps}
          defaultNumberFormat={durationFormat}
          onChange={onChange}
        />,
      );

      await user.click(
        screen.getByRole('combobox', { name: /output format/i }),
      );
      await user.click(
        await screen.findByRole('option', { name: 'Number', hidden: true }),
      );

      await waitFor(() =>
        expect(lastOnChangeArg(onChange).numberFormat).toMatchObject({
          output: 'number',
        }),
      );
    });

    it('preserves an existing explicit format when only another setting changes', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsSection
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

      await waitFor(() =>
        expect(lastOnChangeArg(onChange)).toMatchObject({
          color: 'chart-blue',
          numberFormat: { output: 'currency' },
        }),
      );
    });
  });

  describe('reset to defaults', () => {
    it('emits default settings when Reset to Defaults is clicked', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <ChartDisplaySettingsSection
          {...baseProps}
          configType="builder"
          displayType={DisplayType.Line}
          settings={{ seriesLimit: 10 } as ChartConfigDisplaySettings}
          onChange={onChange}
        />,
      );

      await user.click(
        screen.getByRole('button', { name: /reset to defaults/i }),
      );

      await waitFor(() =>
        expect(lastOnChangeArg(onChange).seriesLimit).toBeNull(),
      );
    });
  });
});
