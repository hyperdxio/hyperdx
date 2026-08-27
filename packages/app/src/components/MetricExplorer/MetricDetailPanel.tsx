import { useCallback, useMemo, useState } from 'react';
import { TMetricSource } from '@hyperdx/common-utils/dist/types';
import {
  Badge,
  Box,
  Divider,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';
import { IconChartLine } from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import {
  AttributeList,
  AttributeValueList,
  formatUnitDisplay,
} from '@/components/MetricAttributeHelperPanel';
import { useFetchMetricAttributeValues } from '@/hooks/useFetchMetricAttributeValues';
import {
  type AttributeKey,
  parseAttributeKeysFromSuggestions,
  useFetchMetricResourceAttrs,
} from '@/hooks/useFetchMetricResourceAttrs';
import { METRIC_KIND_LABELS } from '@/utils/metricKinds';
import type { MetricCatalogEntry } from '@/utils/metricNameTree';

const MAX_SERVICES_SHOWN = 4;

type MetricDetailPanelProps = {
  metricSource: TMetricSource;
  metric: MetricCatalogEntry | null;
  /** Syntax for clauses handed to `onAddWhere`. @default 'sql' */
  language?: 'sql' | 'lucene';
  /** Omit to browse tags read-only, with no filter or group-by actions. */
  onAddWhere?: (clause: string) => void;
  onAddGroupBy?: (clause: string) => void;
};

export function MetricDetailPanel({
  metricSource,
  metric,
  ...actions
}: MetricDetailPanelProps) {
  if (!metric) {
    return (
      <EmptyState
        icon={<IconChartLine size={28} />}
        title="No metric selected"
        description="Pick a metric from the tree to see its unit, description, and tags."
      />
    );
  }

  // Keyed on the metric so drilling into a tag resets when the metric changes —
  // the previous metric's values must not linger.
  return (
    <MetricDetail
      key={`${metric.type}|${metric.name}`}
      metricSource={metricSource}
      metric={metric}
      {...actions}
    />
  );
}

function MetricDetail({
  metricSource,
  metric,
  language,
  onAddWhere,
  onAddGroupBy,
}: MetricDetailPanelProps & { metric: MetricCatalogEntry }) {
  const [selectedAttribute, setSelectedAttribute] =
    useState<AttributeKey | null>(null);

  const databaseName = metricSource.from.databaseName;
  const { name: metricName, type: metricType } = metric;

  const { data: attributeSuggestions, isLoading: isAttributesLoading } =
    useFetchMetricResourceAttrs({
      databaseName,
      metricType,
      metricName,
      tableSource: metricSource,
      isSql: true,
    });

  const attributeKeys = useMemo(
    () => parseAttributeKeysFromSuggestions(attributeSuggestions ?? []),
    [attributeSuggestions],
  );

  const { data: services } = useFetchMetricAttributeValues({
    databaseName,
    metricType,
    metricName,
    attributeName: 'service.name',
    attributeCategory: 'ResourceAttributes',
    tableSource: metricSource,
  });

  const handleBack = useCallback(() => setSelectedAttribute(null), []);

  return (
    <Stack
      gap="xs"
      h="100%"
      style={{ minHeight: 0 }}
      data-testid="metric-detail-panel"
    >
      <Box>
        <Group gap="xs" wrap="nowrap" align="center">
          <Text size="sm" fw={600} style={{ wordBreak: 'break-all' }}>
            {metricName}
          </Text>
          <Badge size="xs" variant="light" style={{ flexShrink: 0 }}>
            {METRIC_KIND_LABELS[metricType]}
          </Badge>
        </Group>

        <Stack gap={4} mt={4}>
          {metric.description && (
            <Text size="xs" style={{ color: 'var(--color-text-muted)' }}>
              {metric.description}
            </Text>
          )}
          <Group gap="xs">
            {metric.unit && (
              <Group gap={4}>
                <Text size="xs" style={{ color: 'var(--color-text-muted)' }}>
                  Unit
                </Text>
                <Text size="xs">{formatUnitDisplay(metric.unit)}</Text>
              </Group>
            )}
            {!!services?.length && (
              <Group gap={4}>
                <Text size="xs" style={{ color: 'var(--color-text-muted)' }}>
                  Services
                </Text>
                <Text size="xs" truncate>
                  {services.slice(0, MAX_SERVICES_SHOWN).join(', ')}
                  {services.length > MAX_SERVICES_SHOWN &&
                    ` +${services.length - MAX_SERVICES_SHOWN}`}
                </Text>
              </Group>
            )}
          </Group>
        </Stack>
      </Box>

      <Divider />

      <Group gap="xs">
        <Text size="xs" fw={600}>
          Tags
        </Text>
        {attributeKeys.length > 0 && (
          <Badge size="xs" variant="default" fw="normal">
            {attributeKeys.length}
          </Badge>
        )}
      </Group>

      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
        {isAttributesLoading ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : attributeKeys.length === 0 ? (
          <Text size="xs" style={{ color: 'var(--color-text-muted)' }}>
            No tags found for this metric.
          </Text>
        ) : selectedAttribute ? (
          <AttributeValueList
            databaseName={databaseName}
            metricType={metricType}
            metricName={metricName}
            tableSource={metricSource}
            attribute={selectedAttribute}
            onBack={handleBack}
            language={language}
            onAddToWhere={onAddWhere}
            onAddToGroupBy={onAddGroupBy}
          />
        ) : (
          <AttributeList
            attributeKeys={attributeKeys}
            onSelectAttribute={setSelectedAttribute}
          />
        )}
      </ScrollArea>
    </Stack>
  );
}
