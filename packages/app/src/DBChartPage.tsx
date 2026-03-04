import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { parseAsJson, useQueryState } from 'nuqs';
import { useForm } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
import { SavedChartConfig, SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  Alert,
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
import {
  IconChevronDown,
  IconChevronUp,
  IconInfoCircle,
} from '@tabler/icons-react';

import api from '@/api';
import { DEFAULT_CHART_CONFIG } from '@/ChartUtils';
import EditTimeChartForm from '@/components/DBEditTimeChartForm';
import { InputControlled } from '@/components/InputControlled';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { useChartAssistant } from '@/hooks/ai';
import { withAppNav } from '@/layout';
import { useSources } from '@/source';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';
import { useLocalStorage } from '@/utils';

// Autocomplete can focus on column/map keys

// Sampled field discovery and full field discovery

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];

function AIAssistant({
  setConfig,
  onTimeRangeSelect,
  submitRef,
  aiAssistantEnabled,
}: {
  setConfig: (config: SavedChartConfig) => void;
  onTimeRangeSelect: (start: Date, end: Date) => void;
  submitRef: React.RefObject<(() => void) | undefined>;
  aiAssistantEnabled: boolean;
}) {
  const brandName = useBrandDisplayName();
  const [opened, setOpened] = useState(false);
  const [alertDismissed, setAlertDismissed] = useLocalStorage(
    'ai-assistant-alert-dismissed',
    false,
  );
  const { control, setValue, handleSubmit } = useForm<{
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
          setConfig({ ...data, where: '' });
          onTimeRangeSelect(
            new Date(data.dateRange[0]),
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

  if (!aiAssistantEnabled && !alertDismissed) {
    return (
      <Box mb="sm">
        <Alert
          color="dark"
          icon={<IconInfoCircle size={16} />}
          variant="outline"
          withCloseButton
          onClose={() => setAlertDismissed(true)}
          p="xxs"
        >
          <Text size="xs" pt="2px">
            New AI Assistant available, enable with configuring the{' '}
            <code>ANTHROPIC_API_KEY</code> environment variable on the{' '}
            {brandName} server.
          </Text>
        </Alert>
        <Divider mt="sm" />
      </Box>
    );
  } else if (!aiAssistantEnabled) {
    return null;
  }

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
              <IconChevronUp size={14} />
            ) : (
              <IconChevronDown size={14} />
            )}
            <Text size="xxs">AI Assistant [A]</Text>
          </Group>
        </Button>
        <Pill size="xs">Experimental</Pill>
      </Group>
      <Collapse in={opened}>
        {opened && (
          // eslint-disable-next-line react-hooks/refs
          <form onSubmit={handleSubmit(onSubmit)}>
            <Group mb="md">
              <SourceSelectControlled
                autoFocus
                size="xs"
                control={control}
                name="source"
                data-testid="source-selector"
                allowedSourceKinds={[SourceKind.Log, SourceKind.Trace]}
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
                <Button type="submit" size="xs" variant="primary">
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
  const brandName = useBrandDisplayName();
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

  const submitRef = useRef<(() => void) | undefined>(undefined);
  const { data: sources } = useSources();
  const { data: me } = api.useMe();

  const [chartConfig, setChartConfig] = useQueryState(
    'config',
    parseAsJson<SavedChartConfig>(v => v as SavedChartConfig).withDefault({
      ...DEFAULT_CHART_CONFIG,
      source: sources?.[0]?.id ?? '',
    }),
  );

  return (
    <Box data-testid="chart-explorer-page" p="sm">
      <Head>
        <title>Chart Explorer - {brandName}</title>
      </Head>
      <AIAssistant
        setConfig={setChartConfig}
        onTimeRangeSelect={onTimeRangeSelect}
        submitRef={submitRef}
        aiAssistantEnabled={me?.aiAssistantEnabled ?? false}
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
