import * as React from 'react';
import {
  AlertSource,
  AlertThresholdType,
} from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AlertRowMenu } from '@/components/alerts/AlertRowMenu';
import type { AlertsPageItem } from '@/types';

const mutateAsync = jest.fn().mockResolvedValue({});

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useDeleteAlert: () => ({ mutateAsync }),
    // Literal, not TEAM_ID below: jest hoists this factory above the consts.
    useMe: () => ({ data: { team: { id: '7a1c0de5b2f34c9d8e0a1b2c' } } }),
    getAlertsQueryKey: () => ['alerts'],
  },
}));

jest.mock('@/config', () => ({
  IS_IAC_EXPORT_ENABLED: true,
  BASE_PATH: '',
}));

// The edit modal pulls in the whole alert form (queries, editors, target
// picker); this suite is about the menu, so stub it down to an open/closed
// marker.
jest.mock('@/components/alerts/EditAlertModal', () => ({
  EditAlertModal: ({ opened }: { opened: boolean }) =>
    opened ? <div data-testid="edit-alert-modal" /> : null,
}));

const confirm = jest.fn().mockResolvedValue(true);
jest.mock('@/useConfirm', () => ({ useConfirm: () => confirm }));
jest.mock('@/theme/ThemeProvider', () => ({
  useBrandDisplayName: () => 'HyperDX',
}));

// ObjectId hex: buildImportBlock refuses to emit Terraform for anything else,
// so a placeholder id would throw the moment the export panel opens.
const TILE_ALERT_ID = '655b1b7d9143aa1b1b73f4f4';

const savedSearchAlert = {
  _id: 'alert-1',
  interval: '5m',
  threshold: 1,
  thresholdType: AlertThresholdType.ABOVE,
  source: AlertSource.SAVED_SEARCH,
  savedSearchId: 'saved-search-1',
  channel: { type: 'webhook', webhookId: 'hook-1' },
  note: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  history: [],
} as unknown as AlertsPageItem;

const tileAlert = {
  ...savedSearchAlert,
  _id: 'alert-2',
  source: AlertSource.TILE,
  savedSearchId: undefined,
  dashboardId: 'dashboard-1',
  tileId: 'tile-1',
} as unknown as AlertsPageItem;

// The server decides whether a tile alert's tile can be addressed in
// generated Terraform, because this response carries only the alert's own
// tile — see isTileAlertUnaddressable.
const unaddressableTileAlert: AlertsPageItem = {
  ...tileAlert,
  _id: 'alert-4',
  unaddressableTile: true,
};

function renderMenu(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );
}

// Wait for the dropdown itself: Mantine mounts it through a transition, so a
// bare click leaves the items absent and every "item is missing" assertion
// passes for the wrong reason.
// openMenu alone waits up to 5s for the dropdown, which is the whole default
// per-test budget — under parallel workers a slow transition times out the
// test before its assertions run. Give every test in this file headroom above
// that internal wait.
jest.setTimeout(15_000);

const openMenu = async (testId: string) => {
  await userEvent.click(screen.getByTestId(testId));
  // Generous timeout: the transition competes with the rest of the suite
  // under parallel workers, and a 1s default flaked there.
  await screen.findByRole('menu', undefined, { timeout: 5000 });
};

describe('AlertRowMenu', () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    confirm.mockClear();
  });

  // The whole point of the menu: the row's trailing control is unconditional
  // even when everything inside it is gated.
  it('renders for an alert with no source link and no import eligibility', () => {
    renderMenu(<AlertRowMenu alert={unaddressableTileAlert} />);

    expect(screen.getByTestId('alert-row-menu-alert-4')).toBeInTheDocument();
  });

  it('opens the edit modal from the menu', async () => {
    renderMenu(<AlertRowMenu alert={savedSearchAlert} />);

    expect(screen.queryByTestId('edit-alert-modal')).not.toBeInTheDocument();
    await openMenu('alert-row-menu-alert-1');
    // Same rationale as openMenu's own wait: under parallel workers the
    // dropdown's transition can lag behind the menu role appearing.
    const editItem = await screen.findByTestId(
      'alert-edit-alert-1',
      undefined,
      {
        timeout: 5000,
      },
    );
    await userEvent.click(editItem);

    expect(
      await screen.findByTestId('edit-alert-modal', undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
  });

  it('offers Terraform export for a saved-search alert', async () => {
    renderMenu(<AlertRowMenu alert={savedSearchAlert} />);
    await openMenu('alert-row-menu-alert-1');

    expect(
      screen.getByTestId('terraform-menu-item-alert-1'),
    ).toBeInTheDocument();
  });

  // `source = "tile"` only exists in provider 3.26.0, so the snippets this
  // path generates have to ask for it — the bulk export's floor is asserted
  // separately and the two must not drift.
  it('offers Terraform export for a tile alert and asks for the tile-alert provider', async () => {
    renderMenu(<AlertRowMenu alert={{ ...tileAlert, _id: TILE_ALERT_ID }} />);
    await openMenu(`alert-row-menu-${TILE_ALERT_ID}`);
    const item = await screen.findByTestId(
      `terraform-menu-item-${TILE_ALERT_ID}`,
      undefined,
      { timeout: 5000 },
    );
    await userEvent.click(item);

    expect(
      await screen.findByText(/version\s+= ">= 3.26.0"/, undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
  });

  // A tile with a blank or duplicated name is absent from the provider's
  // `tile_ids` map, so the alert could only be pinned to a literal id the next
  // dashboard apply can re-mint.
  it('withholds Terraform export for an unaddressable tile alert', async () => {
    renderMenu(<AlertRowMenu alert={unaddressableTileAlert} />);
    await openMenu('alert-row-menu-alert-4');

    // Assert a sibling item is present too, so this cannot pass by the menu
    // simply having failed to open.
    expect(screen.getByTestId('alert-delete-alert-4')).toBeInTheDocument();
    expect(
      screen.queryByTestId('terraform-menu-item-alert-4'),
    ).not.toBeInTheDocument();
  });

  it('shows the source link only when one resolves', async () => {
    renderMenu(
      <AlertRowMenu
        alert={savedSearchAlert}
        alertUrl="/search/saved-search-1"
        linkTitle="Saved search"
      />,
    );
    await openMenu('alert-row-menu-alert-1');

    expect(screen.getByText('Open saved search')).toBeInTheDocument();
  });

  it('names the alert in the delete confirmation', async () => {
    renderMenu(
      <AlertRowMenu alert={savedSearchAlert} alertName="Prod EKS Events" />,
    );
    await openMenu('alert-row-menu-alert-1');
    await userEvent.click(screen.getByTestId('alert-delete-alert-1'));

    expect(confirm).toHaveBeenCalledWith(
      'Delete Prod EKS Events?',
      'Delete',
      expect.objectContaining({ variant: 'danger' }),
    );
    expect(mutateAsync).toHaveBeenCalledWith('alert-1');
  });

  // getAlertDisplayName and linkTitle both return '' for an alert whose source
  // can't be resolved, and '' is not nullish — so `??` would have produced
  // "Delete ?" and "Open ".
  it('falls back to generic wording when the name and source are empty', async () => {
    renderMenu(
      <AlertRowMenu
        alert={savedSearchAlert}
        alertName=""
        alertUrl="/search/saved-search-1"
        linkTitle=""
      />,
    );
    await openMenu('alert-row-menu-alert-1');
    await userEvent.click(screen.getByTestId('alert-delete-alert-1'));

    expect(confirm).toHaveBeenCalledWith(
      'Delete this alert?',
      'Delete',
      expect.anything(),
    );
    expect(screen.getByText('Open source')).toBeInTheDocument();
  });

  it('labels the menu button with the alert name', () => {
    renderMenu(
      <AlertRowMenu alert={savedSearchAlert} alertName="Prod EKS Events" />,
    );

    expect(
      screen.getByRole('button', { name: 'Actions for Prod EKS Events' }),
    ).toBeInTheDocument();
  });

  it('does not delete when the confirmation is declined', async () => {
    confirm.mockResolvedValueOnce(false);
    renderMenu(<AlertRowMenu alert={savedSearchAlert} />);
    await openMenu('alert-row-menu-alert-1');
    await userEvent.click(screen.getByTestId('alert-delete-alert-1'));

    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
