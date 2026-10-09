import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { parseAsString, parseAsStringEnum, useQueryStates } from 'nuqs';
import { useForm } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  FilterSchema,
  SourceKind,
  TNetflowSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from '@mantine/core';
import { IconNetwork, IconPlayerPlay, IconRefresh } from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import { TextInputControlled } from '@/components/InputControlled';
import NetflowCharts from '@/components/NetflowCharts';
import NetflowFilterPills, {
  useNetflowFilterState,
} from '@/components/NetflowFilterPills';
import { PageLayout } from '@/components/PageLayout';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import { TableSourceForm } from '@/components/Sources/SourceForm';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { TimePicker } from '@/components/TimePicker';
import { useDashboardRefresh } from '@/hooks/useDashboardRefresh';
import { withAppNavForSurface } from '@/layout';
import { buildNetflowQueryConfigs } from '@/netflow';
import { useSources } from '@/source';
import { usePageTitle } from '@/theme/ThemeProvider';
import { useDefaultTimeRange, useNewTimeQuery } from '@/timeQuery';
import { parseAsJsonEncoded } from '@/utils/queryParsers';

const queryParsers = {
  source: parseAsString.withDefault(''),
  where: parseAsString.withDefault(''),
  whereLanguage: parseAsStringEnum(['lucene', 'sql']).withDefault('lucene'),
  filters: parseAsJsonEncoded(FilterSchema.array().parse).withDefault([]),
  exporter: parseAsString.withDefault(''),
  protocol: parseAsString.withDefault(''),
  srcAddr: parseAsString.withDefault(''),
  dstAddr: parseAsString.withDefault(''),
};
const DEFAULT_INTERVAL = 'Past 1h';

function NetflowPage() {
  const title = usePageTitle('NetFlow');
  const { data: sources, isLoading, error } = useSources();
  const [params, setParams] = useQueryStates(queryParsers);
  const [sourceModal, setSourceModal] = useState<'new' | 'edit' | null>(null);
  const netflowSources = sources?.filter(
    (s): s is TNetflowSource => s.kind === SourceKind.Netflow && !s.disabled,
  );
  const source = params.source
    ? netflowSources?.find(
        s => s.id === params.source || s.name === params.source,
      )
    : netflowSources?.[0];
  const { control, handleSubmit, reset, getValues } = useForm({
    values: { ...params, source: source?.id ?? '' },
  });
  const clickFilters = useNetflowFilterState({
    source,
    filters: params.filters,
    onChange: filters => {
      const next = { ...getValues(), filters };
      reset(next);
      void setParams(next);
    },
  });
  const defaultTimeRange = useDefaultTimeRange(DEFAULT_INTERVAL);
  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState(DEFAULT_INTERVAL);
  const { searchedTimeRange, onSearch, onTimeRangeSelect } = useNewTimeQuery({
    initialDisplayValue: DEFAULT_INTERVAL,
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
  });
  const { refresh, manualRefreshCooloff } = useDashboardRefresh({
    searchedTimeRange,
    onTimeRangeSelect,
    isLive: false,
  });
  const configs = useMemo(
    () =>
      source
        ? buildNetflowQueryConfigs({
            source,
            dateRange: searchedTimeRange,
            filters: params,
            where: params.where,
            whereLanguage: params.whereLanguage,
            extraFilters: params.filters,
          })
        : undefined,
    [source, searchedTimeRange, params],
  );
  const run = handleSubmit(values => {
    void setParams(values);
    onSearch(displayedTimeInputValue);
  });

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <Modal
        opened={sourceModal !== null}
        onClose={() => setSourceModal(null)}
        title={
          sourceModal === 'edit' ? 'Edit NetFlow source' : 'Add NetFlow source'
        }
        size="xl"
      >
        <TableSourceForm
          isNew={sourceModal === 'new'}
          sourceId={sourceModal === 'edit' ? source?.id : undefined}
          defaultName="NetFlow"
          defaultKind={SourceKind.Netflow}
          onCreate={created => {
            void setParams({ source: created.id });
            setSourceModal(null);
          }}
          onSave={() => setSourceModal(null)}
          onCancel={() => setSourceModal(null)}
        />
      </Modal>
      <form onSubmit={run}>
        <PageLayout
          title="NetFlow"
          data-testid="netflow-page"
          padded
          leading={
            <SourceSelectControlled
              name="source"
              control={control}
              allowedSourceKinds={[SourceKind.Netflow]}
              allowDeselect={false}
              onCreate={() => setSourceModal('new')}
              onEdit={() => setSourceModal('edit')}
              placeholder="NetFlow source"
              aria-label="NetFlow source"
            />
          }
          actions={
            <Group gap="xs" wrap="nowrap">
              <TimePicker
                inputValue={displayedTimeInputValue}
                setInputValue={setDisplayedTimeInputValue}
                onSearch={onSearch}
              />
              <ActionIcon
                variant="secondary"
                size="input-sm"
                aria-label="Refresh NetFlow"
                title="Refresh NetFlow"
                onClick={refresh}
                disabled={manualRefreshCooloff}
                loading={manualRefreshCooloff}
              >
                <IconRefresh size={18} />
              </ActionIcon>
              <Button
                variant="primary"
                type="submit"
                leftSection={<IconPlayerPlay size={16} />}
              >
                Run
              </Button>
            </Group>
          }
          content={
            <Stack gap="md">
              {source && (
                <SearchWhereInput
                  tableConnection={tcFromSource(source)}
                  sourceId={source.id}
                  control={control}
                  name="where"
                  onSubmit={run}
                  enableHotkey
                  showSuggestionsOnEmpty
                  dateRange={searchedTimeRange}
                  lucenePlaceholder="Search flows with Lucene, e.g. Proto:6 AND DstPort:443"
                  luceneQueryHistoryType="netflow"
                  sqlQueryHistoryType="netflow-sql"
                  data-testid="netflow-search"
                />
              )}
              <Group align="end" gap="sm">
                <TextInputControlled
                  control={control}
                  name="exporter"
                  label="Exporter"
                  placeholder="All exporters"
                  disabled={!source?.exporterExpression?.trim()}
                />
                <TextInputControlled
                  control={control}
                  name="protocol"
                  label="Protocol"
                  placeholder="6 (TCP), 17 (UDP)"
                />
                <TextInputControlled
                  control={control}
                  name="srcAddr"
                  label="Source IP"
                  placeholder="IPv4 or IPv6 address"
                />
                <TextInputControlled
                  control={control}
                  name="dstAddr"
                  label="Destination IP"
                  placeholder="IPv4 or IPv6 address"
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    const cleared = {
                      source: source?.id ?? '',
                      where: '',
                      whereLanguage: params.whereLanguage,
                      filters: [],
                      exporter: '',
                      protocol: '',
                      srcAddr: '',
                      dstAddr: '',
                    };
                    reset(cleared);
                    void setParams(cleared);
                  }}
                >
                  Clear filters
                </Button>
              </Group>
              <NetflowFilterPills {...clickFilters} />
              <Text size="xs" c="dimmed">
                Explore traffic volume, top talkers, and recent flow records.
                Rates are averaged over the selected time range; counters
                account for the source’s sampling rate.
              </Text>
              {error ? (
                <Alert variant="danger" title="Could not load NetFlow sources">
                  {error.message}
                </Alert>
              ) : isLoading ? (
                <Loader aria-label="Loading NetFlow sources" />
              ) : configs ? (
                <NetflowCharts
                  configs={configs}
                  onFilter={clickFilters.onFilter}
                  onDimensionFilter={clickFilters.onDimensionFilter}
                  onTimeRangeSelect={onTimeRangeSelect}
                />
              ) : (
                <EmptyState
                  icon={<IconNetwork size={32} />}
                  title={
                    params.source
                      ? 'NetFlow source unavailable'
                      : 'No NetFlow sources configured'
                  }
                  description={
                    params.source
                      ? 'Select an available NetFlow source and run the query, or add a new source.'
                      : 'Connect your Akvorado or NetFlow table in ClickHouse to monitor network traffic.'
                  }
                  variant="card"
                >
                  <Button
                    variant="primary"
                    onClick={() => setSourceModal('new')}
                  >
                    Add NetFlow source
                  </Button>
                </EmptyState>
              )}
            </Stack>
          }
        />
      </form>
    </>
  );
}

const NetflowPageDynamic = dynamic(async () => NetflowPage, { ssr: false });
// @ts-expect-error Next.js layout typing
NetflowPageDynamic.getLayout = withAppNavForSurface('dashboard', 'netflow');
export default NetflowPageDynamic;
