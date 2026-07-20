import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import {
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { UseControllerProps, useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { PresetDashboard, SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Anchor,
  Box,
  Breadcrumbs,
  Button,
  Group,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconFilterEdit,
  IconPlayerPlay,
  IconRefresh,
} from '@tabler/icons-react';

import OnboardingModal from '@/components/OnboardingModal';
import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import SelectControlled from '@/components/SelectControlled';
import ServiceDashboardDbQuerySidePanel from '@/components/ServiceDashboardDbQuerySidePanel';
import ServiceDashboardEndpointSidePanel from '@/components/ServiceDashboardEndpointSidePanel';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { TimePicker } from '@/components/TimePicker';
import { IS_LOCAL_MODE } from '@/config';
import DashboardFilters from '@/DashboardFilters';
import DashboardFiltersModal from '@/DashboardFiltersModal';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useDashboardRefresh } from '@/hooks/useDashboardRefresh';
import usePresetDashboardFilters from '@/hooks/usePresetDashboardFilters';
import { withAppNav } from '@/layout';
import { useServiceDashboardExpressions } from '@/serviceDashboard';
import { useSource, useSources } from '@/source';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';
import { usePrevious } from '@/utils';

import DatabaseTab from './DatabaseTab';
import ErrorsTab from './ErrorsTab';
import HttpTab from './HttpTab';

function ServiceSelectControlled({
  sourceId,
  onCreate,
  dateRange,
  ...props
}: {
  sourceId?: string;
  size?: string;
  dateRange: [Date, Date];
  onCreate?: () => void;
} & UseControllerProps<any>) {
  const { data: source } = useSource({
    id: sourceId,
    kinds: [SourceKind.Trace],
  });
  const { expressions } = useServiceDashboardExpressions({ source });

  const queriedConfig = {
    source: source?.id,
    timestampValueExpression: source?.timestampValueExpression || '',
    from: {
      databaseName: source?.from.databaseName || '',
      tableName: source?.from.tableName || '',
    },
    connection: source?.connection || '',
    select: [
      {
        alias: 'service',
        valueExpression: `distinct(${expressions?.service})`,
      },
    ],
    where: `${expressions?.service} IS NOT NULL`,
    whereLanguage: 'sql' as const,
    limit: { limit: 10000 },
    dateRange,
  };

  const { data, isLoading, isError } = useQueriedChartConfig(queriedConfig, {
    placeholderData: (prev: any) => prev,
    queryKey: ['service-select', queriedConfig],
    enabled: !!source && !!expressions,
  });

  const values = useMemo(() => {
    const services =
      data?.data
        ?.map((d: any) => d.service)
        .filter(Boolean)
        .sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' }),
        ) || [];
    return [
      {
        value: '',
        label: 'All Services',
      },
      ...services,
    ];
  }, [data]);

  return (
    <SelectControlled
      {...props}
      data={values}
      disabled={isLoading || isError}
      comboboxProps={{ withinPortal: false }}
      searchable
      placeholder="All Services"
      maxDropdownHeight={280}
      onCreate={onCreate}
      nothingFoundMessage={isLoading ? 'Loading more...' : 'No matches found'}
    />
  );
}

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];

const appliedConfigMap = {
  source: parseAsString,
  where: parseAsString,
  service: parseAsString,
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
};

function ServicesDashboardPage() {
  const brandName = useBrandDisplayName();
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringEnum<string>(['http', 'database', 'errors']).withDefault(
      'http',
    ),
  );

  const { data: sources } = useSources();

  const [appliedConfigParams, setAppliedConfigParams] =
    useQueryStates(appliedConfigMap);

  // Only use the source from the URL params if it is a trace source
  const appliedConfigWithoutFilters = useMemo(() => {
    if (!sources?.length) return appliedConfigParams;

    const traceSources = sources?.filter(
      s => s.kind === SourceKind.Trace && !s.disabled,
    );
    const paramsSourceIdIsTraceSource = traceSources?.find(
      s => s.id === appliedConfigParams.source,
    );

    const effectiveSourceId = paramsSourceIdIsTraceSource
      ? appliedConfigParams.source
      : traceSources?.[0]?.id || '';

    return {
      ...appliedConfigParams,
      source: effectiveSourceId,
    };
  }, [appliedConfigParams, sources]);

  // Services dashboard is SQL-first (WHERE filters are applied to metric/SQL queries).
  // Default to 'sql' here; Search and Dashboard pages default to 'lucene'.
  const effectiveWhereLanguage =
    appliedConfigWithoutFilters?.whereLanguage ?? getStoredLanguage() ?? 'sql';

  const { control, handleSubmit } = useForm({
    defaultValues: {
      where: '',
      whereLanguage: effectiveWhereLanguage as 'sql' | 'lucene',
      service: appliedConfigWithoutFilters?.service || '',
      source: appliedConfigWithoutFilters?.source ?? '',
    },
  });

  const service = useWatch({ control, name: 'service' });
  const previousService = usePrevious(service);

  const sourceId = useWatch({ control, name: 'source' });
  const previousSourceId = usePrevious(sourceId);

  const { data: source } = useSource({
    id: sourceId,
  });

  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const {
    filters,
    filterValues,
    setFilterValue,
    filterQueries: additionalFilters,
    handleSaveFilter,
    handleRemoveFilter,
    isFetching: isFetchingFilters,
    isMutationPending: isFiltersMutationPending,
  } = usePresetDashboardFilters({
    presetDashboard: PresetDashboard.Services,
    sourceId: sourceId || '',
    enabled: !IS_LOCAL_MODE,
  });

  const appliedConfig = useMemo(
    () => ({
      ...appliedConfigWithoutFilters,
      additionalFilters,
    }),
    [appliedConfigWithoutFilters, additionalFilters],
  );

  // Update the `source` query parameter if the appliedConfig source changes
  useEffect(() => {
    if (
      appliedConfigWithoutFilters.source &&
      appliedConfigWithoutFilters.source !== appliedConfigParams.source
    ) {
      setAppliedConfigParams({ source: appliedConfigWithoutFilters.source });
    }
  }, [
    appliedConfigWithoutFilters.source,
    appliedConfigParams.source,
    setAppliedConfigParams,
  ]);

  const DEFAULT_INTERVAL = 'Past 1h';
  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState(DEFAULT_INTERVAL);

  const { searchedTimeRange, onSearch, onTimeRangeSelect } = useNewTimeQuery({
    initialDisplayValue: DEFAULT_INTERVAL,
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
  });

  // For future use if Live button is added
  const [isLive, _setIsLive] = useState(false);

  const { manualRefreshCooloff, refresh } = useDashboardRefresh({
    searchedTimeRange,
    onTimeRangeSelect,
    isLive,
  });

  const onSubmit = useCallback(
    (submitTime: boolean = true) => {
      if (submitTime) onSearch(displayedTimeInputValue);
      handleSubmit(values => {
        setAppliedConfigParams(values);
      })();
    },
    [handleSubmit, setAppliedConfigParams, onSearch, displayedTimeInputValue],
  );

  // Auto-submit when source changes
  // Note: do not include appliedConfig.source in the deps,
  // to avoid infinite render loops when navigating away from the page
  useEffect(() => {
    if (sourceId && sourceId != previousSourceId) {
      onSubmit(false);
    }
  }, [sourceId, onSubmit, previousSourceId]);

  // Auto-submit when service changes
  // Note: do not include appliedConfig.service in the deps,
  // to avoid infinite render loops when navigating away from the page
  useEffect(() => {
    if (service != previousService) {
      onSubmit(false);
    }
  }, [service, onSubmit, previousService]);

  return (
    <Box p="sm" data-testid="services-dashboard-page">
      <Head>
        <title>Services Dashboard – {brandName}</title>
      </Head>
      <Breadcrumbs mb="sm" mt="xs" fz="sm">
        <Anchor component={Link} href="/dashboards/list" fz="sm" c="dimmed">
          Dashboards
        </Anchor>
        <Text fz="sm" c="dimmed">
          Services
        </Text>
      </Breadcrumbs>
      <OnboardingModal requireSource={false} />
      <ServiceDashboardEndpointSidePanel
        service={service}
        searchedTimeRange={searchedTimeRange}
        sourceId={sourceId}
      />
      <ServiceDashboardDbQuerySidePanel
        service={service}
        searchedTimeRange={searchedTimeRange}
        sourceId={sourceId}
      />
      <form
        onSubmit={e => {
          e.preventDefault();
          onSubmit();
          return false;
        }}
      >
        <Group gap="xs">
          <Group justify="space-between" gap="xs" wrap="nowrap" flex={1}>
            <SourceSelectControlled
              control={control}
              name="source"
              allowedSourceKinds={[SourceKind.Trace]}
            />
            <ServiceSelectControlled
              sourceId={sourceId}
              control={control}
              name="service"
              dateRange={searchedTimeRange}
            />
            <SearchWhereInput
              tableConnection={tcFromSource(source)}
              control={control}
              name="where"
              onSubmit={onSubmit}
              enableHotkey
              data-testid="services-search-input"
              minWidth="200px"
            />
            <TimePicker
              inputValue={displayedTimeInputValue}
              setInputValue={setDisplayedTimeInputValue}
              onSearch={onSearch}
            />
            {!IS_LOCAL_MODE && (
              <Tooltip withArrow label="Edit Filters" fz="xs" color="gray">
                <ActionIcon
                  variant="secondary"
                  onClick={() => setShowFiltersModal(true)}
                  size="lg"
                >
                  <IconFilterEdit size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip withArrow label="Refresh dashboard" fz="xs" color="gray">
              <ActionIcon
                onClick={refresh}
                loading={manualRefreshCooloff}
                disabled={manualRefreshCooloff}
                variant="secondary"
                title="Refresh dashboard"
                aria-label="Refresh dashboard"
                size="lg"
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
            <Button
              variant="primary"
              type="submit"
              px="sm"
              leftSection={<IconPlayerPlay size={16} />}
              style={{ flexShrink: 0 }}
            >
              Run
            </Button>
          </Group>
        </Group>
      </form>
      <DashboardFilters
        filters={filters}
        filterValues={filterValues}
        onSetFilterValue={setFilterValue}
        dateRange={searchedTimeRange}
      />
      {source?.kind !== 'trace' ? (
        <Group align="center" justify="center" h="300px">
          <Text c="gray">Please select a trace source</Text>
        </Group>
      ) : (
        <Tabs
          mt="md"
          keepMounted={false}
          defaultValue="http"
          onChange={setTab}
          value={tab}
        >
          <Tabs.List>
            <Tabs.Tab value="http">HTTP Service</Tabs.Tab>
            <Tabs.Tab value="database">Database</Tabs.Tab>
            <Tabs.Tab value="errors">Errors</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="http">
            <HttpTab
              appliedConfig={appliedConfig}
              searchedTimeRange={searchedTimeRange}
            />
          </Tabs.Panel>
          <Tabs.Panel value="database">
            <DatabaseTab
              appliedConfig={appliedConfig}
              searchedTimeRange={searchedTimeRange}
            />
          </Tabs.Panel>
          <Tabs.Panel value="errors">
            <ErrorsTab
              appliedConfig={appliedConfig}
              searchedTimeRange={searchedTimeRange}
            />
          </Tabs.Panel>
        </Tabs>
      )}
      <DashboardFiltersModal
        opened={showFiltersModal}
        onClose={() => setShowFiltersModal(false)}
        filters={filters}
        onSaveFilter={handleSaveFilter}
        onRemoveFilter={handleRemoveFilter}
        source={source}
        isLoading={isFetchingFilters || isFiltersMutationPending}
      />
    </Box>
  );
}

const ServicesDashboardPageDynamic = dynamic(
  async () => ServicesDashboardPage,
  {
    ssr: false,
  },
);

// @ts-expect-error Next.js layout typing
ServicesDashboardPageDynamic.getLayout = withAppNav;

export default ServicesDashboardPageDynamic;
