import type {
  FilterRange,
  FilterState,
} from '@hyperdx/common-utils/dist/filters';

import { parseDurationBound } from './durationBound';
import type { QueryLanguage } from './queryModeSafety';

export type WherePromotion = {
  filters: FilterState;
  remainder: string;
};

// Equality and one-sided numeric comparisons. Wildcards and ILIKE stay typed
// because FilterState serializes to SQL IN / BETWEEN / >/</>=/<=.
const LUCENE_ATOM = /^(-)?([\w.]+):(?:"((?:\\"|[^"])*)"|([\w.-]+))$/;
const LUCENE_CMP =
  /^([\w.]+):(>=|<=|>|<)(\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h)?)$/i;
const SQL_ATOM =
  /^(NOT\s+)?(`?[\w.]+`?)\s*(=|!=|<>)\s*(?:'((?:\\'|[^'])*)'|"((?:\\"|[^"])*)"|(\d+(?:\.\d+)?))$/i;
const SQL_CMP =
  /^(`?[\w.]+`?)\s*(>=|<=|>|<)\s*([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i;

function emptySelection(): FilterState[string] {
  return { included: new Set(), excluded: new Set() };
}

function addValue(
  filters: FilterState,
  field: string,
  value: string,
  excluded: boolean,
) {
  if (!filters[field]) {
    filters[field] = emptySelection();
  }
  if (excluded) {
    filters[field].included.delete(value);
    filters[field].excluded.add(value);
  } else {
    filters[field].excluded.delete(value);
    filters[field].included.add(value);
  }
}

function splitTopLevel(
  input: string,
  separator: 'AND' | 'OR',
  { allowEmptyLast = false }: { allowEmptyLast?: boolean } = {},
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
  if (last) {
    parts.push(last);
  } else if (!allowEmptyLast) {
    return null;
  }
  return parts;
}

function unwrapParens(text: string): string {
  let trimmed = text.trim();
  while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    const inner = trimmed.slice(1, -1).trim();
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

type Atom = { field: string; value: string; excluded: boolean };

function parseLuceneAtom(text: string): Atom | null {
  const match = unwrapParens(text).match(LUCENE_ATOM);
  if (!match) {
    return null;
  }
  return {
    field: match[2],
    value: match[3]?.replaceAll('\\"', '"') ?? match[4] ?? '',
    excluded: Boolean(match[1]),
  };
}

function parseSqlAtom(text: string): Atom | null {
  const match = unwrapParens(text).match(SQL_ATOM);
  if (!match) {
    return null;
  }
  const value = (match[4] ?? match[5] ?? match[6] ?? '').replaceAll("\\'", "'");
  const excluded = Boolean(match[1]) || match[3] !== '=';
  return {
    field: match[2].replace(/`/g, ''),
    value,
    excluded,
  };
}

function parseAtom(text: string, language: QueryLanguage): Atom | null {
  return language === 'sql' ? parseSqlAtom(text) : parseLuceneAtom(text);
}

function parseComparison(
  text: string,
  language: QueryLanguage,
): FilterState | null {
  const raw = unwrapParens(text);
  const match = raw.match(language === 'sql' ? SQL_CMP : LUCENE_CMP);
  if (!match) {
    return null;
  }
  const field = match[1].replace(/`/g, '');
  const op = match[2];
  if (op !== '>' && op !== '>=' && op !== '<' && op !== '<=') {
    return null;
  }
  const bound =
    language === 'sql' ? Number(match[3]) : parseDurationBound(match[3]);
  if (bound == null || !Number.isFinite(bound)) {
    return null;
  }
  const range: FilterRange =
    op === '>' || op === '>='
      ? { min: bound, minOp: op }
      : { max: bound, maxOp: op };
  return {
    [field]: { included: new Set(), excluded: new Set(), range },
  };
}

function parsePromotablePart(
  text: string,
  language: QueryLanguage,
): FilterState | null {
  const atom = parseAtom(text, language);
  if (atom) {
    const filters: FilterState = {};
    addValue(filters, atom.field, atom.value, atom.excluded);
    return filters;
  }

  const comparison = parseComparison(text, language);
  if (comparison) {
    return comparison;
  }

  const orParts = splitTopLevel(unwrapParens(text), 'OR');
  if (orParts == null || orParts.length < 2) {
    return null;
  }
  const atoms = orParts.map(part => parseAtom(part, language));
  if (atoms.some(a => a == null)) {
    return null;
  }
  const parsed = atoms.filter((a): a is Atom => a != null);
  const field = parsed[0].field;
  if (parsed.some(a => a.field !== field || a.excluded)) {
    // Cross-field OR (and excluded-OR) is not representable in FilterState.
    return null;
  }
  const filters: FilterState = {};
  for (const a of parsed) {
    addValue(filters, a.field, a.value, false);
  }
  return filters;
}

function mergeStates(into: FilterState, extra: FilterState) {
  for (const [field, sel] of Object.entries(extra)) {
    for (const value of sel.included) {
      addValue(into, field, String(value), false);
    }
    for (const value of sel.excluded) {
      addValue(into, field, String(value), true);
    }
    if (sel.range != null) {
      if (!into[field]) {
        into[field] = emptySelection();
      }
      into[field].range = sel.range;
    }
  }
}

function hasClauses(filters: FilterState): boolean {
  return Object.values(filters).some(
    sel => sel.included.size > 0 || sel.excluded.size > 0 || sel.range != null,
  );
}

/**
 * Peel complete equality and numeric-comparison clauses out of a typed
 * Lucene/SQL string and into FilterState. The last token is only committed
 * when `commitTrailing` is true (Enter, blur, example chips) or the string
 * ends in whitespace / a trailing AND, so typing `level:error` does not freeze
 * into a pill before `level:errors`.
 */
export function promoteWhereToFilters(
  where: string,
  language: QueryLanguage,
  { commitTrailing = false }: { commitTrailing?: boolean } = {},
): WherePromotion {
  if (!where) {
    return { filters: {}, remainder: where };
  }

  const hasTrailingWhitespace = where !== where.trimEnd();
  const trimmedEnd = where.trimEnd();
  const hasTrailingAnd = /\sAND$/i.test(trimmedEnd);
  const body = hasTrailingAnd
    ? trimmedEnd.replace(/\sAND$/i, '').trimEnd()
    : trimmedEnd;
  const commitLast = commitTrailing || hasTrailingWhitespace || hasTrailingAnd;

  if (!body) {
    return { filters: {}, remainder: where };
  }

  const parts = splitTopLevel(body, 'AND', { allowEmptyLast: true });
  if (parts == null) {
    return { filters: {}, remainder: where };
  }

  const filters: FilterState = {};
  const remainderParts: string[] = [];

  parts.forEach((part, i) => {
    const parsed = parsePromotablePart(part, language);
    const isLast = i === parts.length - 1;
    if (parsed != null && (!isLast || commitLast)) {
      mergeStates(filters, parsed);
    } else {
      remainderParts.push(part);
    }
  });

  if (!hasClauses(filters)) {
    return { filters: {}, remainder: where };
  }

  return {
    filters,
    remainder: remainderParts.join(' AND '),
  };
}
