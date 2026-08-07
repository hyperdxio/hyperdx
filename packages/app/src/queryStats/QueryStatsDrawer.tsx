import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { parameterizedQueryToSql } from '@hyperdx/common-utils/dist/clickhouse';
import {
  Badge,
  Box,
  Button,
  Chip,
  CloseButton,
  Code,
  Collapse,
  Drawer,
  Group,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconLoader2,
  IconPlayerStop,
} from '@tabler/icons-react';

import { useClickhouseClient } from '@/clickhouse';

import { currentPathname } from './InstrumentedClickhouseClient';
import {
  clearQueryEvents,
  QueryEvent,
  useQueryEvents,
} from './queryStatsStore';

type Props = {
  opened: boolean;
  onClose: () => void;
};

function StatusIcon({ status }: { status: QueryEvent['status'] }) {
  if (status === 'pending') {
    return (
      <IconLoader2
        size={14}
        className="spin-animate"
        aria-label="pending"
        color="var(--mantine-color-yellow-5)"
      />
    );
  }
  if (status === 'done') {
    return (
      <IconCircleCheck
        size={14}
        aria-label="done"
        color="var(--mantine-color-teal-5)"
      />
    );
  }
  if (status === 'cancelled') {
    return (
      <IconPlayerStop
        size={14}
        aria-label="cancelled"
        color="var(--mantine-color-gray-5)"
      />
    );
  }
  return (
    <IconAlertTriangle
      size={14}
      aria-label="error"
      color="var(--mantine-color-red-5)"
    />
  );
}

function formatDuration(ms?: number): string {
  if (ms == null) return '—';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function durationColor(ms?: number): string {
  if (ms == null) return 'var(--mantine-color-dimmed)';
  if (ms < 2000) return 'var(--mantine-color-teal-4)';
  if (ms < 10000) return 'var(--mantine-color-yellow-4)';
  return 'var(--mantine-color-orange-4)';
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function hydrateSql(sql: string, params: Record<string, any>): string {
  try {
    return parameterizedQueryToSql({ sql, params });
  } catch {
    return sql;
  }
}

// EXPLAIN PLAN only parses against read-only statements; for everything else
// (SHOW/INSERT/ALTER/DROP/etc.) the button would just produce a parse error.
function canExplain(sql: string): boolean {
  return /^\s*(SELECT|WITH)\b/i.test(sql);
}

function QueryRow({ event }: { event: QueryEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hydratedSql = useMemo(
    () => hydrateSql(event.sql, event.params),
    [event.sql, event.params],
  );
  const collapsedSql = useMemo(
    () => collapseWhitespace(hydratedSql),
    [hydratedSql],
  );
  const [explainState, setExplainState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'done'; text: string }
    | { status: 'error'; error: string }
  >({ status: 'idle' });
  const clickhouseClient = useClickhouseClient();

  const runExplain = async () => {
    setExplainState({ status: 'loading' });
    try {
      const response = await clickhouseClient.query<'TabSeparatedRaw'>({
        query: `EXPLAIN PLAN indexes = 1 ${event.sql}`,
        query_params: event.params,
        format: 'TabSeparatedRaw',
        connectionId: event.connectionId,
      });
      const text = await response.text();
      setExplainState({ status: 'done', text });
    } catch (error) {
      setExplainState({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const isError = event.status === 'error';

  return (
    <Box
      px="md"
      py={6}
      style={{
        borderBottom: '1px solid var(--mantine-color-default-border)',
        background: isError ? 'rgba(255, 99, 99, 0.05)' : undefined,
      }}
    >
      <Group
        gap="sm"
        wrap="nowrap"
        align="center"
        style={{ cursor: 'pointer' }}
        onClick={() => setExpanded(v => !v)}
      >
        <Box style={{ width: 16, flexShrink: 0, display: 'flex' }}>
          <StatusIcon status={event.status} />
        </Box>
        <Text
          size="xs"
          ff="monospace"
          fw={600}
          style={{
            width: 64,
            flexShrink: 0,
            textAlign: 'right',
            color: durationColor(event.durationMs),
          }}
        >
          {formatDuration(event.durationMs)}
        </Text>
        {event.kind === 'explain' && (
          <Badge
            size="xs"
            color="gray"
            variant="light"
            style={{ flexShrink: 0 }}
          >
            EXPLAIN
          </Badge>
        )}
        <Text
          size="xs"
          ff="monospace"
          c={isError ? 'red' : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={collapsedSql}
        >
          {collapsedSql}
        </Text>
      </Group>
      <Collapse expanded={expanded}>
        <Box mt="xs" pl={36} pr={8}>
          <Stack gap={6}>
            <Box>
              <Text size="xs" c="dimmed" mb={2}>
                SQL{' '}
                {Object.keys(event.params).length > 0 && (
                  <Text size="xs" c="dimmed" component="span" fs="italic">
                    (params interpolated client-side for readability — not safe
                    to re-run)
                  </Text>
                )}
              </Text>
              <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                {hydratedSql}
              </Code>
            </Box>
            {Object.keys(event.params).length > 0 && (
              <Box>
                <Text size="xs" c="dimmed" mb={2}>
                  Parameterized SQL (as sent to ClickHouse)
                </Text>
                <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                  {event.sql}
                </Code>
              </Box>
            )}
            {Object.keys(event.params).length > 0 && (
              <Box>
                <Text size="xs" c="dimmed" mb={2}>
                  Params
                </Text>
                <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(event.params, null, 2)}
                </Code>
              </Box>
            )}
            {event.error && (
              <Box>
                <Text size="xs" c="red" mb={2}>
                  Error
                </Text>
                <Code
                  block
                  c="red"
                  style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}
                >
                  {event.error}
                </Code>
              </Box>
            )}
            <Group gap="xs" wrap="wrap">
              <Text size="xs" c="dimmed">
                query_id: <Code style={{ fontSize: 10 }}>{event.queryId}</Code>
              </Text>
              {event.connectionId && (
                <Text size="xs" c="dimmed">
                  conn:{' '}
                  <Code style={{ fontSize: 10 }}>{event.connectionId}</Code>
                </Text>
              )}
            </Group>
            {event.kind !== 'explain' && canExplain(event.sql) && (
              <Box onClick={e => e.stopPropagation()}>
                <Group gap="xs">
                  <Button
                    size="compact-xs"
                    variant="secondary"
                    onClick={runExplain}
                    loading={explainState.status === 'loading'}
                    disabled={explainState.status === 'loading'}
                  >
                    Run EXPLAIN
                  </Button>
                </Group>
                {explainState.status === 'done' && (
                  <Code
                    block
                    mt={6}
                    style={{ fontSize: 11, whiteSpace: 'pre' }}
                  >
                    {explainState.text}
                  </Code>
                )}
                {explainState.status === 'error' && (
                  <Code
                    block
                    c="red"
                    mt={6}
                    style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}
                  >
                    {explainState.error}
                  </Code>
                )}
              </Box>
            )}
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
}

export function QueryStatsDrawer({ opened, onClose }: Props) {
  const events = useQueryEvents();
  const [pathFilter, setPathFilter] = useState(true);
  const [showExplain, setShowExplain] = useState(false);
  const router = useRouter();

  // Read from the same source the capture side uses so the strings always
  // match exactly. Re-render on Next.js client-side nav.
  const [currentPath, setCurrentPath] = useState(() => currentPathname());
  useEffect(() => {
    const update = () => setCurrentPath(currentPathname());
    update();
    router.events.on('routeChangeComplete', update);
    return () => router.events.off('routeChangeComplete', update);
  }, [router.events]);

  const visible = useMemo(() => {
    return events
      .filter(e => (showExplain ? true : e.kind !== 'explain'))
      .filter(e => (pathFilter ? e.pathname === currentPath : true))
      .slice()
      .reverse();
  }, [events, pathFilter, showExplain, currentPath]);

  const errorCount = visible.filter(e => e.status === 'error').length;
  const explainCount = events.filter(e => e.kind === 'explain').length;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="50%"
      withCloseButton={false}
      styles={{
        body: { padding: 0, display: 'flex', flexDirection: 'column' },
      }}
    >
      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
        px="md"
        py={6}
        style={{
          borderBottom: '1px solid var(--mantine-color-default-border)',
        }}
      >
        <Group gap="sm" align="center" wrap="nowrap">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.4}>
            Query Stats
          </Text>
          <Text size="xs" c="dimmed">
            {visible.length}
            {errorCount > 0
              ? ` · ${errorCount} error${errorCount === 1 ? '' : 's'}`
              : ''}
          </Text>
          <Chip
            size="xs"
            checked={pathFilter}
            onChange={setPathFilter}
            variant="light"
          >
            This page only
          </Chip>
          <Chip
            size="xs"
            checked={showExplain}
            onChange={setShowExplain}
            variant="light"
          >
            EXPLAINs{explainCount > 0 ? ` (${explainCount})` : ''}
          </Chip>
        </Group>
        <Group gap="xs" align="center" wrap="nowrap">
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={() => clearQueryEvents()}
          >
            Clear
          </Button>
          <CloseButton
            onClick={onClose}
            size="sm"
            variant="subtle"
            aria-label="Close"
          />
        </Group>
      </Group>
      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        {visible.length === 0 ? (
          <Box px="md" py="lg">
            <Text size="sm" c="dimmed">
              No queries captured yet. Interact with the page and they'll show
              up here.
            </Text>
          </Box>
        ) : (
          visible.map(e => <QueryRow key={e.id} event={e} />)
        )}
      </ScrollArea>
    </Drawer>
  );
}
