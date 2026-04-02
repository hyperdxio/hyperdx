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
import { ROW_DATA_ALIASES } from '@/api/eventQuery';

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
}

/** A single key–value row. */
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
    <Box>
      <Box width={25} flexShrink={0}>
        <Text color="cyan" wrap="truncate">
          {label}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap={wrapLines ? 'wrap' : 'truncate'}>{value}</Text>
      </Box>
    </Box>
  );
}

export default function RowOverview({
  source,
  rowData,
  searchQuery,
  wrapLines,
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

  // ---- render ------------------------------------------------------

  return (
    <Box flexDirection="column">
      {/* Top Level Attributes */}
      {topLevelEntries.length > 0 && (
        <Box flexDirection="column">
          {topLevelEntries.map(([key, value]) => (
            <KVRow key={key} label={key} value={value} wrapLines={wrapLines} />
          ))}
        </Box>
      )}

      {/* Event Attributes */}
      {eventAttrExpr && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text bold>{eventAttrLabel}</Text>
            <Text dimColor>
              {'  '}
              {`{} ${totalEventAttrKeys} key${totalEventAttrKeys !== 1 ? 's' : ''}`}
            </Text>
          </Box>
          <Text dimColor>{'─'.repeat(40)}</Text>
          {filteredEventAttrs ? (
            filteredEventAttrs.map(([key, value]) => (
              <KVRow
                key={key}
                label={`  ${key}`}
                value={value}
                wrapLines={wrapLines}
              />
            ))
          ) : (
            <Text dimColor>
              {searchQuery ? 'No matching attributes.' : 'No attributes.'}
            </Text>
          )}
        </Box>
      )}

      {/* Resource Attributes */}
      {resourceAttrExpr && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Resource Attributes</Text>
          <Text dimColor>{'─'.repeat(40)}</Text>
          {filteredResourceAttrs ? (
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
              {filteredResourceAttrs.map(([key, value]) => (
                <Text key={key} backgroundColor="#3a3a3a">
                  {' '}
                  <Text color="cyan">{key}</Text>
                  <Text color="whiteBright">: {value}</Text>{' '}
                </Text>
              ))}
            </Box>
          ) : (
            <Text dimColor>
              {searchQuery
                ? 'No matching resource attributes.'
                : 'No resource attributes.'}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
