import * as React from 'react';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

import { DashboardViewOptions } from '@/components/DashboardViewOptions';

function renderViewOptions(
  props: Partial<React.ComponentProps<typeof DashboardViewOptions>> = {},
) {
  const defaults: React.ComponentProps<typeof DashboardViewOptions> = {
    onCollapseAll: jest.fn(),
    onExpandAll: jest.fn(),
    tocVisible: false,
    onToggleToc: jest.fn(),
    ...props,
  };
  return render(
    <MantineProvider>
      <DashboardViewOptions {...defaults} />
    </MantineProvider>,
  );
}

describe('DashboardViewOptions', () => {
  it('renders the toolbar trigger button', () => {
    renderViewOptions();
    expect(screen.getByTestId('dashboard-view-options')).toBeInTheDocument();
  });

  it('opens the menu with collapse/expand/toc items when the trigger is clicked', async () => {
    renderViewOptions();
    fireEvent.click(screen.getByTestId('dashboard-view-options'));

    expect(
      await screen.findByTestId('dashboard-collapse-all'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-expand-all')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-toggle-toc')).toBeInTheDocument();
  });

  it('invokes onCollapseAll when "Collapse all sections" is clicked', async () => {
    const onCollapseAll = jest.fn();
    renderViewOptions({ onCollapseAll });
    fireEvent.click(screen.getByTestId('dashboard-view-options'));
    fireEvent.click(await screen.findByTestId('dashboard-collapse-all'));
    expect(onCollapseAll).toHaveBeenCalledTimes(1);
  });

  it('invokes onExpandAll when "Expand all sections" is clicked', async () => {
    const onExpandAll = jest.fn();
    renderViewOptions({ onExpandAll });
    fireEvent.click(screen.getByTestId('dashboard-view-options'));
    fireEvent.click(await screen.findByTestId('dashboard-expand-all'));
    expect(onExpandAll).toHaveBeenCalledTimes(1);
  });

  it('shows "Show table of contents" label when tocVisible is false', async () => {
    renderViewOptions({ tocVisible: false });
    fireEvent.click(screen.getByTestId('dashboard-view-options'));
    expect(
      await screen.findByText('Show table of contents'),
    ).toBeInTheDocument();
  });

  it('shows "Hide table of contents" label when tocVisible is true', async () => {
    renderViewOptions({ tocVisible: true });
    fireEvent.click(screen.getByTestId('dashboard-view-options'));
    expect(
      await screen.findByText('Hide table of contents'),
    ).toBeInTheDocument();
  });

  it('invokes onToggleToc when the toc menu item is clicked', async () => {
    const onToggleToc = jest.fn();
    renderViewOptions({ onToggleToc });
    fireEvent.click(screen.getByTestId('dashboard-view-options'));
    fireEvent.click(await screen.findByTestId('dashboard-toggle-toc'));
    expect(onToggleToc).toHaveBeenCalledTimes(1);
  });
});
