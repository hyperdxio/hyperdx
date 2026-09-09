import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Button } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconSettings } from '@tabler/icons-react';

import ChartDisplaySettingsDrawer, {
  ChartConfigDisplaySettings,
} from '@/components/ChartDisplaySettingsDrawer';

export function ExploreChartSettings({
  settings,
  displayType,
  previousDateRange,
  onChange,
}: {
  settings: ChartConfigDisplaySettings;
  displayType: DisplayType;
  previousDateRange?: [Date, Date];
  onChange: (settings: ChartConfigDisplaySettings) => void;
}) {
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <>
      <Button
        variant="secondary"
        size="xs"
        leftSection={<IconSettings size={14} />}
        onClick={open}
        data-testid="explore-chart-settings-button"
      >
        Chart settings
      </Button>
      <ChartDisplaySettingsDrawer
        opened={opened}
        settings={settings}
        displayType={displayType}
        configType="builder"
        previousDateRange={previousDateRange}
        onChange={onChange}
        onClose={close}
        isPerSeriesNumberFormatAllowed
        showGranularity
      />
    </>
  );
}
