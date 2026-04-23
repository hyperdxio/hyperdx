import type { OnClick, OnClickDashboard, OnClickSearch } from '../types';
import {
  LinkTemplateError,
  MissingTemplateVariableError,
  renderLinkTemplate,
  validateTemplate,
} from './linkTemplate';

export type LinkBuildResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

function renderOrError(
  template: string,
  rowData: Record<string, unknown>,
): { ok: true; value: string } | { ok: false; error: string } {
  try {
    return { ok: true, value: renderLinkTemplate(template, rowData) };
  } catch (err) {
    const message =
      err instanceof MissingTemplateVariableError
        ? `Row has no column '${err.variable}'`
        : err instanceof LinkTemplateError
          ? err.message
          : String(err);
    return {
      ok: false,
      error: message,
    };
  }
}

/**
 * Render an OnClickSearch to a URL.
 */
export function renderOnClickSearch({
  onClick,
  row,
  sourceIds,
  sourceIdsByName,
  dateRange,
}: {
  onClick: OnClickSearch;
  row: Record<string, unknown>;
  sourceIds: Set<string>;
  sourceIdsByName: Map<string, string[]>;
  dateRange: [Date, Date];
}): LinkBuildResult {
  let sourceId;
  if (onClick.target.mode === 'id') {
    if (!sourceIds.has(onClick.target.id)) {
      return {
        ok: false,
        error: `Could not find source with ID '${onClick.target.id}'`,
      };
    }
    sourceId = onClick.target.id;
  } else {
    // Render the source name template
    const sourceNameRenderResult = renderOrError(onClick.target.template, row);
    if (!sourceNameRenderResult.ok) return sourceNameRenderResult;

    // Find the matching source's ID
    const sourceName = sourceNameRenderResult.value.trim();
    if (sourceName === '') {
      return {
        ok: false,
        error: 'Source name is empty',
      };
    }

    const sourceIds = sourceIdsByName.get(sourceName) ?? [];
    if (sourceIds.length === 0) {
      return {
        ok: false,
        error: `Could not find source '${sourceName}'`,
      };
    }
    if (sourceIds.length > 1) {
      return {
        ok: false,
        error: `Multiple sources named '${sourceName}' — source names must be unique to use them in a link`,
      };
    }
    sourceId = sourceIds[0];
  }

  let where = '';
  if (onClick.whereTemplate) {
    const whereResult = renderOrError(onClick.whereTemplate, row);
    if (!whereResult.ok) return whereResult;
    where = whereResult.value;
  }

  const params = new URLSearchParams({
    source: sourceId,
    where,
    whereLanguage: onClick.whereLanguage ?? 'lucene',
    isLive: 'false',
    from: String(dateRange[0].getTime()),
    to: String(dateRange[1].getTime()),
  });
  return { ok: true, url: `/search?${params.toString()}` };
}

/**
 * Render an OnClickDashboard to a /dashboards URL, or returns an error if rendering fails.
 */
export function renderOnClickDashboard({
  onClick,
  row,
  dashboardIds,
  dashboardIdsByName,
  dateRange,
}: {
  onClick: OnClickDashboard;
  row: Record<string, unknown>;
  dashboardIds: Set<string>;
  dashboardIdsByName: Map<string, string[]>;
  dateRange: [Date, Date];
}): LinkBuildResult {
  let dashboardId;
  if (onClick.target.mode === 'id') {
    if (!dashboardIds.has(onClick.target.id)) {
      return {
        ok: false,
        error: `Could not find dashboard with ID '${onClick.target.id}'`,
      };
    }
    dashboardId = onClick.target.id;
  } else {
    // Render the dashboard name template
    const dashboardNameRenderResult = renderOrError(
      onClick.target.template,
      row,
    );
    if (!dashboardNameRenderResult.ok) return dashboardNameRenderResult;

    // Find the matching dashboard's ID
    const dashboardName = dashboardNameRenderResult.value.trim();
    if (dashboardName === '') {
      return {
        ok: false,
        error: 'Dashboard name is empty',
      };
    }

    const dashboardIds = dashboardIdsByName.get(dashboardName) ?? [];
    if (dashboardIds.length === 0) {
      return {
        ok: false,
        error: `Could not find dashboard '${dashboardName}'`,
      };
    }
    if (dashboardIds.length > 1) {
      return {
        ok: false,
        error: `Multiple dashboards named '${dashboardName}' — dashboard names must be unique to use them in a link`,
      };
    }
    dashboardId = dashboardIds[0];
  }

  // Render the dashboard's global WHERE condition, if any
  let where = '';
  if (onClick.whereTemplate) {
    const whereResult = renderOrError(onClick.whereTemplate, row);
    if (!whereResult.ok) return whereResult;
    where = whereResult.value;
  }

  const params = new URLSearchParams({
    where,
    whereLanguage: onClick.whereLanguage ?? 'lucene',
    from: String(dateRange[0].getTime()),
    to: String(dateRange[1].getTime()),
  });

  return { ok: true, url: `/dashboards/${dashboardId}?${params.toString()}` };
}

/** Throws if the given OnClick includes a template with invalid syntax */
export function validateOnClickTemplate(onClick: OnClick) {
  if (onClick.target.mode === 'template') {
    validateTemplate(onClick.target.template);
  }
  if (onClick.whereTemplate) {
    validateTemplate(onClick.whereTemplate);
  }
}
