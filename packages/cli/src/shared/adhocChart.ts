/**
 * Ad-hoc chart config building for the `hdx chart` command.
 *
 * Turns CLI flags into the same SavedChartConfig shape a saved
 * dashboard tile carries, so ad-hoc charts flow through the identical
 * resolveTileConfig → queryChartConfig (renderChartConfig) pipeline as
 * dashboard tiles and the web UI.
 */

import type { SavedChartConfig } from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import type { SourceResponse } from '@/api/client';

export interface AdhocChartFlags {
  source?: string;
  sql?: string;
  connectionId?: string;
  display?: string;
  agg?: string;
  value?: string;
  level?: string;
  metricType?: string;
  metricName?: string;
  where?: string;
  language?: string;
  groupBy?: string;
  series?: string[];
}

/** Display types accepted by --display. */
const ADHOC_DISPLAY_TYPES: Record<string, DisplayType> = {
  line: DisplayType.Line,
  stacked_bar: DisplayType.StackedBar,
  number: DisplayType.Number,
  table: DisplayType.Table,
  bar: DisplayType.Bar,
  pie: DisplayType.Pie,
};

export class AdhocChartError extends Error {}

export function parseDisplayType(display: string | undefined): DisplayType {
  const displayType = ADHOC_DISPLAY_TYPES[display ?? 'line'];
  if (!displayType) {
    throw new AdhocChartError(
      `Invalid --display "${display}". Supported: ${Object.keys(ADHOC_DISPLAY_TYPES).join(', ')}.`,
    );
  }
  return displayType;
}

/** Find a source by ID, _id, or case-insensitive name. */
export function findSource(
  sources: SourceResponse[],
  nameOrId: string,
): SourceResponse | undefined {
  const needle = nameOrId.toLowerCase();
  return sources.find(
    s =>
      s.id === nameOrId ||
      s._id === nameOrId ||
      s.name.toLowerCase() === needle,
  );
}

type SelectItem = Record<string, unknown>;

/**
 * Build the `select` list from flags: repeatable `--series <json>`
 * items win; otherwise a single series from --agg/--value(/--level,
 * --metric-type, --metric-name).
 */
function buildSelect(flags: AdhocChartFlags): SelectItem[] {
  if (flags.series && flags.series.length > 0) {
    return flags.series.map((raw, i) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new AdhocChartError(
          `--series[${i}] is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (typeof parsed !== 'object' || parsed === null) {
        throw new AdhocChartError(
          `--series[${i}] must be a JSON object like {"aggFn":"avg","valueExpression":"Duration"}.`,
        );
      }
      const item = parsed as SelectItem;
      return {
        aggCondition: '',
        aggConditionLanguage: 'lucene',
        valueExpression: '',
        ...item,
      };
    });
  }

  const aggFn = flags.agg ?? 'count';
  const item: SelectItem = {
    aggFn,
    aggCondition: '',
    aggConditionLanguage: 'lucene',
    valueExpression: flags.value ?? '',
  };

  if (aggFn !== 'count' && !flags.value && !flags.metricName) {
    throw new AdhocChartError(
      `--agg ${aggFn} requires --value <expression> (e.g. --value Duration).`,
    );
  }

  if (aggFn === 'quantile') {
    const level = flags.level ? Number(flags.level) : 0.95;
    if (!Number.isFinite(level) || level <= 0 || level >= 1) {
      throw new AdhocChartError(
        `Invalid --level "${flags.level}". Use a fraction like 0.5, 0.95, 0.99.`,
      );
    }
    item.level = level;
  }

  if (flags.metricType) {
    item.metricType = flags.metricType;
  }
  if (flags.metricName) {
    item.metricName = flags.metricName;
    // Metric queries aggregate the metric's Value column by default
    if (!flags.value) {
      item.valueExpression = 'Value';
    }
  }

  return [item];
}

export interface AdhocChartResult {
  config: SavedChartConfig;
  source: SourceResponse | undefined;
  /** Short human/agent-readable description for output headers */
  label: string;
}

/**
 * Build an ad-hoc SavedChartConfig from CLI flags.
 *
 * Modes:
 *  - Raw SQL: --sql plus --source or --connection-id
 *  - Builder: --source plus --agg/--value/--where/--group-by/--series
 */
export function buildAdhocChartConfig(
  flags: AdhocChartFlags,
  sources: SourceResponse[],
): AdhocChartResult {
  const displayType = parseDisplayType(flags.display);

  const source = flags.source ? findSource(sources, flags.source) : undefined;
  if (flags.source && !source) {
    throw new AdhocChartError(
      `Source "${flags.source}" not found. Run 'hdx sources' to list available sources.`,
    );
  }

  // ---- Raw SQL mode
  if (flags.sql) {
    const connection = flags.connectionId ?? source?.connection;
    if (!connection) {
      throw new AdhocChartError(
        '--sql requires --source <name|id> or --connection-id <id> to resolve the ClickHouse connection.',
      );
    }
    const config: SavedChartConfig = {
      name: 'Ad-hoc SQL chart',
      configType: 'sql',
      sqlTemplate: flags.sql,
      connection,
      source: source?.id,
      displayType,
    };
    return {
      config,
      source,
      label: flags.sql.replace(/\s+/g, ' ').slice(0, 80),
    };
  }

  // ---- Builder mode
  if (!source) {
    throw new AdhocChartError(
      'Ad-hoc charts require --source <name|id> (builder mode) or --sql with --source/--connection-id (raw SQL mode).',
    );
  }

  if (
    (flags.metricType || flags.metricName) &&
    !(flags.metricType && flags.metricName)
  ) {
    throw new AdhocChartError(
      'Metric queries require both --metric-type and --metric-name.',
    );
  }
  if (flags.metricType && source.kind !== 'metric') {
    throw new AdhocChartError(
      `--metric-type requires a metric source; "${source.name}" is a ${source.kind} source.`,
    );
  }

  const select = buildSelect(flags);

  const config = {
    name: 'Ad-hoc chart',
    source: source.id,
    displayType,
    select,
    where: flags.where ?? '',
    whereLanguage: flags.language === 'sql' ? 'sql' : 'lucene',
    ...(flags.groupBy ? { groupBy: flags.groupBy } : {}),
  } as unknown as SavedChartConfig;

  const selectLabel = select
    .map(s =>
      s.metricName
        ? `${s.aggFn ?? 'avg'}(${s.metricName})`
        : `${s.aggFn}(${s.valueExpression || ''})`,
    )
    .join(', ');
  const labelParts = [
    selectLabel,
    flags.where ? `where ${flags.where}` : '',
    flags.groupBy ? `by ${flags.groupBy}` : '',
  ].filter(Boolean);

  return { config, source, label: labelParts.join(' ').slice(0, 100) };
}
