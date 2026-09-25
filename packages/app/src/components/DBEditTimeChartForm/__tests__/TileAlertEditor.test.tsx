import { Control, useForm, useWatch } from 'react-hook-form';
import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';
import { fireEvent, screen } from '@testing-library/react';

import { AlertPanelLayout } from '@/components/AlertPanel';
import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { TileAlertEditor } from '@/components/DBEditTimeChartForm/TileAlertEditor';
import {
  DEFAULT_TILE_ALERT,
  TILE_ALERT_THRESHOLD_TYPE_OPTIONS,
} from '@/utils/alerts';

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

// useWatch inside the component that owns useForm doesn't re-render on
// setValue, so the watched value is surfaced from a child component.
function ThresholdTypeProbe({
  control,
}: {
  control: Control<ChartEditorFormState>;
}) {
  const thresholdType = useWatch({ control, name: 'alert.thresholdType' });
  return <div data-testid="threshold-type">{thresholdType}</div>;
}

function Harness() {
  const { control, setValue } = useForm<ChartEditorFormState>({
    defaultValues: { alert: DEFAULT_TILE_ALERT },
  });
  return (
    <>
      <ThresholdTypeProbe control={control} />
      <TileAlertEditor
        control={control}
        setValue={setValue}
        alert={DEFAULT_TILE_ALERT}
        onRemove={jest.fn()}
      />
    </>
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

  it('keeps edits made in the panel after it closes', () => {
    renderInPanel({ defaultOpened: true });

    fireEvent.change(
      screen.getByDisplayValue(
        TILE_ALERT_THRESHOLD_TYPE_OPTIONS[AlertThresholdType.ABOVE],
      ),
      { target: { value: AlertThresholdType.BELOW } },
    );
    fireEvent.click(screen.getByTestId('close-alert-panel-button'));

    expect(screen.getByTestId('threshold-type')).toHaveTextContent(
      AlertThresholdType.BELOW,
    );
  });

  it('has no close control outside a panel', () => {
    renderWithMantine(<Harness />);

    expect(screen.getByTestId('alert-details')).toBeInTheDocument();
    expect(
      screen.queryByTestId('close-alert-panel-button'),
    ).not.toBeInTheDocument();
  });
});
