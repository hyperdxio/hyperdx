import {
  isLogSource,
  isTraceSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Flex, Group, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconPlus } from '@tabler/icons-react';

import { formatAttributeClause, formatColumnEquals } from '@/utils';

import { ROW_DATA_ALIASES } from './DBRowDataPanel';

export interface QuickFilterItem {
  id: string;
  label: string;
  value: string;
  generateWhere: (isSql: boolean) => string;
}

export interface BuildContextWhereClauseOptions {
  selectedFilterIds: string[];
  availableFilters: QuickFilterItem[];
  isSql: boolean;
  customWhere?: string;
}

const MAX_FILTER_VALUE_LENGTH = 200;

const PROMOTED_RESOURCE_ATTR_KEYS = [
  'host.name',
  'k8s.pod.name',
  'k8s.namespace.name',
  'k8s.node.name',
];

function isSafeLuceneFieldExpression(expression: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(expression);
}

function isSafeAttributeKey(key: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(key);
}

export function extractQuickFilters(
  rowData: Record<string, any>,
  source: TSource,
): QuickFilterItem[] {
  const filters: QuickFilterItem[] = [];
  const skipAliases = new Set<string>(Object.values(ROW_DATA_ALIASES));

  const serviceNameExpr =
    isLogSource(source) || isTraceSource(source)
      ? source.serviceNameExpression
      : undefined;
  const resourceAttrExpr =
    'resourceAttributesExpression' in source
      ? source.resourceAttributesExpression
      : undefined;
  const eventAttrExpr =
    isLogSource(source) || isTraceSource(source)
      ? source.eventAttributesExpression
      : undefined;

  const resourceAttrs = rowData[ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES] as
    | Record<string, unknown>
    | undefined;

  const serviceNameValue = rowData[ROW_DATA_ALIASES.SERVICE_NAME];
  if (serviceNameExpr && typeof serviceNameValue === 'string') {
    const resourceServiceName =
      typeof resourceAttrs?.['service.name'] === 'string'
        ? resourceAttrs['service.name']
        : undefined;
    filters.push({
      id: 'svc',
      label: serviceNameExpr,
      value: serviceNameValue,
      generateWhere: isSql => {
        if (isSql || isSafeLuceneFieldExpression(serviceNameExpr)) {
          return formatColumnEquals(serviceNameExpr, serviceNameValue, isSql);
        }
        if (resourceAttrExpr && resourceServiceName) {
          return formatAttributeClause(
            resourceAttrExpr,
            'service.name',
            resourceServiceName,
            isSql,
          );
        }
        return '';
      },
    });
  } else if (
    resourceAttrs?.['service.name'] &&
    typeof resourceAttrs['service.name'] === 'string' &&
    resourceAttrExpr
  ) {
    filters.push({
      id: 'ra:service.name',
      label: 'service.name',
      value: String(resourceAttrs['service.name']),
      generateWhere: isSql =>
        formatAttributeClause(
          resourceAttrExpr,
          'service.name',
          String(resourceAttrs['service.name']),
          isSql,
        ),
    });
  }

  if (resourceAttrs && resourceAttrExpr) {
    for (const key of PROMOTED_RESOURCE_ATTR_KEYS) {
      const val = resourceAttrs[key];
      if (typeof val !== 'string' || !val) continue;
      filters.push({
        id: `ra:${key}`,
        label: key,
        value: val,
        generateWhere: isSql =>
          formatAttributeClause(resourceAttrExpr, key, val, isSql),
      });
    }
  }

  const addedIds = new Set(filters.map(f => f.id));
  if (filters.some(f => f.id === 'svc')) {
    addedIds.add('ra:service.name');
  }
  if (resourceAttrs && resourceAttrExpr) {
    for (const [key, val] of Object.entries(resourceAttrs)) {
      if (addedIds.has(`ra:${key}`)) continue;
      if (!isSafeAttributeKey(key)) continue;
      if (
        typeof val !== 'string' ||
        !val ||
        val.length > MAX_FILTER_VALUE_LENGTH
      )
        continue;
      filters.push({
        id: `ra:${key}`,
        label: key,
        value: val,
        generateWhere: isSql =>
          formatAttributeClause(resourceAttrExpr, key, val, isSql),
      });
    }
  }

  const eventAttrs = rowData[ROW_DATA_ALIASES.EVENT_ATTRIBUTES];
  if (eventAttrs && typeof eventAttrs === 'object' && eventAttrExpr) {
    for (const [key, val] of Object.entries(
      eventAttrs as Record<string, unknown>,
    )) {
      if (!isSafeAttributeKey(key)) continue;
      if (
        typeof val !== 'string' ||
        !val ||
        val.length > MAX_FILTER_VALUE_LENGTH
      )
        continue;
      filters.push({
        id: `ea:${key}`,
        label: key,
        value: val,
        generateWhere: isSql =>
          formatAttributeClause(eventAttrExpr, key, val, isSql),
      });
    }
  }

  for (const [key, val] of Object.entries(rowData)) {
    if (skipAliases.has(key) || key.startsWith('__hdx_')) continue;
    if (!isSafeLuceneFieldExpression(key)) continue;
    if (typeof val !== 'string' || !val || val.length > MAX_FILTER_VALUE_LENGTH)
      continue;
    if (/timestamp|ttl/i.test(key)) continue;
    if (serviceNameExpr && key === serviceNameExpr) continue;

    filters.push({
      id: `col:${key}`,
      label: key,
      value: String(val),
      generateWhere: isSql => formatColumnEquals(key, String(val), isSql),
    });
  }

  return filters;
}

const MATCH_PRESET_IDS: Record<string, string[]> = {
  service: ['svc', 'ra:service.name'],
  host: ['svc', 'ra:service.name', 'ra:host.name'],
  pod: ['svc', 'ra:service.name', 'ra:k8s.pod.name', 'ra:k8s.namespace.name'],
  node: ['svc', 'ra:service.name', 'ra:k8s.node.name'],
};

export function getPresetFilterIds(
  preset: string,
  available: QuickFilterItem[],
): string[] {
  const wantedIds = MATCH_PRESET_IDS[preset] ?? [];
  const availableIds = new Set(available.map(f => f.id));
  return wantedIds.filter(id => availableIds.has(id));
}

export function getAvailablePresets(
  available: QuickFilterItem[],
): { label: string; value: string }[] {
  const ids = new Set(available.map(f => f.id));
  const hasService = ids.has('svc') || ids.has('ra:service.name');
  const hasHost = ids.has('ra:host.name');
  const hasPod = ids.has('ra:k8s.pod.name');
  const hasNode = ids.has('ra:k8s.node.name');

  return [
    { label: 'Anything', value: 'all' },
    ...(hasService ? [{ label: 'Service', value: 'service' }] : []),
    ...(hasHost ? [{ label: 'Host', value: 'host' }] : []),
    ...(hasPod ? [{ label: 'Pod', value: 'pod' }] : []),
    ...(hasNode ? [{ label: 'Node', value: 'node' }] : []),
    { label: 'Custom', value: 'custom' },
  ];
}

export function buildContextWhereClause({
  selectedFilterIds,
  availableFilters,
  isSql,
  customWhere,
}: BuildContextWhereClauseOptions): string {
  const clauses: string[] = [];

  for (const filterId of selectedFilterIds) {
    const filter = availableFilters.find(f => f.id === filterId);
    const clause = filter?.generateWhere(isSql).trim();
    if (clause) {
      clauses.push(clause);
    }
  }

  const trimmedCustomWhere = customWhere?.trim();
  if (trimmedCustomWhere) {
    clauses.push(trimmedCustomWhere);
  }

  if (clauses.length === 0) return '';
  if (clauses.length === 1) return clauses[0];
  return clauses.map(c => `(${c})`).join(' AND ');
}

const filterPillStyle = {
  display: 'inline-flex',
  alignItems: 'center' as const,
  gap: 5,
  padding: '3px 10px',
  borderRadius: 4,
  fontSize: 12,
  lineHeight: '20px',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
  maxWidth: 360,
  overflow: 'hidden',
};

export function FilterPill({
  filter,
  isSelected,
  onToggle,
}: {
  filter: QuickFilterItem;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip
      label={`${filter.label} = ${filter.value}`}
      openDelay={400}
      maw={400}
      multiline
    >
      <span
        data-testid={`context-filter-${filter.id}`}
        onClick={onToggle}
        style={{
          ...filterPillStyle,
          border: isSelected
            ? '1.5px solid var(--mantine-color-yellow-5)'
            : '1px dashed var(--color-border)',
        }}
      >
        {isSelected ? (
          <IconCheck size={13} color="var(--mantine-color-yellow-5)" />
        ) : (
          <IconPlus size={12} style={{ opacity: 0.5 }} />
        )}
        <Text span size="xs" fw={500} style={{ flexShrink: 0 }}>
          {filter.label}
        </Text>
        <Text span size="xs" c="dimmed">
          =
        </Text>
        <Text
          span
          size="xs"
          fw={isSelected ? 700 : 400}
          truncate
          style={{ maxWidth: 180, display: 'inline-block' }}
        >
          {filter.value}
        </Text>
      </span>
    </Tooltip>
  );
}

export function FilterLegend() {
  return (
    <Flex gap="md" align="center" mt={6}>
      <Group gap={4}>
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: 3,
            border: '1.5px solid var(--mantine-color-yellow-5)',
          }}
        />
        <Text size="xxs" c="dimmed">
          matching
        </Text>
      </Group>
      <Group gap={4}>
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: 3,
            border: '1px dashed var(--color-border)',
          }}
        />
        <Text size="xxs" c="dimmed">
          available — tap to add
        </Text>
      </Group>
    </Flex>
  );
}
