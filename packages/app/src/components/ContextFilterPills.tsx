import {
  isLogSource,
  isTraceSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Text, Tooltip } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

import { formatAttributeClause } from '@/utils';

import { ROW_DATA_ALIASES } from './DBRowDataPanel';

export interface QuickFilterItem {
  id: string;
  label: string;
  value: string;
  generateWhere: (isSql: boolean) => string;
}

function formatColumnEquals(
  column: string,
  value: string,
  isSql: boolean,
): string {
  if (isSql) {
    return `${column} = '${value.replace(/'/g, "''")}'`;
  }
  return `${column}:"${value.replace(/"/g, '\\"')}"`;
}

const PROMOTED_RESOURCE_ATTR_KEYS = [
  'host.name',
  'k8s.pod.name',
  'k8s.node.name',
];

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

  // Service name pill (promoted, always first)
  const serviceNameValue = rowData[ROW_DATA_ALIASES.SERVICE_NAME];
  if (serviceNameExpr && serviceNameValue) {
    filters.push({
      id: 'svc',
      label: serviceNameExpr,
      value: String(serviceNameValue),
      generateWhere: isSql =>
        formatColumnEquals(serviceNameExpr, String(serviceNameValue), isSql),
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

  // Promoted resource attribute pills (host, k8s)
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

  // Remaining resource attributes
  const addedIds = new Set(filters.map(f => f.id));
  if (resourceAttrs && resourceAttrExpr) {
    for (const [key, val] of Object.entries(resourceAttrs)) {
      if (addedIds.has(`ra:${key}`)) continue;
      if (typeof val !== 'string' || !val || val.length > 200) continue;
      filters.push({
        id: `ra:${key}`,
        label: key,
        value: val,
        generateWhere: isSql =>
          formatAttributeClause(resourceAttrExpr, key, val, isSql),
      });
    }
  }

  // Event attributes
  const eventAttrs = rowData[ROW_DATA_ALIASES.EVENT_ATTRIBUTES];
  if (eventAttrs && typeof eventAttrs === 'object' && eventAttrExpr) {
    for (const [key, val] of Object.entries(
      eventAttrs as Record<string, unknown>,
    )) {
      if (typeof val !== 'string' || !val || val.length > 200) continue;
      filters.push({
        id: `ea:${key}`,
        label: key,
        value: val,
        generateWhere: isSql =>
          formatAttributeClause(eventAttrExpr, key, val, isSql),
      });
    }
  }

  // Top-level columns
  for (const [key, val] of Object.entries(rowData)) {
    if (skipAliases.has(key) || key.startsWith('__hdx_')) continue;
    if (typeof val !== 'string' || !val || val.length > 200) continue;
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

const filterPillStyle = {
  display: 'inline-flex',
  alignItems: 'center' as const,
  gap: 4,
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 12,
  lineHeight: '20px',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
  maxWidth: 400,
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
          backgroundColor: isSelected ? 'var(--color-bg-hover)' : 'transparent',
          border: isSelected
            ? '1px solid var(--color-border-emphasis)'
            : '1px solid var(--color-border)',
          opacity: isSelected ? 1 : 0.7,
        }}
      >
        <Text span size="xs" c="dimmed" fw={500} style={{ flexShrink: 0 }}>
          {filter.label}
        </Text>
        <Text span size="xs" c="dimmed">
          =
        </Text>
        <Text
          span
          size="xs"
          fw={500}
          truncate
          style={{ maxWidth: 180, display: 'inline-block' }}
        >
          {filter.value}
        </Text>
        {isSelected && (
          <IconX
            size={12}
            style={{ flexShrink: 0, marginLeft: 2 }}
            aria-label="Remove filter"
          />
        )}
      </span>
    </Tooltip>
  );
}
