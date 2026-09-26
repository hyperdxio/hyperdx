import { useState } from 'react';
import {
  ActionIcon,
  Group,
  Pill,
  SegmentedControl,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconLayoutSidebarLeftExpand, IconSearch } from '@tabler/icons-react';

import { METRIC_KIND_LABELS } from '@/utils/metricKinds';

import { METRIC_QUANTITY_LABELS } from './classifyMetric';
import {
  formatMetricQuery,
  formatMetricQueryToken,
  MetricQueryToken,
  parseMetricQuery,
} from './parseMetricQuery';
import { WallGrouping } from './wallGrouping';

function pillLabel(token: MetricQueryToken): string {
  switch (token.type) {
    case 'quantity':
      return METRIC_QUANTITY_LABELS[token.value];
    case 'kind':
      return METRIC_KIND_LABELS[token.value];
    case 'has':
      return `has ${token.key}`;
    case 'attr':
      return `${token.key} = ${token.value}`;
    case 'unit':
      return `unit ${token.value}`;
  }
}

/**
 * One box for finding and narrowing: typing a filter (`unit:ms`,
 * `has:http.route`, `service.name=api`) turns it into a pill on space.
 */
export function MetricWallSearch({
  query,
  onQueryChange,
  grouping,
  onGroupingChange,
  matchCount,
  totalCount,
  railCollapsed,
  onExpandRail,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  grouping: WallGrouping;
  onGroupingChange: (grouping: WallGrouping) => void;
  matchCount: number;
  totalCount: number;
  railCollapsed: boolean;
  onExpandRail: () => void;
}) {
  const parsed = parseMetricQuery(query);
  // The typed text is held locally so a half-typed `unit:` stays text until
  // the user finishes it.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? parsed.text;

  const commit = (nextText: string) => {
    const next = parseMetricQuery(nextText);
    onQueryChange(
      formatMetricQuery({
        text: next.text,
        tokens: [...parsed.tokens, ...next.tokens],
      }),
    );
  };

  const removeToken = (token: MetricQueryToken) =>
    onQueryChange(
      formatMetricQuery({
        text: parsed.text,
        tokens: parsed.tokens.filter(
          t => formatMetricQueryToken(t) !== formatMetricQueryToken(token),
        ),
      }),
    );

  return (
    <Group gap="xs" mb="xs" wrap="wrap" align="center">
      {railCollapsed && (
        <Tooltip label="Show the filter rail" fz="xs">
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={onExpandRail}
            aria-label="Show the filter rail"
          >
            <IconLayoutSidebarLeftExpand size={14} />
          </ActionIcon>
        </Tooltip>
      )}
      <TextInput
        size="xs"
        style={{ flex: 1, minWidth: 260 }}
        leftSection={<IconSearch size={14} />}
        placeholder="Search metrics, or type unit:ms · has:http.route · service.name=api"
        value={text}
        onChange={e => {
          const value = e.currentTarget.value;
          if (value.endsWith(' ') && parseMetricQuery(value).tokens.length) {
            setDraft(null);
            commit(value);
            return;
          }
          setDraft(value);
          if (!parseMetricQuery(value).tokens.length) commit(value);
        }}
        onBlur={() => {
          if (draft != null) commit(draft);
          setDraft(null);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            commit(text);
            setDraft(null);
          } else if (
            e.key === 'Backspace' &&
            text === '' &&
            parsed.tokens.length > 0
          ) {
            removeToken(parsed.tokens[parsed.tokens.length - 1]);
          }
        }}
        data-testid="metric-wall-search"
      />
      {parsed.tokens.map(token => (
        <Pill
          key={formatMetricQueryToken(token)}
          withRemoveButton
          onRemove={() => removeToken(token)}
          size="sm"
        >
          {pillLabel(token)}
        </Pill>
      ))}
      <Text size="xs" c="dimmed">
        {matchCount === totalCount
          ? `${totalCount} metrics`
          : `${matchCount} of ${totalCount} metrics`}
      </Text>
      <SegmentedControl
        size="xs"
        value={grouping}
        onChange={v => onGroupingChange(v as WallGrouping)}
        data={[
          { value: 'entity', label: 'Entity' },
          { value: 'quantity', label: 'Quantity' },
          { value: 'flat', label: 'Flat' },
        ]}
        aria-label="Group metrics by"
      />
    </Group>
  );
}
