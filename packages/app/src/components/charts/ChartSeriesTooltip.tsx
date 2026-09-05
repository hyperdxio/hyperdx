import Link from 'next/link';
import {
  ActionIcon,
  Group,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import {
  IconArrowsMaximize,
  IconCheck,
  IconCopy,
  IconFocusCentered,
  IconSearch,
} from '@tabler/icons-react';

import { MAX_EXPANDED_TOOLTIP_ROWS } from '@/defaults';
import type { ActiveClickSeries } from '@/HDXMultiSeriesTimeChart';
import {
  getVisibleTooltipRows,
  MAX_TOOLTIP_ROWS,
} from '@/HDXMultiSeriesTimeChart';
import type { NumberFormat } from '@/types';

import {
  ChartTooltipContainer,
  ChartTooltipHeader,
  ChartTooltipItem,
  useChartTooltipActionZIndex,
} from './ChartTooltip';

/**
 * One pinned-tooltip series row: the shared ChartTooltipItem plus, when
 * `actions` is set, the per-series action cluster (Search / Copy / Focus). The
 * cluster is flexShrink:0 so it doesn't shift as the name truncates or the copy
 * icon swaps to a check (which would move the buttons out from under the cursor).
 *
 * Search is hidden when `actions.drillInUrl` is undefined (source-less charts).
 */
function SeriesRow({
  name,
  dataKey,
  color,
  value,
  previousValue,
  numberFormat,
  actions,
  actionTooltipZIndex,
}: {
  name: string;
  dataKey?: string;
  color?: string;
  value: number;
  previousValue?: number;
  numberFormat?: NumberFormat;
  actions?: {
    /** Drill-in URL; when undefined the Search action is hidden (no source). */
    drillInUrl?: string;
    onDrillIn: () => void;
    onFocus: () => void;
  };
  /** z-index for the action tooltips, so they sit above the pinned popover. */
  actionTooltipZIndex?: number;
}) {
  const clipboard = useClipboard({ timeout: 1500 });

  const item = (
    <ChartTooltipItem
      color={color ?? ''}
      name={name}
      value={value}
      numberFormat={numberFormat}
      indicator="line"
      previous={previousValue}
    />
  );

  if (actions == null) {
    return item;
  }

  return (
    <Group gap={8} wrap="nowrap" justify="space-between">
      <div style={{ minWidth: 0, flex: 1 }}>{item}</div>
      <Group gap={2} wrap="nowrap" justify="flex-end" style={{ flexShrink: 0 }}>
        {actions.drillInUrl != null && (
          <Tooltip
            label="Search (Opens in New Tab)"
            withArrow
            withinPortal
            color="gray"
            position="top"
            zIndex={actionTooltipZIndex}
          >
            <ActionIcon
              component={Link}
              href={actions.drillInUrl}
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
              variant="subtle"
              size="xs"
              data-testid={`chart-view-events-link-${dataKey}`}
              aria-label="Search (Opens in New Tab)"
              onClick={actions.onDrillIn}
            >
              <IconSearch size={13} />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip
          label={clipboard.copied ? 'Copied!' : 'Copy Label'}
          withArrow
          withinPortal
          color="gray"
          position="top"
          zIndex={actionTooltipZIndex}
        >
          <ActionIcon
            variant="subtle"
            size="xs"
            aria-label="Copy Label"
            data-testid={`chart-copy-name-${dataKey}`}
            onClick={() => clipboard.copy(name)}
          >
            {clipboard.copied ? (
              <IconCheck size={13} />
            ) : (
              <IconCopy size={13} />
            )}
          </ActionIcon>
        </Tooltip>
        <Tooltip
          label="Focus"
          withArrow
          withinPortal
          color="gray"
          position="top"
          zIndex={actionTooltipZIndex}
        >
          <ActionIcon
            variant="subtle"
            size="xs"
            aria-label="Focus"
            data-testid={`chart-focus-series-${dataKey}`}
            onClick={actions.onFocus}
          >
            <IconFocusCentered size={13} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}

export type ChartSeriesTooltipProps = {
  /** Bucket label (epoch seconds as a string) for the timestamp header. */
  activeLabel: string;
  /** The series drawn at this bucket (current + previous period). */
  activePayload: ActiveClickSeries[];
  fallbackNumberFormat?: NumberFormat;
  /** Per-value-column number formats, keyed by result column name. */
  numberFormatByKey: Map<string, NumberFormat>;
  previousPeriodOffsetSeconds?: number;
  /** Drill-down URL for the whole bucket (no args) or one series (key + value). */
  buildSearchUrl?: (key?: string, value?: number) => string | null;
  /** Dismiss the tooltip (used by links + focus). */
  onDismiss?: () => void;
  /** Focus a series by its raw key + display name. */
  onFocusSeries?: (payload: { dataKey?: string; name: string }) => void;
  /** Clear an active series focus; renders a "Show All Series" footer action when set. */
  onShowAllSeries?: () => void;
  /**
   * Series dropped by the chart's render cap (i.e. absent from activePayload
   * entirely, not just beyond this tooltip's row cap). Added to the tooltip's
   * own overflow to size the "+N more" affordance against the true total.
   */
  hiddenSeriesCount?: number;
  /**
   * Render every series on the chart, bypassing the cap. When provided, the
   * "+N more" line becomes a button that triggers it (the same escape hatch as
   * the chart's hidden-series warning). Omit to keep "+N more" passive.
   */
  onLoadAllSeries?: () => void;
  /**
   * When true, the caller has already loaded all series ("load all" is active),
   * so the tooltip renders EVERY row (up to `expandedRowCap`) in its scrollable
   * body instead of clamping to MAX_TOOLTIP_ROWS. This is what makes the pinned
   * tooltip's "load all" actually reveal the extra rows: the container
   * (.chartTooltipContent) already scrolls, so lifting the render cap lets the
   * user scroll through the full set. Kept bounded by `expandedRowCap` so a
   * runaway high-cardinality bucket can't mount thousands of row Tooltips.
   */
  expanded?: boolean;
  /**
   * Upper bound on rows rendered when `expanded`. Defaults to
   * MAX_EXPANDED_TOOLTIP_ROWS. Each row mounts several Mantine Tooltips, so this
   * is deliberately well below the chart's materialize ceiling — enough to make
   * "load all" meaningfully bigger than the 20-row preview without mounting
   * thousands of popovers. Series beyond it stay counted in the "+N more" line.
   */
  expandedRowCap?: number;
};

/**
 * The body of the pinned (click-locked) chart tooltip: a header with a close
 * button, one row per series, and a "View All Events" footer. Positioned by the
 * caller (a body-portaled Popover in DBTimeChart). Shares the leaf
 * ChartTooltipItem / ChartTooltipHeader with the hover tooltip to stay aligned.
 */
export function ChartSeriesTooltip({
  activeLabel,
  activePayload,
  fallbackNumberFormat,
  numberFormatByKey,
  previousPeriodOffsetSeconds,
  buildSearchUrl,
  onDismiss,
  onFocusSeries,
  onShowAllSeries,
  hiddenSeriesCount = 0,
  onLoadAllSeries,
  expanded = false,
  expandedRowCap = MAX_EXPANDED_TOOLTIP_ROWS,
}: ChartSeriesTooltipProps) {
  // Called before any early return to keep hook order stable.
  const actionTooltipZIndex = useChartTooltipActionZIndex();

  // Exclude previous-period series from the row list; their comparison is
  // folded into the matching current-period row as a percent-change chip.
  const rows = activePayload
    .filter(
      p => p.value != null && Number.isFinite(p.value) && !p.isPreviousPeriod,
    )
    .sort((a, b) => b.value! - a.value!);

  if (rows.length === 0) {
    return null;
  }

  // Cap rendered rows (each mounts a Mantine Tooltip); rows is value-desc, so
  // this keeps the largest. No cursor concept here — the pin is frozen. Once
  // "load all" is active (`expanded`), render every row (up to expandedRowCap)
  // so the user can scroll the full set instead of being stuck at the 20-row
  // preview; the scrollable container bounds the height either way.
  const rowCap = expanded ? expandedRowCap : MAX_TOOLTIP_ROWS;
  const { rows: visibleRows, hiddenCount: tooltipHiddenCount } =
    getVisibleTooltipRows(rows, undefined, rowCap);

  // Rows not shown = those beyond this tooltip's cap PLUS series the chart's
  // render cap dropped entirely (absent from activePayload). Clicking loads all
  // series onto the chart — the same escape hatch as the hidden-series warning.
  const totalHidden = tooltipHiddenCount + hiddenSeriesCount;

  // Per-series actions only make sense with more than one group (a single series
  // is covered by the header/footer).
  const showPerSeriesActions = rows.length > 1;

  // buildSearchUrl is always supplied but returns null when drill-down isn't
  // possible (no source, or a raw-SQL/PromQL config). The whole-bucket URL is
  // the drill-down signal; it gates the footer and per-series Search.
  const bucketSearchUrl = buildSearchUrl?.() ?? null;
  const canDrillDown = bucketSearchUrl != null;

  // onClose makes the header's X interactive (hover leaves it hidden).
  const header = (
    <ChartTooltipHeader
      labelSeconds={activeLabel}
      previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
      onClose={() => onDismiss?.()}
    />
  );

  const showAllSeriesAction =
    onShowAllSeries != null ? (
      <UnstyledButton
        data-testid="chart-show-all-series"
        onClick={() => {
          onShowAllSeries();
          onDismiss?.();
        }}
      >
        <Group gap={8} py={2}>
          <IconArrowsMaximize size={14} />
          <Text size="xs">Show All Series</Text>
        </Group>
      </UnstyledButton>
    ) : null;

  const viewAllEventsAction = canDrillDown ? (
    <Link
      data-testid="chart-view-events-link"
      href={bucketSearchUrl}
      target="_blank"
      rel="noopener noreferrer"
      prefetch={false}
      onClick={onDismiss}
      style={{ textDecoration: 'none' }}
    >
      <Group gap={8} py={2}>
        <IconSearch size={14} />
        <Text size="xs">View All Events</Text>
      </Group>
    </Link>
  ) : null;

  const footer =
    showAllSeriesAction != null || viewAllEventsAction != null ? (
      <Stack gap={2}>
        {showAllSeriesAction}
        {viewAllEventsAction}
      </Stack>
    ) : undefined;

  return (
    <ChartTooltipContainer header={header} footer={footer}>
      {/* Height bounded by the shared .chartTooltipContent container. */}
      <Stack gap={2}>
        {visibleRows.map((payload, idx) => {
          const name = payload.name ?? payload.dataKey ?? '';
          const rowNumberFormat =
            (payload.valueColumnName != null
              ? numberFormatByKey.get(payload.valueColumnName)
              : undefined) ?? fallbackNumberFormat;
          const seriesUrl =
            showPerSeriesActions && canDrillDown
              ? (buildSearchUrl!(
                  payload.dataKey,
                  Number.isFinite(payload.value) ? payload.value : undefined,
                ) ?? bucketSearchUrl)
              : undefined;
          return (
            <SeriesRow
              key={payload.dataKey ?? name ?? idx}
              name={name}
              dataKey={payload.dataKey}
              color={payload.color}
              value={payload.value!}
              previousValue={payload.previousValue}
              numberFormat={rowNumberFormat}
              actionTooltipZIndex={actionTooltipZIndex}
              actions={
                showPerSeriesActions
                  ? {
                      drillInUrl: seriesUrl ?? undefined,
                      onDrillIn: () => onDismiss?.(),
                      onFocus: () => {
                        onFocusSeries?.({
                          dataKey: payload.dataKey,
                          name,
                        });
                        onDismiss?.();
                      },
                    }
                  : undefined
              }
            />
          );
        })}
        {totalHidden > 0 &&
          (onLoadAllSeries ? (
            <UnstyledButton
              onClick={onLoadAllSeries}
              aria-label={`Load all ${totalHidden.toLocaleString()} more series`}
            >
              <Text size="xs" c="dimmed" fs="italic" pt={2}>
                +{totalHidden.toLocaleString()} more (click to load all)
              </Text>
            </UnstyledButton>
          ) : (
            <Text size="xs" c="dimmed" fs="italic" pt={2}>
              +{totalHidden.toLocaleString()} more
            </Text>
          ))}
      </Stack>
    </ChartTooltipContainer>
  );
}
