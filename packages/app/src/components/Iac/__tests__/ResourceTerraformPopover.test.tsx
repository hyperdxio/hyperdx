import React from 'react';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

import ResourceTerraformPopover from '@/components/Iac/ResourceTerraformPopover';
import type { IacResourceRef } from '@/components/Iac/terraformSnippets';

const DASHBOARD: IacResourceRef = {
  type: 'dashboard',
  id: '655b1b7d9143aa1b1b73f4f4',
  name: 'Usage',
};

function renderPopover(resource: IacResourceRef = DASHBOARD) {
  return render(
    <MantineProvider>
      <ResourceTerraformPopover resource={resource} />
    </MantineProvider>,
  );
}

function openPopover(resource: IacResourceRef = DASHBOARD) {
  renderPopover(resource);
  fireEvent.click(
    screen.getByTestId(`terraform-popover-button-${resource.id}`),
  );
}

describe('ResourceTerraformPopover', () => {
  // The dropdown mounts through Mantine's `<Transition>`, which renders on a
  // subsequent tick — hence the async `findBy*` queries.
  it('opens on click and shows an import block for a dashboard', async () => {
    openPopover();

    expect(
      await screen.findByText(
        /to = clickhouse_clickstack_dashboard\.usage_3f4f4/,
      ),
    ).toBeInTheDocument();
  });

  // The CLI `terraform import` one-liner refuses to run unless the address is
  // already declared in configuration, and this feature generates none — so the
  // block form is the only one that works in a fresh project.
  it('emits the block form, not the CLI command', async () => {
    openPopover();

    expect(await screen.findByText(/^import \{/)).toBeInTheDocument();
    expect(screen.queryByText(/^terraform import /)).not.toBeInTheDocument();
  });

  it.each([
    ['alert', 'clickhouse_clickstack_alert.too_many_errors_3f4f6'],
    [
      'saved_search',
      'clickhouse_clickstack_saved_search.too_many_errors_3f4f6',
    ],
  ] as const)('emits the %s resource type', async (type, expected) => {
    openPopover({
      type,
      id: '655b1b7d9143aa1b1b73f4f6',
      name: 'Too many errors',
    });

    expect(await screen.findByText(new RegExp(expected))).toBeInTheDocument();
  });

  it('stays closed until the trigger is clicked', () => {
    renderPopover();

    expect(
      screen.queryByTestId('terraform-helper-panel'),
    ).not.toBeInTheDocument();
  });

  it('never emits resource configuration', async () => {
    openPopover();
    await screen.findByText(/^import \{/);

    expect(screen.queryByText(/dashboard_json/)).not.toBeInTheDocument();
  });

  it('surfaces the rename caveat alongside the import block', async () => {
    openPopover();

    expect(
      await screen.findByText(/if you rename it later/),
    ).toBeInTheDocument();
  });

  // Terraform allows one required_providers per module, so this boilerplate is
  // behind a toggle rather than pasted into every snippet.
  it('keeps the provider block collapsed behind a toggle', async () => {
    openPopover();

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
