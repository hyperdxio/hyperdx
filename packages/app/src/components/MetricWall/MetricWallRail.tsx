import { useMemo } from 'react';
import cx from 'classnames';
import { TMetricSource } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Group,
  Loader,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconLayoutSidebarLeftCollapse } from '@tabler/icons-react';

import { METRIC_KIND_LABELS, QUERYABLE_KINDS } from '@/utils/metricKinds';

import { METRIC_QUANTITIES, METRIC_QUANTITY_LABELS } from './classifyMetric';
import {
  hasMetricQueryToken,
  MetricQueryToken,
  toggleMetricQueryToken,
} from './parseMetricQuery';
import { useAttributeValueCounts } from './useMetricAttributeStats';
import { rankAttributeKeys, WallMetric } from './useMetricWallCatalog';

import styles from './MetricWall.module.scss';

const MAX_KEYS = 15;

function Facet({
  label,
  count,
  active,
  onClick,
  mono = false,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  mono?: boolean;
}) {
  return (
    <UnstyledButton
      className={cx(styles.facet, active && styles.facetActive)}
      onClick={onClick}
      aria-pressed={active}
    >
      <Text span fz="xs" ff={mono ? 'monospace' : undefined} truncate>
        {label}
      </Text>
      <Text span fz="xs" c="dimmed">
        {count}
      </Text>
    </UnstyledButton>
  );
}

function FacetGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap={2}>
      <Text fz={10} fw={600} tt="uppercase" c="dimmed" mb={2}>
        {title}
      </Text>
      {children}
    </Stack>
  );
}

/**
 * Narrow the wall by what the metrics measure and carry, rather than by
 * picking one: every pick becomes a pill in the search box.
 */
export function MetricWallRail({
  metrics,
  source,
  dateRange,
  query,
  onQueryChange,
  railKey,
  onRailKeyChange,
  onCollapse,
}: {
  /** The metrics on the wall right now. */
  metrics: WallMetric[];
  source: TMetricSource;
  dateRange: [Date, Date];
  query: string;
  onQueryChange: (query: string) => void;
  railKey?: string;
  onRailKeyChange: (key: string | undefined) => void;
  onCollapse: () => void;
}) {
  const quantityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of metrics) {
      const q = m.classification.quantity;
      counts.set(q, (counts.get(q) ?? 0) + 1);
    }
    return counts;
  }, [metrics]);
  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of metrics) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
    return counts;
  }, [metrics]);
  const keys = useMemo(
    () => rankAttributeKeys(metrics).slice(0, MAX_KEYS),
    [metrics],
  );
  const values = useAttributeValueCounts({
    source,
    attributeKey: railKey,
    dateRange,
  });

  const toggle = (token: MetricQueryToken) =>
    onQueryChange(toggleMetricQueryToken(query, token));

  return (
    <aside className={styles.rail} data-testid="metric-wall-rail">
      <Stack gap="md">
        <Group justify="space-between">
          <Text fz="xs" fw={600}>
            Narrow
          </Text>
          <Tooltip label="Hide" fz="xs">
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={onCollapse}
              aria-label="Hide the filter rail"
            >
              <IconLayoutSidebarLeftCollapse size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <FacetGroup title="Quantity">
          {METRIC_QUANTITIES.filter(q => quantityCounts.has(q)).map(q => {
            const token: MetricQueryToken = { type: 'quantity', value: q };
            return (
              <Facet
                key={q}
                label={METRIC_QUANTITY_LABELS[q]}
                count={quantityCounts.get(q) ?? 0}
                active={hasMetricQueryToken(query, token)}
                onClick={() => toggle(token)}
              />
            );
          })}
        </FacetGroup>
        <FacetGroup title="Attribute">
          {keys.length === 0 && (
            <Text fz="xs" c="dimmed">
              No attributes reported
            </Text>
          )}
          {keys.map(({ key, count }) => (
            <Facet
              key={key}
              label={key}
              count={count}
              mono
              active={railKey === key}
              onClick={() => onRailKeyChange(railKey === key ? undefined : key)}
            />
          ))}
        </FacetGroup>
        {railKey && (
          <FacetGroup title={`Value of ${railKey}`}>
            {values.isLoading && <Loader size="xs" />}
            {values.data?.map(({ value, count }) => {
              const token: MetricQueryToken = {
                type: 'attr',
                key: railKey,
                value,
              };
              return (
                <Facet
                  key={value}
                  label={value}
                  count={count}
                  mono
                  active={hasMetricQueryToken(query, token)}
                  onClick={() => toggle(token)}
                />
              );
            })}
          </FacetGroup>
        )}
        <FacetGroup title="Kind">
          {QUERYABLE_KINDS.filter(k => kindCounts.has(k)).map(kind => {
            const token: MetricQueryToken = { type: 'kind', value: kind };
            return (
              <Facet
                key={kind}
                label={METRIC_KIND_LABELS[kind]}
                count={kindCounts.get(kind) ?? 0}
                active={hasMetricQueryToken(query, token)}
                onClick={() => toggle(token)}
              />
            );
          })}
        </FacetGroup>
      </Stack>
    </aside>
  );
}
