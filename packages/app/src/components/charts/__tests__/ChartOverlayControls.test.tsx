import React from 'react';
import { fireEvent, screen } from '@testing-library/react';

import { ChartOverlayControls } from '@/components/charts/ChartOverlayControls';

describe('ChartOverlayControls', () => {
  it('renders nothing when neither handler is provided', () => {
    renderWithMantine(<ChartOverlayControls />);

    expect(
      screen.queryByTestId('chart-clear-series-selection'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Reset zoom/i }),
    ).not.toBeInTheDocument();
  });

  it('renders only "Show All Series" when only onClearSelection is provided', () => {
    const onClearSelection = jest.fn();
    renderWithMantine(
      <ChartOverlayControls onClearSelection={onClearSelection} />,
    );

    const button = screen.getByTestId('chart-clear-series-selection');
    expect(button).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Reset zoom/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('renders only "Reset zoom" when only onResetZoom is provided', () => {
    const onResetZoom = jest.fn();
    renderWithMantine(<ChartOverlayControls onResetZoom={onResetZoom} />);

    const button = screen.getByRole('button', { name: /Reset zoom/i });
    expect(button).toBeInTheDocument();
    expect(
      screen.queryByTestId('chart-clear-series-selection'),
    ).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(onResetZoom).toHaveBeenCalledTimes(1);
  });

  it('renders both buttons when both handlers are provided', () => {
    renderWithMantine(
      <ChartOverlayControls
        onClearSelection={() => {}}
        onResetZoom={() => {}}
      />,
    );

    expect(
      screen.getByTestId('chart-clear-series-selection'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Reset zoom/i }),
    ).toBeInTheDocument();
  });
});
