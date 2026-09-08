import type { ComponentProps } from 'react';
import { Controller as MockController } from 'react-hook-form';
import {
  AlertSource,
  AlertThresholdType,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import type { AlertChannelForm } from '@/components/Alerts';
import { DBSearchPageAlertModal } from '@/DBSearchPageAlertModal';

// --- Mutation spies ------------------------------------------------------
const createAlertMutateAsync = jest.fn().mockResolvedValue({ data: {} });
const updateAlertMutateAsync = jest.fn().mockResolvedValue({ data: {} });
const deleteAlertMutateAsync = jest.fn().mockResolvedValue(undefined);

// Two alerts so the test can edit the second tab and confirm the PUT targets
// the right id.
const makeAlert = (id: string) => ({
  id,
  interval: '1m' as const,
  threshold: 1,
  thresholdType: AlertThresholdType.ABOVE,
  source: AlertSource.SAVED_SEARCH,
  savedSearchId: 'saved-search-id',
  channel: { type: 'webhook' as const, webhookId: 'webhook-id' },
  note: null,
  // Match the persisted alert shape (both stored as null), which the form
  // schema must accept.
  numConsecutiveWindows: null,
  scheduleStartAt: null,
});

const firstAlert = makeAlert('6a5163af632ecadec80ec00e');
const secondAlert = makeAlert('aaaa1111bbbb2222cccc3333');

const savedSearch = {
  _id: 'saved-search-id',
  name: 'My Search',
  where: 'level:error',
  whereLanguage: 'lucene',
  select: '',
  source: 'source-id',
  orderBy: '',
  // One tag over the alert cap (32): the prefill must clamp it or the form
  // rejects on mount and Create Alert silently does nothing.
  tags: ['prod', 'checkout-service-payment-failures'],
  alerts: [firstAlert, secondAlert],
};

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useCreateAlert: () => ({
      mutateAsync: createAlertMutateAsync,
      isPending: false,
    }),
    useUpdateAlert: () => ({
      mutateAsync: updateAlertMutateAsync,
      isPending: false,
    }),
    useDeleteAlert: () => ({
      mutateAsync: deleteAlertMutateAsync,
      isPending: false,
    }),
    useAlert: (id?: string) => ({
      data: {
        data: [firstAlert, secondAlert].find(a => a.id === id) ?? firstAlert,
      },
    }),
    useTags: () => ({
      data: { data: ['prod'] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    }),
  },
}));

jest.mock('@/savedSearch', () => ({
  __esModule: true,
  useSavedSearch: () => ({ data: savedSearch, isLoading: false }),
  useCreateSavedSearch: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock('@/source', () => ({
  __esModule: true,
  useSource: () => ({ data: undefined }),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  __esModule: true,
  useBrandDisplayName: () => 'HyperDX',
}));

// Heavy / visual child components are stubbed so the form still renders and
// its submit handler runs. The alert channel form must register the
// `channel.type` field so form validation passes.
jest.mock('@/components/alerts/AlertHistoryCards', () => ({
  __esModule: true,
  AlertHistoryCardList: () => <div data-testid="alert-history" />,
}));
jest.mock('@/components/alerts/AckAlert', () => ({
  __esModule: true,
  AckAlert: () => <div data-testid="ack-alert" />,
}));
jest.mock('@/components/AlertPreviewChart', () => ({
  __esModule: true,
  AlertPreviewChart: () => <div data-testid="alert-preview-chart" />,
}));
// Stubbed, but it still has to register the webhook id: the form schema
// rejects an empty one, so a create submitted through an inert stub would
// never reach the mutation.
jest.mock('@/components/Alerts', () => {
  return {
    __esModule: true,
    AlertChannelForm: ({
      control,
      channelsName,
    }: ComponentProps<typeof AlertChannelForm>) => (
      <MockController
        control={control}
        name={`${channelsName}.0.webhookId`}
        render={({ field }) => (
          <input
            data-testid="webhook-id-input"
            {...field}
            value={field.value ?? ''}
          />
        )}
      />
    ),
  };
});
jest.mock('@/components/SQLEditor/SQLInlineEditor', () => ({
  __esModule: true,
  SQLInlineEditorControlled: () => <div data-testid="sql-inline-editor" />,
}));

const renderModal = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithMantine(
    <QueryClientProvider client={queryClient}>
      <DBSearchPageAlertModal id="saved-search-id" open onClose={jest.fn()} />
    </QueryClientProvider>,
  );
};

describe('DBSearchPageAlertModal', () => {
  beforeEach(() => {
    createAlertMutateAsync.mockClear();
    updateAlertMutateAsync.mockClear();
    deleteAlertMutateAsync.mockClear();
  });

  it('dispatches an update (PUT) with the id resolved from the selected alert tab', async () => {
    renderModal();

    // Modal opens on the "New Alert" tab; select the second existing alert so
    // it renders in edit mode. Using the second (not first) tab confirms the
    // update id is resolved by tab index.
    const alertTab = await screen.findByRole('tab', { name: /Alert 2/ });
    fireEvent.click(alertTab);

    const saveButton = await screen.findByRole('button', {
      name: 'Save Alert',
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateAlertMutateAsync).toHaveBeenCalledTimes(1);
    });

    // The id must come from the selected alert so the PUT targets it.
    expect(updateAlertMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: secondAlert.id,
        source: AlertSource.SAVED_SEARCH,
        savedSearchId: 'saved-search-id',
      }),
    );
    expect(createAlertMutateAsync).not.toHaveBeenCalled();
  });

  // The submitted payload must not carry the legacy singular `channel`: the API
  // rejects it when it disagrees with the edited channels list, and these
  // fixtures are legacy channel-only alerts.
  it('submits channels and drops the legacy channel field', async () => {
    renderModal();

    const alertTab = await screen.findByRole('tab', { name: /Alert 2/ });
    fireEvent.click(alertTab);

    const saveButton = await screen.findByRole('button', {
      name: 'Save Alert',
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateAlertMutateAsync).toHaveBeenCalledTimes(1);
    });

    const payload = updateAlertMutateAsync.mock.calls[0][0];
    expect(payload.channel).toBeUndefined();
    expect(payload.channels).toEqual([
      { type: 'webhook', webhookId: 'webhook-id' },
    ]);
  });

  // A new alert opens prefilled from the saved search it will watch, so the
  // create payload carries those values rather than relying on the server's
  // derivation.
  it('prefills the display name and tags from the saved search, clamped to the alert caps', async () => {
    renderModal();

    expect(await screen.findByTestId('alert-display-name-input')).toHaveValue(
      'My Search',
    );

    fireEvent.change(screen.getByTestId('webhook-id-input'), {
      target: { value: 'webhook-id' },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create Alert' }),
    );

    await waitFor(() => {
      expect(createAlertMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(createAlertMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'My Search',
        tags: ['prod', 'checkout-service-payment-failure'],
      }),
    );
  });
});
