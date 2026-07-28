import React from 'react';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

import DashboardTerraformPopover from '@/components/Iac/DashboardTerraformPopover';

function renderPopover() {
  return render(
    <MantineProvider>
      <DashboardTerraformPopover
        dashboardId="655b1b7d9143aa1b1b73f4f4"
        dashboardName="Usage"
      />
    </MantineProvider>,
  );
}

describe('DashboardTerraformPopover', () => {
  // The dropdown mounts through Mantine's `<Transition>`, which renders on a
  // subsequent tick — hence the async `findBy*` queries.
  it('opens on click and shows the import command for the dashboard', async () => {
    renderPopover();

    fireEvent.click(screen.getByTestId('terraform-popover-button'));

    expect(
      await screen.findByText(
        /terraform import clickhouse_clickstack_dashboard\.usage_3f4f4/,
      ),
    ).toBeInTheDocument();
  });

  it('stays closed until the trigger is clicked', () => {
    renderPopover();

    expect(
      screen.queryByTestId('terraform-helper-panel'),
    ).not.toBeInTheDocument();
  });

  // Import-only by design: generating `dashboard_json` from our own v2 read is
  // lossy (a surviving tile can still lose fields), and that attribute is a
  // whole-body replace, so emitting it would write the loss back on apply.
  it('never emits dashboard configuration, only the import command', async () => {
    renderPopover();

    fireEvent.click(screen.getByTestId('terraform-popover-button'));
    await screen.findByText(/terraform import/);

    expect(screen.queryByText(/dashboard_json/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Dashboard configuration/),
    ).not.toBeInTheDocument();
  });

  // Terraform allows one required_providers per module, so this boilerplate is
  // behind a toggle rather than pasted into every snippet.
  it('keeps the provider block collapsed behind a toggle', async () => {
    renderPopover();

    fireEvent.click(screen.getByTestId('terraform-popover-button'));

    // Mantine's <Collapse> keeps the child mounted and animates max-height +
    // visibility, and JSDOM runs no CSS transitions — so the canary is the
    // toggle label, which flips synchronously with React state.
    const toggle = await screen.findByText(/Show provider setup/);
    expect(screen.getByText(/required_providers/)).not.toBeVisible();

    fireEvent.click(toggle);

    expect(screen.getByText(/Hide provider setup/)).toBeInTheDocument();
    expect(screen.queryByText(/Show provider setup/)).not.toBeInTheDocument();
  });
});
