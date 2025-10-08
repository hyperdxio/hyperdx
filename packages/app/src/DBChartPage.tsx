import { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { parseAsJson, parseAsStringEnum, useQueryState } from 'nuqs';
import { useForm } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
import { SavedChartConfig } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Collapse,
  Divider,
  Group,
  Loader,
  Pill,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { DEFAULT_CHART_CONFIG, Granularity } from '@/ChartUtils';
import EditTimeChartForm from '@/components/DBEditTimeChartForm';
import { InputControlled } from '@/components/InputControlled';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { useChartAssistant } from '@/hooks/ai';
import { withAppNav } from '@/layout';
import { useSources } from '@/source';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';

// Autocomplete can focus on column/map keys

// Sampled field discovery and full field discovery

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];

function AIAssistant({
  setConfig,
  onTimeRangeSelect,
  submitRef,
}: {
  setConfig: (config: SavedChartConfig) => void;
  onTimeRangeSelect: (start: Date, end: Date) => void;
  submitRef: React.RefObject<(() => void) | undefined>;
}) {
  const [opened, setOpened] = useState(false);
  const { control, watch, setValue, handleSubmit } = useForm<{
    text: string;
    source: string;
  }>({
    defaultValues: {
      text: '',
      source: '',
    },
  });

  const chartAssistant = useChartAssistant();

  const onSubmit = (data: { text: string; source: string }) => {
    chartAssistant.mutate(
      {
        sourceId: data.source,
        text: data.text,
      },
      {
        onSuccess(data) {
          setConfig(data);
          onTimeRangeSelect(
            // @ts-ignore TODO: fix these types
            new Date(data.dateRange[0]),
            // @ts-ignore TODO: fix these types
            new Date(data.dateRange[1]),
          );

          // FIXME: This is a hack to submit after the form has been updated
          setTimeout(() => {
            if (submitRef.current) {
              submitRef.current();
            }
          }, 100);

          notifications.show({
            color: 'green',
            message: 'Chart generated successfully',
            autoClose: 2000,
          });
        },
        onError(err) {
          notifications.show({
            color: 'red',
            title: 'Error Generating Chart',
            message: err.message,
            autoClose: 2000,
          });
        },
      },
    );
  };

  useHotkeys(
    'a',
    () => {
      setOpened(v => !v);
    },
    {
      preventDefault: true,
    },
  );

  return (
    <Box mb="sm">
      <Group gap="md" align="center" mb="sm">
        <Button
          onClick={() => setOpened(o => !o)}
          size="xs"
          variant="subtle"
          color="gray"
        >
          <Group gap="xs">
            {opened ? (
              <i className="bi bi-chevron-up" />
            ) : (
              <i className="bi bi-chevron-down" />
            )}
            <Text size="xxs">AI Assistant [A]</Text>
          </Group>
        </Button>
        <Pill size="xs">Super Experimental</Pill>
      </Group>
      <Collapse in={opened}>
        {opened && (
          <form onSubmit={handleSubmit(onSubmit)}>
            <Group mb="md">
              <SourceSelectControlled
                autoFocus
                size="xs"
                control={control}
                name="source"
                data-testid="source-selector"
              />
              <Box style={{ flexGrow: 1, minWidth: 100 }}>
                <InputControlled
                  placeholder="ex. Error counts by service over last 2 hours"
                  data-testid="save-search-name-input"
                  control={control}
                  name="text"
                  rules={{ required: true }}
                  size="xs"
                />
              </Box>
              {chartAssistant.isPending ? (
                <Loader size="xs" type="dots" />
              ) : (
                <Button type="submit" size="xs" variant="light">
                  Generate
                </Button>
              )}
            </Group>
          </form>
        )}
      </Collapse>
      <Divider />
    </Box>
  );
}

function DBChartExplorerPage() {
  const {
    searchedTimeRange,
    displayedTimeInputValue,
    setDisplayedTimeInputValue,
    onSearch,
    onTimeRangeSelect,
  } = useNewTimeQuery({
    initialDisplayValue: 'Past 1h',
    initialTimeRange: defaultTimeRange,
    // showRelativeInterval: isLive,
  });

  const submitRef = useRef<() => void>();
  const { data: sources } = useSources();

  const [chartConfig, setChartConfig] = useQueryState(
    'config',
    parseAsJson<SavedChartConfig>().withDefault({
      ...DEFAULT_CHART_CONFIG,
      source: sources?.[0]?.id ?? '',
    }),
  );

  return (
    <Box data-testid="chart-explorer-page" p="sm" className="bg-hdx-dark">
      <AIAssistant
        setConfig={setChartConfig}
        onTimeRangeSelect={onTimeRangeSelect}
        submitRef={submitRef}
      />
      <EditTimeChartForm
        data-testid="chart-explorer-form"
        chartConfig={chartConfig}
        setChartConfig={config => {
          setChartConfig(config);
        }}
        dateRange={searchedTimeRange}
        setDisplayedTimeInputValue={setDisplayedTimeInputValue}
        displayedTimeInputValue={displayedTimeInputValue}
        onTimeRangeSearch={onSearch}
        onTimeRangeSelect={onTimeRangeSelect}
        submitRef={submitRef}
      />
    </Box>
  );
}

const DBChartExplorerPageDynamic = dynamic(async () => DBChartExplorerPage, {
  ssr: false,
});

// @ts-ignore
DBChartExplorerPageDynamic.getLayout = withAppNav;

export default DBChartExplorerPageDynamic;
