import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import Spinner from 'ink-spinner';

import type { ApiClient, AlertItem, AlertHistoryItem } from '@/api/client';

// ---- Helpers -------------------------------------------------------

function stateColor(
  state?: string,
): 'red' | 'green' | 'yellow' | 'gray' | undefined {
  switch (state) {
    case 'ALERT':
      return 'red';
    case 'OK':
      return 'green';
    case 'INSUFFICIENT_DATA':
      return 'yellow';
    case 'DISABLED':
      return 'gray';
    default:
      return undefined;
  }
}

function stateLabel(state?: string): string {
  switch (state) {
    case 'ALERT':
      return 'FIRING';
    case 'OK':
      return 'OK';
    case 'INSUFFICIENT_DATA':
      return 'NO DATA';
    case 'DISABLED':
      return 'DISABLED';
    default:
      return 'UNKNOWN';
  }
}

function alertName(alert: AlertItem): string {
  if (alert.name) return alert.name;
  if (alert.dashboard) {
    const tile = alert.dashboard.tiles.find(t => t.id === alert.tileId);
    const tileName = tile?.config.name ?? alert.tileId ?? '';
    return `${alert.dashboard.name} — ${tileName}`;
  }
  if (alert.savedSearch) {
    return alert.savedSearch.name;
  }
  return `Alert ${alert._id.slice(-6)}`;
}

function alertSourceLabel(alert: AlertItem): string {
  if (alert.source === 'tile') return 'tile';
  if (alert.source === 'saved_search') return 'search';
  return alert.source ?? '';
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---- Component -----------------------------------------------------

interface AlertsPageProps {
  client: ApiClient;
  onClose: () => void;
}

export default function AlertsPage({ client, onClose }: AlertsPageProps) {
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;

  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Reserve rows for header (2) + footer (2) = 4 lines overhead
  const listMaxRows = Math.max(1, termHeight - 4);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.getAlerts();
      setAlerts(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // Sort: ALERT first, then by updatedAt descending
  const sortedAlerts = useMemo(() => {
    return [...alerts].sort((a, b) => {
      if (a.state === 'ALERT' && b.state !== 'ALERT') return -1;
      if (b.state === 'ALERT' && a.state !== 'ALERT') return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [alerts]);

  const visibleCount = Math.min(
    sortedAlerts.length - scrollOffset,
    listMaxRows,
  );

  useInput((input, key) => {
    // Close alerts page
    if (key.escape || input === 'h' || input === 'q') {
      if (expandedIdx !== null) {
        setExpandedIdx(null);
        return;
      }
      onClose();
      return;
    }

    // Refresh
    if (input === 'r') {
      fetchAlerts();
      return;
    }

    // Navigate
    if (input === 'j' || key.downArrow) {
      if (expandedIdx !== null) return; // no nav in expanded view
      setSelectedIdx(i => {
        const next = i + 1;
        if (next >= listMaxRows) {
          setScrollOffset(o =>
            Math.min(o + 1, Math.max(0, sortedAlerts.length - listMaxRows)),
          );
          return i;
        }
        return Math.min(next, visibleCount - 1);
      });
      return;
    }
    if (input === 'k' || key.upArrow) {
      if (expandedIdx !== null) return;
      setSelectedIdx(i => {
        const next = i - 1;
        if (next < 0) {
          setScrollOffset(o => Math.max(0, o - 1));
          return 0;
        }
        return next;
      });
      return;
    }

    // Expand/collapse detail
    if (key.return || input === 'l') {
      if (expandedIdx !== null) {
        setExpandedIdx(null);
      } else {
        setExpandedIdx(scrollOffset + selectedIdx);
      }
      return;
    }

    // Jump to top/bottom
    if (input === 'g') {
      setScrollOffset(0);
      setSelectedIdx(0);
      return;
    }
    if (input === 'G') {
      const maxOffset = Math.max(0, sortedAlerts.length - listMaxRows);
      setScrollOffset(maxOffset);
      setSelectedIdx(Math.min(sortedAlerts.length - 1, listMaxRows - 1));
      return;
    }
  });

  // ---- Expanded detail view ----------------------------------------
  if (expandedIdx !== null && sortedAlerts[expandedIdx]) {
    const alert = sortedAlerts[expandedIdx];
    return (
      <Box flexDirection="column" paddingX={1} height={termHeight}>
        <Box>
          <Text bold color="cyan">
            HyperDX
          </Text>
          <Text> — </Text>
          <Text bold>Alert Detail</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Box width={16}>
              <Text bold dimColor>
                Name
              </Text>
            </Box>
            <Text>{alertName(alert)}</Text>
          </Box>
          <Box>
            <Box width={16}>
              <Text bold dimColor>
                State
              </Text>
            </Box>
            <Text color={stateColor(alert.state)}>
              {stateLabel(alert.state)}
            </Text>
          </Box>
          <Box>
            <Box width={16}>
              <Text bold dimColor>
                Source
              </Text>
            </Box>
            <Text>{alertSourceLabel(alert)}</Text>
          </Box>
          <Box>
            <Box width={16}>
              <Text bold dimColor>
                Threshold
              </Text>
            </Box>
            <Text>
              {alert.thresholdType} {alert.threshold}
            </Text>
          </Box>
          <Box>
            <Box width={16}>
              <Text bold dimColor>
                Interval
              </Text>
            </Box>
            <Text>{alert.interval}</Text>
          </Box>
          <Box>
            <Box width={16}>
              <Text bold dimColor>
                Channel
              </Text>
            </Box>
            <Text>{alert.channel.type ?? 'none'}</Text>
          </Box>
          {alert.createdBy && (
            <Box>
              <Box width={16}>
                <Text bold dimColor>
                  Created by
                </Text>
              </Box>
              <Text>{alert.createdBy.name ?? alert.createdBy.email}</Text>
            </Box>
          )}
          {alert.silenced && (
            <Box>
              <Box width={16}>
                <Text bold dimColor>
                  Silenced
                </Text>
              </Box>
              <Text color="yellow">
                until {formatTimestamp(alert.silenced.until)}
              </Text>
            </Box>
          )}
          {alert.dashboard && (
            <Box>
              <Box width={16}>
                <Text bold dimColor>
                  Dashboard
                </Text>
              </Box>
              <Text>{alert.dashboard.name}</Text>
            </Box>
          )}
          {alert.savedSearch && (
            <Box>
              <Box width={16}>
                <Text bold dimColor>
                  Saved Search
                </Text>
              </Box>
              <Text>{alert.savedSearch.name}</Text>
            </Box>
          )}
        </Box>

        {/* Recent history */}
        <Box marginTop={1} flexDirection="column">
          <Text bold dimColor>
            Recent History ({alert.history.length} entries)
          </Text>
          {alert.history.length === 0 ? (
            <Text dimColor>No recent trigger history</Text>
          ) : (
            alert.history
              .slice(0, termHeight - 18)
              .map((h, i) => <HistoryRow key={i} history={h} />)
          )}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Esc/h=back r=refresh</Text>
        </Box>
      </Box>
    );
  }

  // ---- List view ---------------------------------------------------
  return (
    <Box flexDirection="column" paddingX={1} height={termHeight}>
      <Box>
        <Text bold color="cyan">
          HyperDX
        </Text>
        <Text> — </Text>
        <Text bold>Alerts</Text>
        <Text dimColor> ({sortedAlerts.length} total)</Text>
        {loading && (
          <Text>
            {' '}
            <Spinner type="dots" />
          </Text>
        )}
      </Box>

      {error && <Text color="red">Error: {error.slice(0, 200)}</Text>}

      {!loading && sortedAlerts.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No alerts configured.</Text>
        </Box>
      )}

      {sortedAlerts.length > 0 && (
        <Box flexDirection="column">
          {/* Column headers */}
          <Box overflowX="hidden">
            <Box width="8%">
              <Text bold dimColor wrap="truncate">
                STATE
              </Text>
            </Box>
            <Box width="30%">
              <Text bold dimColor wrap="truncate">
                NAME
              </Text>
            </Box>
            <Box width="10%">
              <Text bold dimColor wrap="truncate">
                SOURCE
              </Text>
            </Box>
            <Box width="12%">
              <Text bold dimColor wrap="truncate">
                THRESHOLD
              </Text>
            </Box>
            <Box width="10%">
              <Text bold dimColor wrap="truncate">
                INTERVAL
              </Text>
            </Box>
            <Box width="15%">
              <Text bold dimColor wrap="truncate">
                LAST TRIGGER
              </Text>
            </Box>
            <Box width="15%">
              <Text bold dimColor wrap="truncate">
                UPDATED
              </Text>
            </Box>
          </Box>

          {/* Alert rows */}
          {sortedAlerts
            .slice(scrollOffset, scrollOffset + listMaxRows)
            .map((alert, i) => {
              const isSelected = i === selectedIdx;
              const lastTrigger = alert.history.find(h => h.state === 'ALERT');

              return (
                <Box key={alert._id} overflowX="hidden">
                  <Box width="8%">
                    <Text
                      color={stateColor(alert.state)}
                      bold={alert.state === 'ALERT'}
                      inverse={isSelected}
                      wrap="truncate"
                    >
                      {stateLabel(alert.state)}
                    </Text>
                  </Box>
                  <Box width="30%">
                    <Text inverse={isSelected} wrap="truncate">
                      {alertName(alert)}
                      {alert.silenced ? ' (silenced)' : ''}
                    </Text>
                  </Box>
                  <Box width="10%">
                    <Text
                      dimColor={!isSelected}
                      inverse={isSelected}
                      wrap="truncate"
                    >
                      {alertSourceLabel(alert)}
                    </Text>
                  </Box>
                  <Box width="12%">
                    <Text
                      dimColor={!isSelected}
                      inverse={isSelected}
                      wrap="truncate"
                    >
                      {alert.thresholdType} {alert.threshold}
                    </Text>
                  </Box>
                  <Box width="10%">
                    <Text
                      dimColor={!isSelected}
                      inverse={isSelected}
                      wrap="truncate"
                    >
                      {alert.interval}
                    </Text>
                  </Box>
                  <Box width="15%">
                    <Text
                      dimColor={!isSelected}
                      inverse={isSelected}
                      wrap="truncate"
                    >
                      {lastTrigger
                        ? formatRelativeTime(lastTrigger.createdAt)
                        : '—'}
                    </Text>
                  </Box>
                  <Box width="15%">
                    <Text
                      dimColor={!isSelected}
                      inverse={isSelected}
                      wrap="truncate"
                    >
                      {formatRelativeTime(alert.updatedAt)}
                    </Text>
                  </Box>
                </Box>
              );
            })}
        </Box>
      )}

      <Box marginTop={1} justifyContent="space-between">
        <Text dimColor>Esc/h=back r=refresh Enter/l=detail q=quit</Text>
        <Text dimColor>
          {sortedAlerts.length > 0
            ? `${scrollOffset + selectedIdx + 1}/${sortedAlerts.length}`
            : ''}
        </Text>
      </Box>
    </Box>
  );
}

// ---- History row sub-component -------------------------------------

function HistoryRow({ history }: { history: AlertHistoryItem }) {
  return (
    <Box>
      <Box width={12}>
        <Text
          color={stateColor(history.state)}
          bold={history.state === 'ALERT'}
        >
          {stateLabel(history.state)}
        </Text>
      </Box>
      <Box width={20}>
        <Text dimColor>{formatTimestamp(history.createdAt)}</Text>
      </Box>
      <Box>
        <Text dimColor>
          count={history.counts}
          {history.lastValues.length > 0 &&
            ` val=${history.lastValues[0].count}`}
        </Text>
      </Box>
    </Box>
  );
}
