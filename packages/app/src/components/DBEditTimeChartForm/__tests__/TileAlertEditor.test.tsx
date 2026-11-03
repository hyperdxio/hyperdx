import { useForm } from 'react-hook-form';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AlertPanelLayout } from '@/components/AlertPanel';
import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { TileAlertEditor } from '@/components/DBEditTimeChartForm/TileAlertEditor';
import { DEFAULT_TILE_ALERT } from '@/utils/alerts';

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useAlert: () => ({ data: undefined }),
    // AlertDisplayFields renders <Tags>, which prefetches the tag options.
    useTags: () => ({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    }),
  },
}));

// Only used to look up the dashboard name, which these tests don't assert.
jest.mock('@/dashboard', () => ({
  __esModule: true,
  useDashboards: () => ({ data: undefined }),
}));

// Heavy children that don't participate in the panel behavior.
jest.mock('@/components/Alerts', () => ({
  __esModule: true,
  AlertChannelForm: () => <div data-testid="alert-channel-form" />,
}));
jest.mock('@/components/alerts/AlertHistoryCards', () => ({
  __esModule: true,
  AlertHistoryCardList: () => null,
}));
jest.mock('@/components/alerts/AckAlert', () => ({
  __esModule: true,
  AckAlert: () => null,
}));

// The `mock` prefix is required for a jest.mock factory to close over it.
const mockConfirm = jest.fn();
jest.mock('@/useConfirm', () => ({ useConfirm: () => mockConfirm }));

const noop = () => {};

function Harness({ onRemove = noop }: { onRemove?: () => void }) {
  const { control, setValue } = useForm<ChartEditorFormState>({
    defaultValues: { alert: DEFAULT_TILE_ALERT },
  });
  return (
    <TileAlertEditor
      control={control}
      setValue={setValue}
      alert={DEFAULT_TILE_ALERT}
      onRemove={onRemove}
    />
  );
}

describe('TileAlertEditor in the alert panel', () => {
  function renderInPanel({ defaultOpened }: { defaultOpened: boolean }) {
    renderWithMantine(
      <AlertPanelLayout defaultOpened={defaultOpened}>
        <Harness />
      </AlertPanelLayout>,
    );
  }

  it('renders inside the open panel', () => {
    renderInPanel({ defaultOpened: true });

    expect(screen.getByTestId('alert-panel')).toContainElement(
      screen.getByTestId('alert-details'),
    );
  });

  it('renders nothing while the panel is closed', () => {
    renderInPanel({ defaultOpened: false });

    expect(screen.queryByTestId('alert-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('alert-details')).not.toBeInTheDocument();
  });

  it('closes the panel from its header', () => {
    renderInPanel({ defaultOpened: true });

    fireEvent.click(screen.getByTestId('close-alert-panel-button'));

    expect(screen.queryByTestId('alert-panel')).not.toBeInTheDocument();
  });

  // Reverting is the layout owner's job (EditTimeChartForm restores its
  // snapshot), so closing only has to hand over to it.
  it('cancels the panel changes through the layout when closed', () => {
    const onCancel = jest.fn();
    renderWithMantine(
      <AlertPanelLayout defaultOpened onCancel={onCancel}>
        <Harness />
      </AlertPanelLayout>,
    );

    fireEvent.click(screen.getByTestId('close-alert-panel-button'));

    expect(onCancel).toHaveBeenCalledWith(false);
  });

  it('has no close control outside a panel', () => {
    renderWithMantine(<Harness />);

    expect(screen.getByTestId('alert-details')).toBeInTheDocument();
    expect(
      screen.queryByTestId('close-alert-panel-button'),
    ).not.toBeInTheDocument();
  });
});

describe('TileAlertEditor remove control', () => {
  beforeEach(() => mockConfirm.mockReset());

  it('removes the alert once the removal is confirmed', async () => {
    mockConfirm.mockResolvedValue(true);
    const onRemove = jest.fn();
    renderWithMantine(<Harness onRemove={onRemove} />);

    await userEvent.click(screen.getByTestId('remove-alert-button'));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(expect.anything(), 'Remove', {
      variant: 'danger',
    });
  });

  it('keeps the alert when the removal is cancelled', async () => {
    mockConfirm.mockResolvedValue(false);
    const onRemove = jest.fn();
    renderWithMantine(<Harness onRemove={onRemove} />);

    await userEvent.click(screen.getByTestId('remove-alert-button'));

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
  });
});
