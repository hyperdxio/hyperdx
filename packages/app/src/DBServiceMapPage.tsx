import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { parseAsInteger, useQueryState } from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { SourceKind, TTraceSource } from '@hyperdx/common-utils/dist/types';
import { Box, Button, Group, Modal, Slider, Text } from '@mantine/core';
import { IconConnection } from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import { IS_LOCAL_MODE } from '@/config';
import { withAppNav } from '@/layout';

import ServiceMap from './components/ServiceMap/ServiceMap';
import { TableSourceForm } from './components/Sources/SourceForm';
import SourceSchemaPreview from './components/SourceSchemaPreview';
import { SourceSelectControlled } from './components/SourceSelect';
import { TimePicker } from './components/TimePicker';
import { useSources } from './source';
import { parseTimeQuery, useNewTimeQuery } from './timeQuery';

// The % of requests sampled is 1 / sampling factor
export const SAMPLING_FACTORS = [
  {
    value: 100,
    label: '1%',
  },
  {
    value: 20,
    label: '5%',
  },
  {
    value: 10,
    label: '10%',
  },
  {
    value: 2,
    label: '50%',
  },
  {
    value: 1,
    label: '100%',
  },
];

const DEFAULT_INTERVAL = 'Past 1h';
const defaultTimeRange = parseTimeQuery(DEFAULT_INTERVAL, false) as [
  Date,
  Date,
];

function DBServiceMapPage() {
  const { data: sources } = useSources();
  const [sourceId, setSourceId] = useQueryState('source');
  const [isCreateSourceModalOpen, setIsCreateSourceModalOpen] = useState(false);

  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState(DEFAULT_INTERVAL);

  const { searchedTimeRange, onSearch } = useNewTimeQuery({
    initialDisplayValue: DEFAULT_INTERVAL,
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
  });

  const defaultSource = sources?.find(
    (source): source is TTraceSource => source.kind === SourceKind.Trace,
  );
  const source =
    sourceId && sources
      ? (sources.find(
          (source): source is TTraceSource =>
            source.id === sourceId && source.kind === SourceKind.Trace,
        ) ?? defaultSource)
      : defaultSource;

  const { control } = useForm({
    values: {
      source: source?.id,
    },
  });

  const watchedSource = useWatch({ control, name: 'source' });

  useEffect(() => {
    if (watchedSource !== sourceId) {
      setSourceId(watchedSource ?? null);
    }
  }, [watchedSource, sourceId, setSourceId]);

  const [samplingFactor, setSamplingFactor] = useQueryState(
    'samplingFactor',
    parseAsInteger.withDefault(10),
  );
  const { label: samplingLabel = '' } =
    SAMPLING_FACTORS.find(factor => factor.value === samplingFactor) ?? {};

  const hasTraceSources = sources != null && defaultSource != null;
  const isLoading = sources == null;

  if (!isLoading && !hasTraceSources) {
    return (
      <Box
        p="sm"
        className="bg-body"
        style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}
      >
        <Text size="xl" mb="md">
          Service Map
        </Text>
        {IS_LOCAL_MODE && (
          <Modal
            size="xl"
            opened={isCreateSourceModalOpen}
            onClose={() => setIsCreateSourceModalOpen(false)}
            title="Configure New Trace Source"
          >
            <TableSourceForm
              isNew
              defaultName="My Trace Source"
              onCreate={() => setIsCreateSourceModalOpen(false)}
            />
          </Modal>
        )}
        <EmptyState
          style={{ flex: 1 }}
          icon={<IconConnection size={32} />}
          title="No trace sources configured"
          description="The Service Map visualizes relationships between your services using trace data. Configure a trace source to get started."
          maw={600}
        >
          {IS_LOCAL_MODE ? (
            <Button
              variant="primary"
              size="sm"
              mt="sm"
              onClick={() => setIsCreateSourceModalOpen(true)}
            >
              Create Trace Source
            </Button>
          ) : (
            <Button
              component="a"
              href="/team"
              variant="primary"
              size="sm"
              mt="sm"
            >
              Go to Team Settings
            </Button>
          )}
        </EmptyState>
      </Box>
    );
  }

  return source ? (
    <Box
      data-testid="service-map-page"
      p="sm"
      className="bg-body"
      style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}
    >
      <Group mb="md" justify="space-between">
        <Group>
          <Text size="xl">Service Map</Text>
          <SourceSelectControlled
            control={control}
            name="source"
            size="xs"
            allowedSourceKinds={[SourceKind.Trace]}
            sourceSchemaPreview={
              <SourceSchemaPreview source={source} variant="text" />
            }
          />
        </Group>
        <Group justify="flex-end">
          <Text bg="inherit" size="sm">
            Sampling {samplingLabel}
          </Text>
          <div style={{ minWidth: '200px' }}>
            <Slider
              label={null}
              min={0}
              max={SAMPLING_FACTORS.length - 1}
              value={SAMPLING_FACTORS.findIndex(
                factor => factor.value === samplingFactor,
              )}
              onChange={v => setSamplingFactor(SAMPLING_FACTORS[v].value)}
              showLabelOnHover={false}
            />
          </div>
          <TimePicker
            inputValue={displayedTimeInputValue}
            setInputValue={setDisplayedTimeInputValue}
            onSearch={onSearch}
          />
        </Group>
      </Group>
      <ServiceMap
        traceTableSource={source}
        dateRange={searchedTimeRange}
        samplingFactor={samplingFactor}
      />
    </Box>
  ) : null;
}

const DBServiceMapPageDynamic = dynamic(async () => DBServiceMapPage, {
  ssr: false,
});

// @ts-ignore
DBServiceMapPageDynamic.getLayout = withAppNav;

export default DBServiceMapPageDynamic;
