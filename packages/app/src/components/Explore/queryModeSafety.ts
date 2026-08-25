import {
  type FilterState,
  filtersToQuery,
} from '@hyperdx/common-utils/dist/filters';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

const EXPLORE_LANGUAGE_KEY_PREFIX = 'hdx-explore-where-language:';

export type QueryLanguage = 'sql' | 'lucene';

export type QueryEditorMode = 'lucene' | 'sql' | 'raw';

export function getDefaultExploreLanguage(kind?: SourceKind): QueryLanguage {
  if (kind === SourceKind.Metric || kind === SourceKind.Promql) {
    return 'sql';
  }
  return 'lucene';
}

export function getExploreWhereLanguage(kind?: SourceKind): QueryLanguage {
  if (typeof window !== 'undefined' && kind != null) {
    try {
      const stored = window.localStorage.getItem(
        `${EXPLORE_LANGUAGE_KEY_PREFIX}${kind}`,
      );
      if (stored === 'sql' || stored === 'lucene') {
        return stored;
      }
    } catch {
      // localStorage may throw in private browsing
    }
  }
  return getDefaultExploreLanguage(kind);
}

export function setExploreWhereLanguage(
  kind: SourceKind | undefined,
  language: QueryLanguage,
): void {
  if (typeof window === 'undefined' || kind == null) {
    return;
  }
  try {
    window.localStorage.setItem(
      `${EXPLORE_LANGUAGE_KEY_PREFIX}${kind}`,
      language,
    );
  } catch {
    // localStorage may throw in private browsing
  }
}

/** True when `text` looks like a SQL WHERE fragment rather than Lucene. */
export function looksLikeSql(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  // Lucene field:value (and boolean combinations) without SQL comparison ops.
  if (
    /:/.test(trimmed) &&
    !/[=<>]/.test(trimmed) &&
    !/\b(?:ILIKE|LIKE|IN\s*\(|IS\s+NULL|IS\s+NOT\s+NULL)\b/i.test(trimmed)
  ) {
    return false;
  }

  return /(?:!=|<>|<=|>=|=|\bILIKE\b|\bLIKE\b|\bIN\s*\(|\bIS\s+NULL\b|\bIS\s+NOT\s+NULL\b)/i.test(
    trimmed,
  );
}

function luceneQuote(value: string): string {
  if (/^[\w.*-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function sqlQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function splitTopLevel(
  input: string,
  separator: 'AND' | 'OR',
): string[] | null {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: "'" | '"' | null = null;
  const upper = input.toUpperCase();
  const sep = ` ${separator} `;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && i + 1 < input.length) {
        current += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth < 0) {
        return null;
      }
      current += ch;
      i += 1;
      continue;
    }
    if (depth === 0 && upper.slice(i, i + sep.length) === sep) {
      const part = current.trim();
      if (!part) {
        return null;
      }
      parts.push(part);
      current = '';
      i += sep.length;
      continue;
    }
    current += ch;
    i += 1;
  }

  if (quote != null || depth !== 0) {
    return null;
  }
  const last = current.trim();
  if (!last) {
    return null;
  }
  parts.push(last);
  return parts.length > 1 ? parts : null;
}

function unwrapParens(text: string): string {
  let trimmed = text.trim();
  while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    const inner = trimmed.slice(1, -1).trim();
    // Only unwrap when the parens wrap the whole expression.
    let depth = 0;
    let wrapped = true;
    for (const ch of inner) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (depth < 0) {
        wrapped = false;
        break;
      }
    }
    if (!wrapped || depth !== 0) {
      break;
    }
    trimmed = inner;
  }
  return trimmed;
}

const SQL_ATOM =
  /^(NOT\s+)?(`?[\w.]+`?)\s*(=|!=|<>)\s*(?:'((?:\\'|[^'])*)'|"((?:\\"|[^"])*)"|(\d+(?:\.\d+)?))$/i;

function convertSqlAtom(sql: string): string | null {
  const trimmed = unwrapParens(sql);
  const match = trimmed.match(SQL_ATOM);
  if (!match) {
    return null;
  }
  const negated = Boolean(match[1]) || match[3] !== '=';
  const field = match[2].replace(/`/g, '');
  const value = match[4] ?? match[5] ?? match[6] ?? '';
  return `${negated ? '-' : ''}${field}:${luceneQuote(value)}`;
}

/**
 * Convert a simple SQL WHERE (`col = 'x' AND/OR/NOT`) to Lucene.
 * Returns null when the expression uses functions, LIKE, or other SQL we
 * refuse to reverse-parse.
 */
export function tryConvertSqlWhereToLucene(sql: string): string | null {
  const trimmed = unwrapParens(sql.trim());
  if (!trimmed) {
    return '';
  }

  const orParts = splitTopLevel(trimmed, 'OR');
  if (orParts) {
    const converted = orParts.map(part => tryConvertSqlWhereToLucene(part));
    if (converted.some(part => part == null)) {
      return null;
    }
    return converted.map(part => `(${part})`).join(' OR ');
  }

  const andParts = splitTopLevel(trimmed, 'AND');
  if (andParts) {
    const converted = andParts.map(part => tryConvertSqlWhereToLucene(part));
    if (converted.some(part => part == null)) {
      return null;
    }
    return converted.join(' AND ');
  }

  if (/^NOT\s+/i.test(trimmed) && !SQL_ATOM.test(trimmed)) {
    const inner = tryConvertSqlWhereToLucene(trimmed.replace(/^NOT\s+/i, ''));
    return inner != null ? `NOT (${inner})` : null;
  }

  return convertSqlAtom(trimmed);
}

const LUCENE_ATOM = /^(-)?([\w.]+):(?:"((?:\\"|[^"])*)"|([\w.*-]+))$/;

function convertLuceneAtom(lucene: string): string | null {
  const trimmed = unwrapParens(lucene);
  const match = trimmed.match(LUCENE_ATOM);
  if (!match) {
    return null;
  }
  const negated = Boolean(match[1]);
  const field = match[2];
  const value = match[3] ?? match[4] ?? '';
  const sqlValue = /^\d+(?:\.\d+)?$/.test(value) ? value : sqlQuote(value);
  return `${field} ${negated ? '!=' : '='} ${sqlValue}`;
}

/** Convert simple Lucene `field:value` AND/OR expressions to SQL WHERE. */
export function tryConvertLuceneToSqlWhere(lucene: string): string | null {
  const trimmed = unwrapParens(lucene.trim());
  if (!trimmed) {
    return '';
  }

  const orParts = splitTopLevel(trimmed, 'OR');
  if (orParts) {
    const converted = orParts.map(part => tryConvertLuceneToSqlWhere(part));
    if (converted.some(part => part == null)) {
      return null;
    }
    return converted.map(part => `(${part})`).join(' OR ');
  }

  const andParts = splitTopLevel(trimmed, 'AND');
  if (andParts) {
    const converted = andParts.map(part => tryConvertLuceneToSqlWhere(part));
    if (converted.some(part => part == null)) {
      return null;
    }
    return converted.join(' AND ');
  }

  if (/^NOT\s+/i.test(trimmed)) {
    const inner = tryConvertLuceneToSqlWhere(trimmed.replace(/^NOT\s+/i, ''));
    return inner != null ? `NOT (${inner})` : null;
  }

  return convertLuceneAtom(trimmed);
}

export function filterStateToLucene(filters: FilterState): string {
  const parts: string[] = [];
  for (const [field, state] of Object.entries(filters)) {
    for (const value of state.included) {
      parts.push(`${field}:${luceneQuote(String(value))}`);
    }
    for (const value of state.excluded) {
      parts.push(`-${field}:${luceneQuote(String(value))}`);
    }
    if (state.range != null) {
      parts.push(`${field}:[${state.range.min} TO ${state.range.max}]`);
    }
  }
  return parts.join(' AND ');
}

export function filterStateToSql(filters: FilterState): string {
  return filtersToQuery(filters)
    .map(filter => ('condition' in filter ? filter.condition : ''))
    .filter(Boolean)
    .join(' AND ');
}

export function getFilterExampleQueries(kind?: SourceKind): {
  label: string;
  lucene: string;
}[] {
  if (kind === SourceKind.Trace) {
    return [
      { label: 'Errors', lucene: 'status:error' },
      { label: 'Slow spans', lucene: 'duration:>1s' },
    ];
  }
  if (kind === SourceKind.Metric || kind === SourceKind.Promql) {
    return [];
  }
  return [
    { label: 'Errors', lucene: 'level:error' },
    { label: 'HTTP 5xx', lucene: 'status:>=500' },
  ];
}
