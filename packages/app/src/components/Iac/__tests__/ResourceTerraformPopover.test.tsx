import React from 'react';
import type { IacResourceRef } from '@hyperdx/common-utils/dist/iac';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

import ResourceTerraformPopover from '@/components/Iac/ResourceTerraformPopover';

const TEAM_ID = '7a1c0de5b2f34c9d8e0a1b2c';

// Same getter trick as the config mock below: `mock` prefix so the hoisted
// factory may close over it, and one test blanks it to stand in for a `me`
// that has not resolved yet.
let mockMeTeamId: string | undefined = TEAM_ID;
jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: () => ({
      data: mockMeTeamId ? { team: { id: mockMeTeamId } } : undefined,
    }),
  },
}));

// A getter, not a literal: the component reads the binding at render time, so
// this lets one test flip the gate without re-requiring React.
let iacExportEnabled = true;
let basePath = '';
jest.mock('@/config', () => ({
  ...jest.requireActual('@/config'),
  get IS_IAC_EXPORT_ENABLED() {
    return iacExportEnabled;
  },
  get BASE_PATH() {
    return basePath;
  },
}));

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
  beforeEach(() => {
    iacExportEnabled = true;
    basePath = '';
    mockMeTeamId = TEAM_ID;
  });

  // The dropdown mounts through Mantine's `<Transition>`, which renders on a
  // subsequent tick — hence the async `findBy*` queries.
  it('opens on click and shows an import block for a dashboard', async () => {
    openPopover();

    expect(
      await screen.findByText(
        /to = clickhouse_clickstack_dashboard\.dashboard_655b1b7d9143aa1b1b73f4f4/,
      ),
    ).toBeInTheDocument();
  });

  // The address stays id-only, but the import id is team-scoped: on ClickHouse
  // Cloud one service can back several teams.
  it('scopes the import id to the team', async () => {
    openPopover();

    expect(
      await screen.findByText(new RegExp(`id = "${TEAM_ID}/${DASHBOARD.id}"`)),
    ).toBeInTheDocument();
  });

  it('shows no snippets until the team is known', async () => {
    mockMeTeamId = undefined;

    openPopover();

    // Await the panel before asserting absence. The dropdown mounts a tick
    // later, so a synchronous queryByText passes whether or not the guard
    // works — the panel testid is the anchor that makes this test able to fail.
    await screen.findByTestId('terraform-helper-panel');
    expect(screen.queryByText(/^# Usage import \{/)).not.toBeInTheDocument();
  });

  // The CLI `terraform import` one-liner refuses to run unless the address is
  // already declared in configuration, and this feature generates none — so the
  // block form is the only one that works in a fresh project.
  it('emits the block form, not the CLI command', async () => {
    openPopover();

    expect(await screen.findByText(/^# Usage import \{/)).toBeInTheDocument();
    expect(screen.queryByText(/^terraform import /)).not.toBeInTheDocument();
  });

  it.each([
    ['alert', 'clickhouse_clickstack_alert.alert_655b1b7d9143aa1b1b73f4f6'],
    [
      'saved_search',
      'clickhouse_clickstack_saved_search.saved_search_655b1b7d9143aa1b1b73f4f6',
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

  // Gating lives in this component rather than at each call site, so this
  // one assertion covers all of them — including local mode,
  // which has no API server for the provider to talk to.
  it('renders nothing when the export is disabled', () => {
    iacExportEnabled = false;

    renderPopover();

    expect(
      screen.queryByTestId(`terraform-popover-button-${DASHBOARD.id}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('terraform-helper-panel'),
    ).not.toBeInTheDocument();
  });

  it('never emits resource configuration', async () => {
    openPopover();
    await screen.findByText(/^# Usage import \{/);

    expect(screen.queryByText(/dashboard_json/)).not.toBeInTheDocument();
  });

  // Addresses are id-derived, so a rename is a non-event. The hint has to say
  // so — the previous wording told users to add a `moved` block.
  it('tells the user the address survives a rename', async () => {
    openPopover();

    expect(
      await screen.findByText(/survives a rename in HyperDX/),
    ).toBeInTheDocument();
  });

  // This surface and the bulk export had drifted here: one included the
  // deployment path prefix and the other did not, so on a prefixed deployment
  // one of them emitted an endpoint that could not reach the API. Both now go
  // through providerEndpoint, and this pins the call site so they cannot drift
  // apart again.
  it('includes the deployment path prefix in the provider endpoint', async () => {
    basePath = '/hyperdx';
    openPopover();

    const toggle = await screen.findByText(/Show provider setup/);
    fireEvent.click(toggle);

    expect(screen.getByText(/clickstack_endpoint/)).toHaveTextContent(
      '/hyperdx/api',
    );
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
