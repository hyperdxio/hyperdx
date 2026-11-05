export interface MaskingInstructionConfig {
  pattern: string;
  maskWith: string;
}

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const WEEKDAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';

/**
 * Mask names for the default masks: a masked timestamp reads `<TS>` in a
 * template (it can stand for several words, e.g. `2026-11-04 06:12:12,345`),
 * a masked UUID or hex id reads `<ID>` (always one word).
 */
export const TIMESTAMP_MASK = 'TS';
export const ID_MASK = 'ID';

/**
 * Values that differ on every line but say nothing about the pattern. They are
 * masked to `<TS>` / `<ID>` before Drain sees the line, so dated lines from different
 * days (or runs) land in the same cluster. Order matters: whole timestamps
 * before their date and time parts. The bare date, time, UUID and hex masks
 * treat `_` as a separator (no `\b`), so `backup_2026-11-04` and `span_<hex>` mask too.
 */
export const DEFAULT_MASKING_INSTRUCTIONS: MaskingInstructionConfig[] = [
  // ISO-8601 / RFC-3339, `T` or space, optional fraction and zone
  {
    pattern:
      '\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?',
    maskWith: TIMESTAMP_MASK,
  },
  // RFC-1123 (HTTP dates): Wed, 04 Nov 2026 06:12:12 GMT (also a 1-digit day)
  {
    pattern: `${WEEKDAY}, \\d{1,2} ${MONTH} \\d{4} \\d{2}:\\d{2}:\\d{2}(?: (?:GMT|UTC|[+-]\\d{4}))?`,
    maskWith: TIMESTAMP_MASK,
  },
  // ctime / Java Date.toString / Go UnixDate: Wed Nov  4 06:12:12 [UTC] 2026
  {
    pattern: `${WEEKDAY} ${MONTH} +\\d{1,2} \\d{2}:\\d{2}:\\d{2}(?: [A-Z]{2,5})? \\d{4}`,
    maskWith: TIMESTAMP_MASK,
  },
  // Log4j / Java: 04 Nov 2026 06:12:12,345
  {
    pattern: `(?<![0-9A-Za-z])\\d{1,2} ${MONTH} \\d{4} \\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?`,
    maskWith: TIMESTAMP_MASK,
  },
  // Access-log dates: 04/Nov/2026:06:12:12 +0000
  {
    pattern: `\\d{2}/${MONTH}/\\d{4}:\\d{2}:\\d{2}:\\d{2}(?: [+-]\\d{4})?`,
    maskWith: TIMESTAMP_MASK,
  },
  // Syslog: Nov  4 06:12:12
  {
    pattern: `\\b${MONTH} +\\d{1,2} \\d{2}:\\d{2}:\\d{2}\\b`,
    maskWith: TIMESTAMP_MASK,
  },
  // A date that only shows with a time after it: Spark/log4j yy/MM/dd and the
  // klog/glog severity+MMDD prefix (I1104 06:12:12.345678)
  {
    pattern: '(?<![0-9A-Za-z/])\\d{2}/\\d{2}/\\d{2}(?= \\d{2}:\\d{2}:\\d{2})',
    maskWith: TIMESTAMP_MASK,
  },
  {
    pattern: '(?<![0-9A-Za-z])[IWEF]\\d{4}(?= \\d{2}:\\d{2}:\\d{2})',
    maskWith: TIMESTAMP_MASK,
  },
  // A date or a time on its own
  {
    pattern: '(?<![0-9A-Za-z])\\d{4}[-/]\\d{2}[-/]\\d{2}(?![0-9A-Za-z])',
    maskWith: TIMESTAMP_MASK,
  },
  {
    pattern: '(?<![0-9A-Za-z])\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?(?![0-9A-Za-z])',
    maskWith: TIMESTAMP_MASK,
  },
  // UUIDs
  {
    pattern:
      '(?<![0-9A-Za-z])[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?![0-9A-Za-z])',
    maskWith: ID_MASK,
  },
  // Long hex ids: trace/span ids, hashes, container ids
  {
    pattern: '(?<![0-9A-Za-z])[0-9a-fA-F]{16,}(?![0-9A-Za-z])',
    maskWith: ID_MASK,
  },
];

export class TemplateMinerConfig {
  drainDepth: number = 4;
  drainSimTh: number = 0.4;
  drainMaxChildren: number = 100;
  drainMaxClusters: number | null = null;
  drainExtraDelimiters: string[] = [];
  maskPrefix: string = '<';
  maskSuffix: string = '>';
  maskingInstructions: MaskingInstructionConfig[] = [
    ...DEFAULT_MASKING_INSTRUCTIONS,
  ];
  parametrizeNumericTokens: boolean = true;
  parameterExtractionCacheCapacity: number = 3000;

  static fromJSON(json: Record<string, unknown>): TemplateMinerConfig {
    const config = new TemplateMinerConfig();
    // drain3 applies no masks unless the JSON lists them.
    config.maskingInstructions = [];
    if (typeof json.drain_depth === 'number')
      config.drainDepth = json.drain_depth;
    if (typeof json.drain_sim_th === 'number')
      config.drainSimTh = json.drain_sim_th;
    if (typeof json.drain_max_children === 'number')
      config.drainMaxChildren = json.drain_max_children;
    if (
      typeof json.drain_max_clusters === 'number' ||
      json.drain_max_clusters === null
    )
      config.drainMaxClusters = json.drain_max_clusters;
    if (Array.isArray(json.drain_extra_delimiters)) {
      config.drainExtraDelimiters = (
        json.drain_extra_delimiters as unknown[]
      ).filter((v): v is string => typeof v === 'string');
    }
    if (typeof json.mask_prefix === 'string')
      config.maskPrefix = json.mask_prefix;
    if (typeof json.mask_suffix === 'string')
      config.maskSuffix = json.mask_suffix;
    if (typeof json.parametrize_numeric_tokens === 'boolean')
      config.parametrizeNumericTokens = json.parametrize_numeric_tokens;
    if (typeof json.parameter_extraction_cache_capacity === 'number')
      config.parameterExtractionCacheCapacity =
        json.parameter_extraction_cache_capacity;
    if (Array.isArray(json.masking_instructions)) {
      config.maskingInstructions = (json.masking_instructions as unknown[])
        .filter(
          (item): item is Record<string, string> =>
            typeof item === 'object' && item !== null,
        )
        .map(mi => ({
          pattern: mi.regex_pattern ?? mi.pattern,
          maskWith: mi.mask_with ?? mi.maskWith,
        }));
    }
    return config;
  }
}
