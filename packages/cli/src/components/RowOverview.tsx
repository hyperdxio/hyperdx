/**
 * Structured overview of a row's data, mirroring the web frontend's
 * DBRowOverviewPanel.  Three sections:
 *
 *  1. Top Level Attributes  – standard OTel fields
 *  2. Span / Log Attributes – from eventAttributesExpression
 *  3. Resource Attributes   – from resourceAttributesExpression
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

import type { SourceResponse } from '@/api/client';
import { ROW_DATA_ALIASES } from '@/shared/rowDataPanel';

// ---- helpers -------------------------------------------------------

/** Recursively flatten a nested object into dot-separated keys. */
function flattenObject(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(
        result,
        flattenObject(value as Record<string, unknown>, fullKey),
      );
    } else {
      result[fullKey] =
        value != null && typeof value === 'object'
          ? JSON.stringify(value)
          : String(value ?? '');
    }
  }
  return result;
}

function matchesQuery(
  key: string,
  value: string,
  query: string | undefined,
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return key.toLowerCase().includes(q) || value.toLowerCase().includes(q);
}

// ---- component -----------------------------------------------------

// Same list as the web frontend's DBRowOverviewPanel
const TOP_LEVEL_KEYS = [
  'TraceId',
  'SpanId',
  'ParentSpanId',
  'SpanName',
  'SpanKind',
  'ServiceName',
  'ScopeName',
  'ScopeVersion',
  'Duration',
  'StatusCode',
  'StatusMessage',
  'SeverityText',
  'Body',
];

interface RowOverviewProps {
  source: SourceResponse;
  rowData: Record<string, unknown>;
  searchQuery?: string;
  wrapLines?: boolean;
  /** Max visible lines (enables fixed-height viewport) */
  maxRows?: number;
  /** Scroll offset into the content */
  scrollOffset?: number;
}

/** A single key–value row. */
function flatten(s: string): string {
  return s
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function KVRow({
  label,
  value,
  wrapLines,
}: {
  label: string;
  value: string;
  wrapLines?: boolean;
}) {
  return (
    <Box
      height={wrapLines ? undefined : 1}
      overflowX={wrapLines ? undefined : 'hidden'}
      overflowY={wrapLines ? undefined : 'hidden'}
    >
      <Box width="25%" flexShrink={0} overflowX="hidden">
        <Text color="cyan" wrap="truncate">
          {label}
        </Text>
      </Box>
      <Box width="75%" overflowX={wrapLines ? undefined : 'hidden'}>
        <Text wrap={wrapLines ? 'wrap' : 'truncate'}>
          {wrapLines ? value : flatten(value)}
        </Text>
      </Box>
    </Box>
  );
}

export default function RowOverview({
  source,
  rowData,
  searchQuery,
  wrapLines,
  maxRows,
  scrollOffset = 0,
}: RowOverviewProps) {
  // ---- 1. Top Level Attributes ------------------------------------
  const topLevelEntries = useMemo(() => {
    return TOP_LEVEL_KEYS.map(key => {
      const val = rowData[key];
      if (val == null || val === '') return null;
      const strVal =
        typeof val === 'object' ? JSON.stringify(val) : String(val);
      if (!matchesQuery(key, strVal, searchQuery)) return null;
      return [key, strVal] as const;
    }).filter(Boolean) as [string, string][];
  }, [rowData, searchQuery]);

  // ---- 2. Event Attributes (Span / Log) ---------------------------
  const eventAttrExpr = source.eventAttributesExpression;
  const eventAttrs = useMemo(() => {
    // Try the source expression name first, then __hdx_* alias
    const raw =
      (eventAttrExpr ? rowData[eventAttrExpr] : null) ??
      rowData[ROW_DATA_ALIASES.EVENT_ATTRIBUTES];
    if (raw == null || typeof raw !== 'object') return null;
    return flattenObject(raw as Record<string, unknown>);
  }, [rowData, eventAttrExpr]);

  const filteredEventAttrs = useMemo(() => {
    if (!eventAttrs) return null;
    const entries = Object.entries(eventAttrs).filter(([k, v]) =>
      matchesQuery(k, v, searchQuery),
    );
    return entries.length > 0 ? entries : null;
  }, [eventAttrs, searchQuery]);

  const eventAttrLabel =
    source.kind === 'log' ? 'Log Attributes' : 'Span Attributes';
  const totalEventAttrKeys = eventAttrs ? Object.keys(eventAttrs).length : 0;

  // ---- 3. Resource Attributes -------------------------------------
  const resourceAttrExpr = source.resourceAttributesExpression;
  const resourceAttrs = useMemo(() => {
    // Try the source expression name first, then __hdx_* alias
    const raw =
      (resourceAttrExpr ? rowData[resourceAttrExpr] : null) ??
      rowData[ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES];
    if (raw == null || typeof raw !== 'object') return null;
    return flattenObject(raw as Record<string, unknown>);
  }, [rowData, resourceAttrExpr]);

  const filteredResourceAttrs = useMemo(() => {
    if (!resourceAttrs) return null;
    const entries = Object.entries(resourceAttrs).filter(([k, v]) =>
      matchesQuery(k, v, searchQuery),
    );
    return entries.length > 0 ? entries : null;
  }, [resourceAttrs, searchQuery]);

  // ---- build flat list of renderable rows ---------------------------

  const allRows = useMemo(() => {
    const rows: React.ReactElement[] = [];

    // Top Level Attributes
    if (topLevelEntries.length > 0) {
      rows.push(
        <Text key="top-header" bold color="cyan">
          Top Level Attributes
        </Text>,
      );
      for (const [key, value] of topLevelEntries) {
        rows.push(
          <KVRow
            key={`top-${key}`}
            label={key}
            value={value}
            wrapLines={wrapLines}
          />,
        );
      }
    }

    // Event Attributes section
    if (eventAttrExpr) {
      rows.push(<Text key="evt-spacer"> </Text>);
      rows.push(
        <Box key="evt-header">
          <Text bold color="cyan">
            {eventAttrLabel}
          </Text>
          <Text dimColor>
            {'  '}
            {`{} ${totalEventAttrKeys} key${totalEventAttrKeys !== 1 ? 's' : ''}`}
          </Text>
        </Box>,
      );
      if (filteredEventAttrs) {
        for (const [key, value] of filteredEventAttrs) {
          rows.push(
            <KVRow
              key={`evt-${key}`}
              label={`  ${key}`}
              value={value}
              wrapLines={wrapLines}
            />,
          );
        }
      } else {
        rows.push(
          <Text key="evt-empty" dimColor>
            {searchQuery ? 'No matching attributes.' : 'No attributes.'}
          </Text>,
        );
      }
    }

    // Resource Attributes section
    if (resourceAttrExpr) {
      rows.push(<Text key="res-spacer"> </Text>);
      rows.push(
        <Text key="res-header" bold color="cyan">
          Resource Attributes
        </Text>,
      );
      if (filteredResourceAttrs) {
        rows.push(
          <Box
            key="res-chips"
            flexDirection="row"
            flexWrap="wrap"
            columnGap={1}
            rowGap={1}
          >
            {filteredResourceAttrs.map(([key, value]) => (
              <Text key={key} backgroundColor="#3a3a3a">
                {' '}
                <Text color="cyan">{key}</Text>
                <Text color="whiteBright">
                  : {flatten(value).slice(0, 80)}
                </Text>{' '}
              </Text>
            ))}
          </Box>,
        );
      } else {
        rows.push(
          <Text key="res-empty" dimColor>
            {searchQuery
              ? 'No matching resource attributes.'
              : 'No resource attributes.'}
          </Text>,
        );
      }
    }

    return rows;
  }, [
    topLevelEntries,
    eventAttrExpr,
    eventAttrLabel,
    totalEventAttrKeys,
    filteredEventAttrs,
    resourceAttrExpr,
    filteredResourceAttrs,
    searchQuery,
    wrapLines,
  ]);

  // ---- render with scrolling ---------------------------------------

  const totalRows = allRows.length;
  const visibleRows =
    maxRows != null
      ? allRows.slice(scrollOffset, scrollOffset + maxRows)
      : allRows;

  return <Box flexDirection="column">{visibleRows}</Box>;
}
