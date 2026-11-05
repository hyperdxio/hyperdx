export interface MaskingInstructionConfig {
  pattern: string;
  maskWith: string;
  /** Mask each word of a match separately (default: the whole match once). */
  perWord?: boolean;
}

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const WEEKDAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const DAY = '(?:0?[1-9]|[12]\\d|3[01])';
const TIME = '\\d{1,2}:\\d{2}:\\d{2}';
const NOT_WORD_BEFORE = '(?<![0-9A-Za-z])';
const NOT_WORD_AFTER = '(?![0-9A-Za-z])';

/**
 * Mask name for the date parts of a timestamp; a masked date reads `<DATE>`
 * in a template.
 */
export const DATE_MASK = 'DATE';

/**
 * Masks the date of a timestamp (weekday, day, month, year), so the same
 * message gets the same template on any day. Every line of a day shares its
 * date and `<DATE>` matches itself the same way, so within one day lines group
 * as without masks. Times and ids are left alone: they differ between lines on
 * any day, and Drain already treats them as variables. No mask changes a
 * line's token count.
 */
export const DEFAULT_MASKING_INSTRUCTIONS: MaskingInstructionConfig[] = [
  // 2026-11-04, 2026/11/04, also before an ISO-8601 time: 2026-11-04T06:12:12Z
  {
    pattern: `${NOT_WORD_BEFORE}\\d{4}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\\d|3[01])(?:(?=T\\d)|${NOT_WORD_AFTER})`,
    maskWith: DATE_MASK,
  },
  // Month-name dates before a time: (Wed, )04 Nov 2026
  {
    pattern: `${NOT_WORD_BEFORE}(?:${WEEKDAY},?\\s+)?${DAY}\\s+${MONTH}\\s+\\d{4}(?=\\s+${TIME})`,
    maskWith: DATE_MASK,
    perWord: true,
  },
  // The year after a ctime / Java Date time: Nov  4 06:12:12 [UTC] 2026.
  // Before the next mask, which rewrites the month and day it looks for. The
  // lookahead runs the lookbehind only where a year starts, keeping it linear
  // on long runs of whitespace.
  {
    pattern: `(?=(?:19|20)\\d{2}${NOT_WORD_AFTER})(?<=${MONTH}\\s+${DAY}\\s+${TIME}(?:[.,]\\d+)?(?:\\s+(?:[A-Z]{2,5}|[+-]\\d{4}))?\\s+)(?:19|20)\\d{2}`,
    maskWith: DATE_MASK,
  },
  // (Wed )Nov  4, and with the year first: Wed Nov 04 2026 (JavaScript),
  // Nov 4, 2026 (java.util.logging)
  {
    pattern: `${NOT_WORD_BEFORE}(?:${WEEKDAY}\\s+)?${MONTH}\\s+${DAY}(?:,?\\s+\\d{4})?(?=\\s+${TIME})`,
    maskWith: DATE_MASK,
    perWord: true,
  },
  // Access log and Tomcat: [04/Nov/2026:06:12:12, 04-Nov-2026 06:12:12
  {
    pattern: `${NOT_WORD_BEFORE}\\d{2}(?:/${MONTH}/|-${MONTH}-)\\d{4}(?=:\\d|\\s+${TIME})`,
    maskWith: DATE_MASK,
  },
  // dd/MM/yyyy, MM/dd/yyyy, dd.MM.yyyy and yy/MM/dd before a time
  {
    pattern: `(?<![0-9A-Za-z/.])\\d{2}(?:/\\d{2}/|\\.\\d{2}\\.)\\d{2}(?:\\d{2})?(?=\\s+${TIME})`,
    maskWith: DATE_MASK,
  },
  // klog / glog MMDD after the severity letter: I1104 06:12:12.345678
  {
    pattern: `(?<=${NOT_WORD_BEFORE}[IWEF])(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])(?=\\s+${TIME})`,
    maskWith: DATE_MASK,
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
