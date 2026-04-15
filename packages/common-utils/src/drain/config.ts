export interface MaskingInstructionConfig {
  pattern: string;
  maskWith: string;
}

export class TemplateMinerConfig {
  drainDepth: number = 4;
  drainSimTh: number = 0.4;
  drainMaxChildren: number = 100;
  drainMaxClusters: number | null = null;
  drainExtraDelimiters: string[] = [];
  maskPrefix: string = '<';
  maskSuffix: string = '>';
  maskingInstructions: MaskingInstructionConfig[] = [];
  parametrizeNumericTokens: boolean = true;
  parameterExtractionCacheCapacity: number = 3000;

  static fromJSON(json: Record<string, unknown>): TemplateMinerConfig {
    const config = new TemplateMinerConfig();
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
