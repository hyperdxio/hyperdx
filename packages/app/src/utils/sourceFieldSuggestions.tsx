import { JSX } from 'react';
import {
  ColumnMetaType,
  convertCHDataTypeToJSType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

export type SourceFieldKind =
  | 'bodyExpression'
  | 'implicitColumnExpression'
  | 'serviceNameExpression'
  | 'severityTextExpression'
  | 'eventAttributesExpression'
  | 'resourceAttributesExpression'
  | 'traceIdExpression'
  | 'spanIdExpression';

export type FieldCandidates = {
  /** The single column we recommend, when there is a clear winner. */
  canonical?: string;
  /** Other type-compatible, name-matched columns. Excludes `canonical`. */
  alternates: string[];
};

type TypePredicate = (chType: string) => boolean;

/** Peel LowCardinality(...) / Nullable(...) wrappers off a CH type string. */
function unwrap(chType: string): string {
  let t = chType.trim();

  while (true) {
    if (t.startsWith('LowCardinality(') && t.endsWith(')')) {
      t = t.slice('LowCardinality('.length, -1).trim();
    } else if (t.startsWith('Nullable(') && t.endsWith(')')) {
      t = t.slice('Nullable('.length, -1).trim();
    } else {
      break;
    }
  }
  return t;
}

/** String, LowCardinality(String), Nullable(String), FixedString, Enum, UUID. */
const isStringy: TypePredicate = t =>
  convertCHDataTypeToJSType(t) === JSDataType.String;

/** Map(String, *) or JSON. */
const isMapLike: TypePredicate = t => {
  const js = convertCHDataTypeToJSType(t);
  return js === JSDataType.Map || js === JSDataType.JSON;
};

/** TraceId is 16 bytes: String / UUID / FixedString(16). */
const isTraceIdType: TypePredicate = t => {
  const u = unwrap(t);
  return u === 'String' || u === 'UUID' || u === 'FixedString(16)';
};

/** SpanId is 8 bytes: String / FixedString(8). */
const isSpanIdType: TypePredicate = t => {
  const u = unwrap(t);
  return u === 'String' || u === 'FixedString(8)';
};

type FieldRule = {
  /** Preferred names, highest-rank first. Matched case-insensitively. */
  canonicalNames: string[];
  /** A column must satisfy this to be considered a candidate at all. */
  typeMatches: TypePredicate;
  /**
   * 'name-only' — only ever recommend a column whose name matches one of
   *   `canonicalNames` (don't guess a lone String column as e.g. the Body).
   * 'single' — additionally recommend the lone type-compatible column when no
   *   name matched (safe for Map attribute columns).
   */
  recommendStrategy: 'name-only' | 'single';
  /** Per-kind overrides of `canonicalNames` (e.g. Log vs Trace attributes). */
  canonicalNamesByKind?: Partial<Record<SourceKind, string[]>>;
};

const FIELD_RULES: Record<SourceFieldKind, FieldRule> = {
  bodyExpression: {
    canonicalNames: ['Body', 'message', 'msg', 'log', 'LogMessage', 'content'],
    typeMatches: isStringy,
    recommendStrategy: 'name-only',
  },
  implicitColumnExpression: {
    canonicalNames: ['Body', 'message', 'msg', 'log', 'LogMessage', 'content'],
    canonicalNamesByKind: {
      [SourceKind.Trace]: ['SpanName', 'OperationName', 'name'],
    },
    typeMatches: isStringy,
    recommendStrategy: 'name-only',
  },
  serviceNameExpression: {
    canonicalNames: ['ServiceName', 'service', 'service.name', 'service_name'],
    typeMatches: isStringy,
    recommendStrategy: 'name-only',
  },
  severityTextExpression: {
    canonicalNames: [
      'SeverityText',
      'severity',
      'level',
      'log_level',
      'loglevel',
    ],
    typeMatches: isStringy,
    recommendStrategy: 'name-only',
  },
  eventAttributesExpression: {
    canonicalNames: ['LogAttributes', 'Attributes', 'attributes', 'tags'],
    canonicalNamesByKind: {
      [SourceKind.Trace]: [
        'SpanAttributes',
        'Attributes',
        'attributes',
        'tags',
      ],
    },
    typeMatches: isMapLike,
    recommendStrategy: 'single',
  },
  resourceAttributesExpression: {
    canonicalNames: [
      'ResourceAttributes',
      'resource_attributes',
      'resource.attributes',
      'resource',
      'resources',
    ],
    typeMatches: isMapLike,
    recommendStrategy: 'single',
  },
  traceIdExpression: {
    canonicalNames: ['TraceId', 'trace_id', 'traceId', 'trace.id'],
    typeMatches: isTraceIdType,
    recommendStrategy: 'name-only',
  },
  spanIdExpression: {
    canonicalNames: ['SpanId', 'span_id', 'spanId', 'span.id'],
    typeMatches: isSpanIdType,
    recommendStrategy: 'name-only',
  },
};

/**
 * Inspect a table's columns and return the recommended column for a given
 * source-config field, plus any other type-compatible candidates.
 */
export function inferSourceFieldCandidates(
  columns: ColumnMetaType[],
  fieldKind: SourceFieldKind,
  sourceKind: SourceKind,
): FieldCandidates {
  const rule = FIELD_RULES[fieldKind];
  const canonicalNames =
    rule.canonicalNamesByKind?.[sourceKind] ?? rule.canonicalNames;

  // 1. type-compatible columns only
  const compatible = columns.filter(c => rule.typeMatches(c.type));

  // 2. case-insensitive name match, ranked by `canonicalNames` order.
  const byLowerName = new Map<string, string[]>();

  for (const c of compatible) {
    const key = c.name.toLowerCase();

    const existing = byLowerName.get(key);

    if (existing) {
      existing.push(c.name);
    } else {
      byLowerName.set(key, [c.name]);
    }
  }

  const rankedNameMatches = [
    ...new Set(
      canonicalNames.flatMap(n => byLowerName.get(n.toLowerCase()) ?? []),
    ),
  ];

  if (rule.recommendStrategy === 'single') {
    const canonical =
      rankedNameMatches[0] ??
      (compatible.length === 1 ? compatible[0].name : undefined);

    return {
      canonical,
      // surface all type-compatible columns so ambiguous multi-Map schemas present every option
      alternates: compatible.map(c => c.name).filter(n => n !== canonical),
    };
  }

  // 'name-only': never dump every String column as an alternate
  const canonical = rankedNameMatches[0];
  return {
    canonical,
    alternates: rankedNameMatches.filter(n => n !== canonical),
  };
}

export type SourceConfigPairingInput = {
  kind: SourceKind;
  bodyExpression?: string | null;
  implicitColumnExpression?: string | null;
};

export type PairingWarning = {
  field: SourceFieldKind;
  message: JSX.Element;
  recommendation: string;
  suggestedFix: { field: SourceFieldKind; value: string };
};

export function getSourceConfigPairingWarnings(
  formValues: SourceConfigPairingInput,
): PairingWarning[] {
  // Body / Implicit Column pairing only applies to log sources.
  if (formValues.kind !== SourceKind.Log) {
    return [];
  }

  const warnings: PairingWarning[] = [];
  const body = formValues.bodyExpression?.trim();
  const implicit = formValues.implicitColumnExpression?.trim();

  if (body && !implicit) {
    warnings.push({
      field: 'implicitColumnExpression',
      message: (
        <>
          <strong>Body Expression</strong> is set but{' '}
          <strong>Implicit Column Expression</strong> is empty. Bare-text Lucene
          search will fall back to <strong>Body Expression</strong>.
        </>
      ),
      recommendation: 'Body Expression value',
      suggestedFix: { field: 'implicitColumnExpression', value: body },
    });
  } else if (implicit && !body) {
    warnings.push({
      field: 'bodyExpression',
      message: (
        <>
          <strong>Implicit Column Expression</strong> is set but{' '}
          <strong>Body Expression</strong> is empty. Row-panel body display will
          fall back to <strong>Implicit Column Expression</strong>.
        </>
      ),
      recommendation: 'Implicit Column Expression value',
      suggestedFix: { field: 'bodyExpression', value: implicit },
    });
  }

  return warnings;
}
