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
const createSavedSearchMutateAsync = jest
  .fn()
  .mockResolvedValue({ id: 'new-saved-search-id' });
const routerPush = jest.fn();

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
  // One tag over the alert cap (32). The form must not copy a saved search's
  // tags into the alert, which its own schema would then reject on submit.
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

jest.mock('next/router', () => ({
  __esModule: true,
  default: { push: (...args: unknown[]) => routerPush(...args) },
}));

jest.mock('@/savedSearch', () => ({
  __esModule: true,
  // Mirrors the hook's `enabled` option: no id, no saved search.
  useSavedSearch: ({ id }: { id: string }) => ({
    data: id ? savedSearch : undefined,
    isLoading: false,
  }),
  useCreateSavedSearch: () => ({ mutateAsync: createSavedSearchMutateAsync }),
}));

jest.mock('@/source', () => ({
  __esModule: true,
  useSource: () => ({ data: undefined }),
}));

jest.mock('@/brand', () => ({
  __esModule: true,
  useBrandDisplayName: () => 'ClickStack',
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

const renderModal = (
  props: Partial<React.ComponentProps<typeof DBSearchPageAlertModal>> = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithMantine(
    <QueryClientProvider client={queryClient}>
      <DBSearchPageAlertModal
        id="saved-search-id"
        open
        onClose={jest.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
};

const searchedConfig = {
  source: 'source-id',
  select: '',
  where: 'level:error',
  whereLanguage: 'lucene' as const,
  orderBy: '',
  filters: [],
};

describe('DBSearchPageAlertModal', () => {
  beforeEach(() => {
    createAlertMutateAsync.mockClear();
    updateAlertMutateAsync.mockClear();
    deleteAlertMutateAsync.mockClear();
    createSavedSearchMutateAsync.mockClear();
    routerPush.mockClear();
  });

  it('dispatches an update (PUT) with the id resolved from the selected alert tab', async () => {
    renderModal();

    // Modal opens on the "New alert" tab; select the second existing alert so
    // it renders in edit mode. Using the second (not first) tab confirms the
    // update id is resolved by tab index.
    const alertTab = await screen.findByRole('tab', { name: /Alert 2/ });
    fireEvent.click(alertTab);

    const saveButton = await screen.findByRole('button', {
      name: 'Save alert',
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
      name: 'Save alert',
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

  // The saved search is already named in the modal's header, so the alert's
  // own name field stays empty and shows what it inherits. Submitting without
  // touching it leaves the name and tags for the server to derive.
  it('leaves a new alert to inherit the name and tags of its saved search', async () => {
    renderModal();

    const nameInput = await screen.findByTestId('alert-display-name-input');
    expect(nameInput).toHaveValue('');
    expect(nameInput).toHaveAttribute('placeholder', 'My Search');

    fireEvent.change(screen.getByTestId('webhook-id-input'), {
      target: { value: 'webhook-id' },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create alert' }),
    );

    await waitFor(() => {
      expect(createAlertMutateAsync).toHaveBeenCalledTimes(1);
    });
    const payload = createAlertMutateAsync.mock.calls[0][0];
    expect(payload.displayName).toBeUndefined();
    expect(payload.tags).toBeUndefined();
  });

  // An unsaved search is named once, in the header, and the alert inherits it:
  // there is no second name field to disambiguate.
  it('asks for one name when the search has not been saved yet', async () => {
    renderModal({ id: undefined, searchedConfig });

    expect(await screen.findByTestId('saved-search-name-input')).toHaveValue(
      '',
    );
    expect(
      screen.queryByTestId('alert-display-name-input'),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('saved-search-name-input'), {
      target: { value: '  Checkout errors  ' },
    });
    fireEvent.change(screen.getByTestId('webhook-id-input'), {
      target: { value: 'webhook-id' },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Save search and alert' }),
    );

    await waitFor(() => {
      expect(createSavedSearchMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(createSavedSearchMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Checkout errors', tags: [] }),
    );

    await waitFor(() => {
      expect(createAlertMutateAsync).toHaveBeenCalledTimes(1);
    });
    const payload = createAlertMutateAsync.mock.calls[0][0];
    expect(payload.savedSearchId).toBe('new-saved-search-id');
    expect(payload.displayName).toBeUndefined();
    expect(payload.tags).toBeUndefined();
  });

  // The name is validated on the same submit as the alert fields, so an
  // unnamed search is reported the first time rather than after the rest of
  // the form is fixed.
  it('flags an unnamed search on the first submit and saves nothing', async () => {
    renderModal({ id: undefined, searchedConfig });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Save search and alert' }),
    );

    expect(
      await screen.findByTestId('saved-search-name-error'),
    ).toBeInTheDocument();
    expect(createSavedSearchMutateAsync).not.toHaveBeenCalled();
    expect(createAlertMutateAsync).not.toHaveBeenCalled();
  });
});
