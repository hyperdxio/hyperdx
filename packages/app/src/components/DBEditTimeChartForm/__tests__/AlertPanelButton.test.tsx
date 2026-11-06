import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AlertPanelButton } from '@/components/DBEditTimeChartForm/AlertPanelButton';

describe('AlertPanelButton', () => {
  it("shows the alert's error over its warning", async () => {
    renderWithMantine(
      <AlertPanelButton
        hasAlert
        onAddAlert={jest.fn()}
        error="Missing time filter"
        warning="References $svc"
      />,
    );

    expect(screen.getByTestId('alert-button-issue-icon')).toBeInTheDocument();
    await userEvent.hover(screen.getByTestId('alert-button'));
    expect(await screen.findByText('Missing time filter')).toBeInTheDocument();
    expect(screen.queryByText('References $svc')).not.toBeInTheDocument();
  });

  it('flags nothing while the chart has no alert', () => {
    renderWithMantine(
      <AlertPanelButton
        hasAlert={false}
        onAddAlert={jest.fn()}
        error="Missing time filter"
      />,
    );

    expect(
      screen.queryByTestId('alert-button-issue-icon'),
    ).not.toBeInTheDocument();
  });
});
