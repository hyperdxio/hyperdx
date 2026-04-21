import type { OnClickSearch } from '../types';
import {
  LinkTemplateError,
  MissingTemplateVariableError,
  renderLinkTemplate,
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
 * Render an OnClickSearch
 *
 * Returns the rendered pieces; callers in should assemble the final URL
 * with {@link buildSearchLinkRequest} and their existing search URL builder
 * (e.g. ChartUtils.buildEventsSearchUrl) since that needs frontend-only
 * pieces (metric source resolution, etc.).
 */
export function renderOnClickSearch({
  onClick,
  row,
  sourceIdsByName,
  dateRange,
}: {
  onClick: OnClickSearch;
  row: Record<string, unknown>;
  sourceIdsByName: Map<string, string>;
  dateRange: [Date, Date];
}): LinkBuildResult {
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

  const sourceId = sourceIdsByName.get(sourceName);
  if (!sourceId) {
    return {
      ok: false,
      error: `Could not find source '${sourceName}'`,
    };
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
