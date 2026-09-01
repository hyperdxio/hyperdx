import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import {
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Grid,
  Group,
  HoverCard,
  List,
  Tabs,
  Text,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

import OnboardingModal from '@/components/OnboardingModal';
import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { TimePicker } from '@/components/TimePicker';
import { NOW } from '@/config';
import { withAppNav } from '@/layout';
import {
  useLLMDashboardExpressions,
  useLLMLogDashboardExpressions,
} from '@/llm/hooks/useLLMDashboardExpressions';
import { getEffectiveTraceSourceId } from '@/ServicesDashboardPage';
import { useSource, useSources } from '@/source';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';

import { AgentToolCharts } from './AgentToolCharts';
import { AttributionCharts } from './AttributionCharts';
import { EfficiencyCharts } from './EfficiencyCharts';
import { ErrorsTab } from './ErrorsTab';
import { LatencyCharts } from './LatencyCharts';
import { LatencyTab } from './LatencyTab';
import { LLMEmptyStateBanner } from './LLMEmptyStateBanner';
import { LLMSessionPanel } from './LLMSessionPanel';
import { OverviewCharts } from './OverviewCharts';
import { SessionSelect } from './SessionSelect';
import { SessionsTab } from './SessionsTab';
import { TokenCostCharts } from './TokenCostCharts';
import { LLMChartProps } from './types';

const DEFAULT_INTERVAL = 'Past 1h';
const parsedDefaultTimeRange = parseTimeQuery(DEFAULT_INTERVAL, false);
const defaultTimeRange: [Date, Date] = [
  parsedDefaultTimeRange[0] ?? new Date(NOW - 60 * 60 * 1000),
  parsedDefaultTimeRange[1] ?? new Date(NOW),
];

const queryParamMap = {
  source: parseAsString.withDefault(''),
  logSource: parseAsString.withDefault(''),
  where: parseAsString.withDefault(''),
  whereLanguage: parseAsString.withDefault(''),
  sessionId: parseAsString.withDefault(''),
};

/**
 * The LLM observability dashboard: traffic, token usage, estimated cost, and
 * latency for LLM spans (OTel GenAI semconv, OpenLLMetry, OpenInference,
 * Vercel AI SDK) on a trace source. All charts read span attributes at query
 * time — no ingestion changes required.
 */
function LLMDashboardPage() {
  const brandName = useBrandDisplayName();

  const [rawTab, setTab] = useQueryState(
    'tab',
    parseAsStringEnum<string>([
      'overview',
      'latency',
      'sessions',
      'errors',
      // Accepted for shared-URL back-compat; the Search tab became Errors.
      'search',
    ]).withDefault('overview'),
  );
  const tab = rawTab === 'search' ? 'errors' : rawTab;

  const [appliedConfig, setAppliedConfig] = useQueryStates(queryParamMap);

  const effectiveWhereLanguage: 'sql' | 'lucene' =
    (appliedConfig.whereLanguage || getStoredLanguage()) === 'lucene'
      ? 'lucene'
      : 'sql';

  const { control, handleSubmit, setValue } = useForm({
    defaultValues: {
      source: appliedConfig.source,
      logSource: appliedConfig.logSource,
      where: appliedConfig.where,
      whereLanguage: effectiveWhereLanguage,
    },
  });
  const sourceId = useWatch({ control, name: 'source' });
  const logSourceId = useWatch({ control, name: 'logSource' });

  const { data: sources } = useSources();

  // Default the trace source on first load like the Services dashboard: the
  // URL param when it resolves to an enabled trace source, else the first
  // available trace source. The select only offers usable trace sources, so
  // a user selection always resolves to itself and is never overridden.
  const effectiveTraceSourceId = sources?.length
    ? getEffectiveTraceSourceId(sourceId || appliedConfig.source, sources)
    : '';
  useEffect(() => {
    if (effectiveTraceSourceId && effectiveTraceSourceId !== sourceId) {
      setValue('source', effectiveTraceSourceId);
    }
  }, [effectiveTraceSourceId, sourceId, setValue]);

  const { data: source } = useSource({
    id: sourceId || effectiveTraceSourceId || undefined,
    kinds: [SourceKind.Trace],
  });

  // Default the log source on first load: the trace source's correlated log
  // source (source settings link, K8s-dashboard style), else the first
  // enabled log source.
  const correlatedLogSourceId =
    source?.kind === SourceKind.Trace ? source.logSourceId : undefined;
  const defaultLogSourceId =
    correlatedLogSourceId ??
    sources?.find(s => s.kind === SourceKind.Log && !s.disabled)?.id;
  useEffect(() => {
    if (!logSourceId && !appliedConfig.logSource && defaultLogSourceId) {
      setValue('logSource', defaultLogSourceId);
    }
  }, [logSourceId, appliedConfig.logSource, defaultLogSourceId, setValue]);

  const { data: logSource } = useSource({
    id: logSourceId || undefined,
    kinds: [SourceKind.Log],
  });

  const { expressions } = useLLMDashboardExpressions({ source });
  const { expressions: logExpressions } = useLLMLogDashboardExpressions({
    source: logSource,
  });

  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState(DEFAULT_INTERVAL);
  const { searchedTimeRange, onSearch } = useNewTimeQuery({
    initialDisplayValue: DEFAULT_INTERVAL,
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
  });

  const onSubmit = useCallback(() => {
    onSearch(displayedTimeInputValue);
    handleSubmit(values => {
      setAppliedConfig(values);
    })();
  }, [handleSubmit, setAppliedConfig, onSearch, displayedTimeInputValue]);

  // Apply a where clause programmatically (delta-chart filter clicks on the
  // Latency tab): keep the input's form state and the applied config in
  // sync so every chart rescopes immediately.
  const handleWhereChange = useCallback(
    (where: string) => {
      setValue('where', where);
      setAppliedConfig({ where });
    },
    [setValue, setAppliedConfig],
  );

  // Auto-apply source changes without requiring a manual submit. The
  // session filter lives in the URL only (see SessionSelect below) — it can
  // also be set externally by the session drawer's "Filter dashboard"
  // action, so keeping it out of the form avoids two-way sync effects.
  useEffect(() => {
    if (sourceId && sourceId !== appliedConfig.source) {
      setAppliedConfig({ source: sourceId });
    }
  }, [sourceId, appliedConfig.source, setAppliedConfig]);
  useEffect(() => {
    if ((logSourceId || '') !== appliedConfig.logSource) {
      setAppliedConfig({ logSource: logSourceId || '' });
    }
  }, [logSourceId, appliedConfig.logSource, setAppliedConfig]);

  const chartProps: LLMChartProps | null =
    source?.kind === SourceKind.Trace && expressions
      ? {
          source,
          expressions,
          dateRange: searchedTimeRange,
          where: appliedConfig.where || '',
          whereLanguage: effectiveWhereLanguage,
          sessionId: appliedConfig.sessionId || undefined,
          logSource: logSource?.kind === SourceKind.Log ? logSource : undefined,
          logExpressions,
        }
      : null;

  return (
    <Box p="sm" data-testid="llm-dashboard-page">
      <Head>
        <title>LLM Dashboard – {brandName}</title>
      </Head>
      <Breadcrumbs mb="sm" mt="xs" fz="sm">
        <Anchor component={Link} href="/dashboards/list" fz="sm" c="dimmed">
          Dashboards
        </Anchor>
        <Group gap="xs" wrap="nowrap">
          <Text fz="sm" c="dimmed">
            LLM
          </Text>
          <Badge size="xs" color="blue" variant="light">
            Beta
          </Badge>
          <HoverCard
            width={420}
            shadow="md"
            position="bottom-start"
            withinPortal
          >
            <HoverCard.Target>
              <Text
                c="dimmed"
                lh={0}
                style={{ cursor: 'help' }}
                data-testid="llm-dashboard-beta-info"
              >
                <IconInfoCircle size={14} />
              </Text>
            </HoverCard.Target>
            <HoverCard.Dropdown>
              <Text size="sm" fw={500} mb="xs">
                About this dashboard
              </Text>
              <List size="xs" c="dimmed" spacing="xs">
                <List.Item>
                  This dashboard is experimental — charts and metrics may change
                  between releases.
                </List.Item>
                <List.Item>
                  Works with traces from the OpenTelemetry GenAI semantic
                  conventions, OpenLLMetry, OpenInference, and the Vercel AI
                  SDK. No ingestion changes needed — spans are interpreted at
                  query time.
                </List.Item>
                <List.Item>
                  Costs are estimates from a bundled model price catalog and can
                  lag provider pricing. A cost reported by the instrumentation
                  itself always takes precedence.
                </List.Item>
                <List.Item>
                  When an app emits several instrumentations for the same calls,
                  spans reporting their own cost are counted once as the source
                  of truth.
                </List.Item>
              </List>
            </HoverCard.Dropdown>
          </HoverCard>
        </Group>
      </Breadcrumbs>
      <OnboardingModal requireSource={false} />
      <form
        onSubmit={e => {
          e.preventDefault();
          onSubmit();
          return false;
        }}
      >
        <Group gap="xs" mb="sm" wrap="nowrap" align="flex-start">
          <SourceSelectControlled
            control={control}
            name="source"
            allowedSourceKinds={[SourceKind.Trace]}
            size="sm"
            data-testid="llm-dashboard-source-select"
          />
          <SourceSelectControlled
            control={control}
            name="logSource"
            allowedSourceKinds={[SourceKind.Log]}
            size="sm"
            data-testid="llm-dashboard-log-source-select"
          />
          <SessionSelect
            value={appliedConfig.sessionId}
            onChange={sessionId => setAppliedConfig({ sessionId })}
            source={source}
            expressions={expressions}
            dateRange={searchedTimeRange}
            size="sm"
            data-testid="llm-dashboard-session-select"
          />
          <Box style={{ flexGrow: 1 }}>
            <SearchWhereInput
              tableConnection={tcFromSource(source)}
              sourceId={sourceId}
              dateRange={searchedTimeRange}
              control={control}
              name="where"
              onSubmit={onSubmit}
              enableHotkey
              data-testid="llm-dashboard-search-input"
              minWidth="200px"
            />
          </Box>
          <TimePicker
            inputValue={displayedTimeInputValue}
            setInputValue={setDisplayedTimeInputValue}
            onSearch={onSearch}
          />
          <Button variant="primary" type="submit" size="sm">
            Search
          </Button>
        </Group>
      </form>
      {chartProps != null && (
        <>
          <LLMEmptyStateBanner {...chartProps} />
          <LLMSessionPanel {...chartProps} />
          <Tabs keepMounted={false} onChange={setTab} value={tab}>
            <Tabs.List mb="sm">
              <Tabs.Tab value="overview">Overview</Tabs.Tab>
              <Tabs.Tab value="latency">Latency</Tabs.Tab>
              <Tabs.Tab value="sessions">Sessions</Tabs.Tab>
              <Tabs.Tab value="errors">Errors</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="overview">
              <Grid grow={false} w="100%" maw="100%">
                <OverviewCharts {...chartProps} />
                <TokenCostCharts {...chartProps} />
                <EfficiencyCharts {...chartProps} />
                <AttributionCharts {...chartProps} />
                <LatencyCharts {...chartProps} />
                <AgentToolCharts {...chartProps} />
              </Grid>
            </Tabs.Panel>
            <Tabs.Panel value="latency">
              <LatencyTab {...chartProps} onWhereChange={handleWhereChange} />
            </Tabs.Panel>
            <Tabs.Panel value="sessions">
              <SessionsTab {...chartProps} />
            </Tabs.Panel>
            <Tabs.Panel value="errors">
              <ErrorsTab {...chartProps} />
            </Tabs.Panel>
          </Tabs>
        </>
      )}
    </Box>
  );
}

const LLMDashboardPageDynamic = dynamic(async () => LLMDashboardPage, {
  ssr: false,
});

// @ts-expect-error Next.js layout typing
LLMDashboardPageDynamic.getLayout = withAppNav;

export default LLMDashboardPageDynamic;
