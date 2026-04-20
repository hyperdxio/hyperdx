import SqlString from 'sqlstring';

import type {
  Filter,
  TableOnClickDashboard,
  TableOnClickFilterTemplate,
} from '../types';
import {
  LinkTemplateError,
  MissingTemplateVariableError,
  renderLinkTemplate,
} from './linkTemplate';

export type LinkBuildResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export type DashboardLookup = {
  /**
   * Map from case-insensitive dashboard name to all dashboard ids that share
   * that name. Names are not unique per team, so the list may contain more
   * than one entry — the caller surfaces an error for ambiguous resolutions.
   */
  nameToIds: Map<string, string[]>;
};

type ErrorPrefix = 'Dashboard link' | 'Search link';

function renderOrError(
  template: string,
  ctx: Record<string, unknown>,
  errorPrefix: ErrorPrefix,
): { ok: true; value: string } | { ok: false; error: string } {
  try {
    return { ok: true as const, value: renderLinkTemplate(template, ctx) };
  } catch (err) {
    if (err instanceof MissingTemplateVariableError) {
      return {
        ok: false as const,
        error: `${errorPrefix}: row has no column '${err.variable}'`,
      };
    }
    const msg = err instanceof LinkTemplateError ? err.message : String(err);
    return {
      ok: false as const,
      error: `${errorPrefix}: template error: ${msg}`,
    };
  }
}

function escapeSqlValue(value: string): string {
  return SqlString.escape(value);
}

/**
 * Render the filter entries into `{expression} IN (v1, v2, ...)` SQL
 * conditions. Entries that share the same `filter` expression are merged
 * into a single IN clause so the destination sees all requested values.
 * Expressions appear in the URL in order of first occurrence; values within
 * a group retain their input order.
 */
function renderFilterTemplates(
  entries: TableOnClickFilterTemplate[] | undefined,
  row: Record<string, unknown>,
  errorPrefix: ErrorPrefix,
): { ok: true; filters: Filter[] } | { ok: false; error: string } {
  if (!entries || entries.length === 0) return { ok: true, filters: [] };

  // Map preserves insertion order, keyed by expression.
  const grouped = new Map<string, string[]>();
  for (const entry of entries) {
    if (!entry.template || !entry.filter) continue;
    const rendered = renderOrError(entry.template, row, errorPrefix);
    if (!rendered.ok) return rendered;
    const existing = grouped.get(entry.filter);
    if (existing) existing.push(rendered.value);
    else grouped.set(entry.filter, [rendered.value]);
  }

  const filters: Filter[] = [];
  for (const [expression, values] of grouped) {
    const escaped = values.map(escapeSqlValue).join(', ');
    filters.push({ type: 'sql', condition: `${expression} IN (${escaped})` });
  }
  return { ok: true, filters };
}

/**
 * Build a URL to navigate from a table row click to another dashboard.
 * For `mode: 'name-template'`, resolves the rendered dashboard name against
 * the supplied lookup (case-insensitive). Since dashboard names are not
 * unique per team, ambiguous resolutions surface an error rather than
 * silently picking one. Renders handlebars templates with the row context
 * and appends the current dashboard's time range so it is preserved across
 * navigation.
 */
export function buildDashboardLinkUrl({
  onClick,
  row,
  dateRange,
  dashboards,
}: {
  onClick: TableOnClickDashboard;
  row: Record<string, unknown>;
  dateRange: [Date, Date];
  dashboards: DashboardLookup;
}): LinkBuildResult {
  let dashboardId: string;
  if (onClick.target.mode === 'id') {
    if (!onClick.target.dashboardId) {
      return {
        ok: false,
        error: 'Dashboard link: no target dashboard selected',
      };
    }
    dashboardId = onClick.target.dashboardId;
  } else {
    const nameResult = renderOrError(
      onClick.target.nameTemplate,
      row,
      'Dashboard link',
    );
    if (!nameResult.ok) return nameResult;
    const name = nameResult.value.trim();
    if (name === '') {
      return {
        ok: false,
        error: 'Dashboard link: name template rendered empty',
      };
    }
    const mappedIds = dashboards.nameToIds.get(name.toLowerCase()) ?? [];
    if (mappedIds.length === 0) {
      return {
        ok: false,
        error: `Dashboard link: no dashboard named '${name}' was found`,
      };
    }
    if (mappedIds.length > 1) {
      return {
        ok: false,
        error: `Dashboard link: dashboard name '${name}' matches ${mappedIds.length} dashboards — names must be unique to be used as a link target`,
      };
    }
    dashboardId = mappedIds[0];
  }

  const params = new URLSearchParams();
  params.set('from', String(dateRange[0].getTime()));
  params.set('to', String(dateRange[1].getTime()));

  if (onClick.whereTemplate) {
    const whereResult = renderOrError(
      onClick.whereTemplate,
      row,
      'Dashboard link',
    );
    if (!whereResult.ok) return whereResult;
    params.set('where', whereResult.value);
    if (onClick.whereLanguage) {
      params.set('whereLanguage', onClick.whereLanguage);
    }
  }

  const rendered = renderFilterTemplates(
    onClick.filterValueTemplates,
    row,
    'Dashboard link',
  );
  if (!rendered.ok) return rendered;
  if (rendered.filters.length > 0) {
    params.set('filters', JSON.stringify(rendered.filters));
  }

  return { ok: true, url: `/dashboards/${dashboardId}?${params.toString()}` };
}

/**
 * Build a URL to navigate from a table row click to the search page.
 *
 * Returns the rendered pieces; callers in app/ should assemble the final URL
 * with {@link buildSearchLinkRequest} and their existing search URL builder
 * (e.g. ChartUtils.buildEventsSearchUrl) since that needs frontend-only
 * pieces (metric source resolution, etc.).
 */
export type RenderedSearchLink = {
  sourceId?: string;
  sourceResolvedFrom: 'id' | 'template-id' | 'template-name';
  where: string;
  whereLanguage: string | undefined;
  filters: Filter[];
};

export function renderSearchLinkPieces({
  onClick,
  row,
  sourcesById,
  sourcesByName,
}: {
  onClick: import('../types').TableOnClickSearch;
  row: Record<string, unknown>;
  sourcesById: Map<string, { id: string; name: string }>;
  sourcesByName: Map<string, { id: string; name: string }>;
}): { ok: true; value: RenderedSearchLink } | { ok: false; error: string } {
  let sourceId: string;
  let sourceResolvedFrom: RenderedSearchLink['sourceResolvedFrom'];
  if (onClick.source.mode === 'id') {
    sourceId = onClick.source.sourceId;
    if (!sourceId) {
      return { ok: false, error: 'Search link: no target source selected' };
    }
    if (!sourcesById.has(sourceId)) {
      return {
        ok: false,
        error: `Search link: source id '${sourceId}' not found`,
      };
    }
    sourceResolvedFrom = 'id';
  } else {
    const rendered = renderOrError(
      onClick.source.sourceTemplate,
      row,
      'Search link',
    );
    if (!rendered.ok) return rendered;
    const value = rendered.value.trim();
    if (value === '') {
      return {
        ok: false,
        error: 'Search link: source template rendered empty',
      };
    }
    if (sourcesById.has(value)) {
      sourceId = value;
      sourceResolvedFrom = 'template-id';
    } else {
      const byName = sourcesByName.get(value.toLowerCase());
      if (!byName) {
        return {
          ok: false,
          error: `Search link: could not resolve source '${value}'`,
        };
      }
      sourceId = byName.id;
      sourceResolvedFrom = 'template-name';
    }
  }

  let where = '';
  if (onClick.whereTemplate) {
    const whereResult = renderOrError(
      onClick.whereTemplate,
      row,
      'Search link',
    );
    if (!whereResult.ok) return whereResult;
    where = whereResult.value;
  }

  const rendered = renderFilterTemplates(
    onClick.filterValueTemplates,
    row,
    'Search link',
  );
  if (!rendered.ok) return rendered;

  return {
    ok: true,
    value: {
      sourceId,
      sourceResolvedFrom,
      where,
      whereLanguage: onClick.whereLanguage,
      filters: rendered.filters,
    },
  };
}

/**
 * Convenience: assemble a full /search URL from the rendered pieces. Used
 * when the caller does not need the fancier behavior of ChartUtils
 * buildEventsSearchUrl (no metric-source remapping, no groupFilters).
 */
export function buildSearchLinkUrlFromPieces({
  pieces,
  dateRange,
}: {
  pieces: RenderedSearchLink;
  dateRange: [Date, Date];
}): string {
  const params = new URLSearchParams({
    source: pieces.sourceId ?? '',
    where: pieces.where,
    whereLanguage: pieces.whereLanguage ?? 'lucene',
    filters: JSON.stringify(pieces.filters),
    isLive: 'false',
    from: String(dateRange[0].getTime()),
    to: String(dateRange[1].getTime()),
  });
  return `/search?${params.toString()}`;
}
