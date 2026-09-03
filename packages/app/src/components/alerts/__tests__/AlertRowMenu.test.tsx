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
    useMe: () => ({ data: { team: { id: 'team-1' } } }),
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

// The inline editor mounts the whole chart editor; this suite only cares
// which of the two modals the menu opens.
jest.mock('@/components/alerts/EditInlineAlertModal', () => ({
  EditInlineAlertModal: ({ opened }: { opened: boolean }) =>
    opened ? <div data-testid="edit-inline-alert-modal" /> : null,
}));

const confirm = jest.fn().mockResolvedValue(true);
jest.mock('@/useConfirm', () => ({ useConfirm: () => confirm }));
jest.mock('@/theme/ThemeProvider', () => ({
  useBrandDisplayName: () => 'HyperDX',
}));

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

const inlineAlert = {
  ...savedSearchAlert,
  _id: 'alert-3',
  source: AlertSource.INLINE,
  savedSearchId: undefined,
  name: 'Prod error rate',
} as unknown as AlertsPageItem;

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
    renderMenu(<AlertRowMenu alert={tileAlert} />);

    expect(screen.getByTestId('alert-row-menu-alert-2')).toBeInTheDocument();
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

  // An inline alert owns its query, so the field-only modal cannot edit it —
  // and saving through it would rewrite the alert without its chart config.
  it('opens the chart editor for an inline alert', async () => {
    renderMenu(<AlertRowMenu alert={inlineAlert} />);
    await openMenu('alert-row-menu-alert-3');
    await userEvent.click(
      await screen.findByTestId('alert-edit-alert-3', undefined, {
        timeout: 5000,
      }),
    );

    expect(
      await screen.findByTestId('edit-inline-alert-modal', undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('edit-alert-modal')).not.toBeInTheDocument();
  });

  it('offers Terraform export for a saved-search alert', async () => {
    renderMenu(<AlertRowMenu alert={savedSearchAlert} />);
    await openMenu('alert-row-menu-alert-1');

    expect(
      screen.getByTestId('terraform-menu-item-alert-1'),
    ).toBeInTheDocument();
  });

  // Tile alerts have no Terraform resource, so offering import would generate
  // a block that cannot apply.
  it('withholds Terraform export for a tile alert', async () => {
    renderMenu(<AlertRowMenu alert={tileAlert} />);
    await openMenu('alert-row-menu-alert-2');

    // Assert a sibling item is present too, so this cannot pass by the menu
    // simply having failed to open.
    expect(screen.getByTestId('alert-delete-alert-2')).toBeInTheDocument();
    expect(
      screen.queryByTestId('terraform-menu-item-alert-2'),
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

  // linkTitle returns '' for an alert whose source
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
