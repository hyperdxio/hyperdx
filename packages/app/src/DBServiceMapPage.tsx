import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind, TTraceSource } from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Flex,
  Group,
  Modal,
  MultiSelect,
  Slider,
  Text,
} from '@mantine/core';
import { IconConnection } from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import { PageLayout } from '@/components/PageLayout';
import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import { IS_LOCAL_MODE } from '@/config';
import { useGetKeyValues } from '@/hooks/useMetadata';
import { withAppNav } from '@/layout';
import { parseAsStringEncoded } from '@/utils/queryParsers';

import OnboardingModal from './components/OnboardingModal';
import ServiceMap from './components/ServiceMap/ServiceMap';
import { TableSourceForm } from './components/Sources/SourceForm';
import SourceSchemaPreview, {
  isSourceSchemaPreviewEnabled,
} from './components/SourceSchemaPreview';
import { SourceSelectControlled } from './components/SourceSelect';
import { TimePicker } from './components/TimePicker';
import { useBrandDisplayName } from './theme/ThemeProvider';
import { useSources } from './source';
import { parseTimeQuery, useNewTimeQuery } from './timeQuery';

// The % of requests sampled is 1 / sampling factor
const SAMPLING_FACTORS = [
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

const searchQueryStateMap = {
  where: parseAsStringEncoded,
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
  services: parseAsArrayOf(parseAsString),
};

function DBServiceMapPage() {
  const brandName = useBrandDisplayName();

  const { data: sources } = useSources();
  const [sourceId, setSourceId] = useQueryState('source');
  const [isCreateSourceModalOpen, setIsCreateSourceModalOpen] = useState(false);

  const [searchedConfig, setSearchedConfig] =
    useQueryStates(searchQueryStateMap);

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

  const { control, handleSubmit, setValue } = useForm({
    values: {
      source: source?.id,
      where: searchedConfig.where ?? '',
      whereLanguage:
        searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
    },
  });

  const watchedSource = useWatch({ control, name: 'source' });
  const [isSourceSchemaPreviewOpen, setIsSourceSchemaPreviewOpen] =
    useState(false);

  useEffect(() => {
    if (watchedSource !== sourceId) {
      setSourceId(watchedSource ?? null);
    }
  }, [watchedSource, sourceId, setSourceId]);

  const sourceTableConnection = useMemo(() => tcFromSource(source), [source]);

  const serviceNameKey = source?.serviceNameExpression ?? 'ServiceName';
  const serviceNamesChartConfig = useMemo(
    () =>
      source
        ? {
            from: source.from,
            connection: source.connection,
            timestampValueExpression: source.timestampValueExpression,
            where: '',
            select: '',
            dateRange: searchedTimeRange,
          }
        : undefined,
    [source, searchedTimeRange],
  );
  const { data: serviceNameValues, isLoading: isServiceNamesLoading } =
    useGetKeyValues(
      {
        chartConfig: serviceNamesChartConfig,
        keys: [serviceNameKey],
        disableRowLimit: true,
        limit: 10000,
      },
      { enabled: !!source },
    );
  const serviceNameOptions = useMemo(
    () =>
      (serviceNameValues?.[0]?.value ?? [])
        .map(v => String(v))
        .sort((a, b) => a.localeCompare(b)),
    [serviceNameValues],
  );

  const selectedServices = searchedConfig.services ?? [];
  const setSelectedServices = useCallback(
    (values: string[]) => {
      setSearchedConfig(prev => ({
        ...prev,
        services: values.length > 0 ? values : null,
      }));
    },
    [setSearchedConfig],
  );

  // Clicking a node focuses on that service (and, via the server-side filter's
  // neighbor expansion, its immediate callers/callees). Clicking the currently
  // focused service clears the focus, so clicks toggle.
  const onFocusService = useCallback(
    (serviceName: string) => {
      setSearchedConfig(prev => {
        const current = prev.services ?? [];
        const isFocused = current.length === 1 && current[0] === serviceName;
        return { ...prev, services: isFocused ? null : [serviceName] };
      });
    },
    [setSearchedConfig],
  );

  const onSubmit = useCallback(() => {
    onSearch(displayedTimeInputValue);
    handleSubmit(({ where, whereLanguage }) => {
      setSearchedConfig(prev => ({ ...prev, where, whereLanguage }));
    })();
  }, [handleSubmit, setSearchedConfig, displayedTimeInputValue, onSearch]);

  const [samplingFactor, setSamplingFactor] = useQueryState(
    'samplingFactor',
    parseAsInteger.withDefault(10),
  );
  const { label: samplingLabel = '' } =
    SAMPLING_FACTORS.find(factor => factor.value === samplingFactor) ?? {};

  const hasTraceSources = sources != null && defaultSource != null;
  const isLoading = sources == null;

  const head = useMemo(
    () => (
      <>
        <Head>
          <title>Service Map - {brandName}</title>
        </Head>
        <OnboardingModal />
      </>
    ),
    [brandName],
  );

  const sourceSelect = source ? (
    <>
      <SourceSelectControlled
        control={control}
        name="source"
        size="xs"
        allowedSourceKinds={[SourceKind.Trace]}
        onSchemaPreview={() => setIsSourceSchemaPreviewOpen(true)}
        isSchemaPreviewEnabled={isSourceSchemaPreviewEnabled(source)}
      />
      <SourceSchemaPreview
        source={source}
        controlled
        open={isSourceSchemaPreviewOpen}
        onClose={() => setIsSourceSchemaPreviewOpen(false)}
      />
    </>
  ) : null;

  const headerActions = (
    <Group gap="sm" wrap="nowrap">
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
  );

  if (!isLoading && !hasTraceSources) {
    return (
      <>
        {head}
        <PageLayout
          data-testid="service-map-page"
          fillViewport
          content={
            <>
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
                style={{ flex: 1, margin: 'var(--mantine-spacing-sm)' }}
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
            </>
          }
        />
      </>
    );
  }

  return source ? (
    <>
      {head}
      <PageLayout
        data-testid="service-map-page"
        leading={sourceSelect}
        actions={headerActions}
        fillViewport
        content={
          <>
            <Flex
              px="sm"
              pt="sm"
              pb="xs"
              gap="sm"
              align="flex-start"
              wrap="wrap"
            >
              <MultiSelect
                placeholder={
                  selectedServices.length === 0 ? 'All Services' : undefined
                }
                value={selectedServices}
                data={serviceNameOptions}
                onChange={setSelectedServices}
                searchable
                clearable
                size="xs"
                maxDropdownHeight={280}
                disabled={isServiceNamesLoading}
                variant="filled"
                w={250}
                limit={100}
                data-testid="service-map-service-filter"
              />
              <SearchWhereInput
                tableConnection={sourceTableConnection}
                control={control}
                name="where"
                onSubmit={onSubmit}
                onLanguageChange={lang =>
                  setValue('whereLanguage', lang, { shouldDirty: true })
                }
                enableHotkey
                size="xs"
                data-testid="service-map-search-input"
                dateRange={searchedTimeRange}
                sourceId={source?.id}
                lucenePlaceholder="Filter spans w/ Lucene (ex. http.method:GET)"
                sqlPlaceholder="SQL WHERE to filter spans (ex. Duration > 1000000)"
                minWidth="min(500px, 100%)"
              />
            </Flex>
            <ServiceMap
              traceTableSource={source}
              dateRange={searchedTimeRange}
              samplingFactor={samplingFactor}
              where={searchedConfig.where ?? undefined}
              whereLanguage={searchedConfig.whereLanguage ?? undefined}
              serviceNames={
                selectedServices.length > 0 ? selectedServices : undefined
              }
              onFocusService={onFocusService}
            />
          </>
        }
      />
    </>
  ) : null;
}

const DBServiceMapPageDynamic = dynamic(async () => DBServiceMapPage, {
  ssr: false,
});

// @ts-ignore
DBServiceMapPageDynamic.getLayout = withAppNav;

export default DBServiceMapPageDynamic;
