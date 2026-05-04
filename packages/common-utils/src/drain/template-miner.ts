import { TemplateMinerConfig } from './config';
import { Drain } from './drain';
import { LogCluster } from './log-cluster';
import { LruCache } from './lru-cache';
import { LogMasker, MaskingInstruction } from './masking';

export interface ExtractedParameter {
  value: string;
  maskName: string;
}

export interface AddLogMessageResult {
  changeType: string;
  clusterId: number;
  clusterSize: number;
  templateMined: string;
  clusterCount: number;
}

export class TemplateMiner {
  drain: Drain;
  private masker: LogMasker;
  private extractionCache: LruCache<{
    regex: string;
    paramMap: Map<string, string>;
  }>;
  private extraDelimiters: string[];

  constructor(config?: TemplateMinerConfig) {
    const cfg = config ?? new TemplateMinerConfig();
    const paramStr = cfg.maskPrefix + '*' + cfg.maskSuffix;

    const maskingInstructions = cfg.maskingInstructions.map(
      mi => new MaskingInstruction(mi.pattern, mi.maskWith),
    );

    this.masker = new LogMasker(
      maskingInstructions,
      cfg.maskPrefix,
      cfg.maskSuffix,
    );

    this.drain = new Drain(
      cfg.drainDepth,
      cfg.drainSimTh,
      cfg.drainMaxChildren,
      cfg.drainMaxClusters,
      cfg.drainExtraDelimiters,
      paramStr,
      cfg.parametrizeNumericTokens,
    );

    this.extractionCache = new LruCache(cfg.parameterExtractionCacheCapacity);
    this.extraDelimiters = cfg.drainExtraDelimiters;
  }

  addLogMessage(logMessage: string): AddLogMessageResult {
    const maskedContent = this.masker.mask(logMessage);
    const [cluster, changeType] = this.drain.addLogMessage(maskedContent);
    return {
      changeType,
      clusterId: cluster.clusterId,
      clusterSize: cluster.size,
      templateMined: cluster.getTemplate(),
      clusterCount: this.drain.clusterCount,
    };
  }

  match(
    logMessage: string,
    fullSearchStrategy: string = 'never',
  ): LogCluster | null {
    const maskedContent = this.masker.mask(logMessage);
    return this.drain.match(maskedContent, fullSearchStrategy);
  }

  extractParameters(
    logTemplate: string,
    logMessage: string,
    exactMatching: boolean = true,
  ): ExtractedParameter[] | null {
    let message = logMessage;
    for (const delimiter of this.extraDelimiters) {
      message = message.split(delimiter).join(' ');
    }

    const { regex: templateRegex, paramMap } =
      this.getTemplateParameterExtractionRegex(logTemplate, exactMatching);

    const parameterMatch = message.match(new RegExp(templateRegex));
    if (!parameterMatch || !parameterMatch.groups) {
      return null;
    }

    const extracted: ExtractedParameter[] = [];
    for (const [groupName, maskName] of paramMap) {
      const value = parameterMatch.groups[groupName];
      if (value !== undefined) {
        extracted.push({ value, maskName });
      }
    }

    // Sort by position in input string (left-to-right) to match Python Drain3 behavior,
    // which depends on CPython's set iteration order for mask name processing.
    extracted.sort((a, b) => {
      const posA = message.indexOf(a.value);
      const posB = message.indexOf(b.value);
      return posA - posB;
    });

    return extracted;
  }

  private getTemplateParameterExtractionRegex(
    logTemplate: string,
    exactMatching: boolean,
  ): { regex: string; paramMap: Map<string, string> } {
    const cacheKey = simpleHash(`${logTemplate}|${exactMatching}`);
    const cached = this.extractionCache.peek(cacheKey);
    if (cached) return cached;

    const paramMap = new Map<string, string>();
    let paramNameCounter = 0;

    const maskNames = new Set(this.masker.maskNames);
    maskNames.add('*');

    const escapedPrefix = escapeRegex(this.masker.maskPrefix);
    const escapedSuffix = escapeRegex(this.masker.maskSuffix);
    let templateRegex = escapeRegex(logTemplate);

    for (const maskName of maskNames) {
      const searchStr = escapedPrefix + escapeRegex(maskName) + escapedSuffix;
      while (true) {
        const allowedPatterns: string[] = [];
        if (exactMatching && maskName !== '*') {
          const instructions = this.masker.instructionsByMaskName(maskName);
          for (const mi of instructions) {
            allowedPatterns.push(mi.pattern);
          }
        }
        if (!exactMatching || maskName === '*') {
          allowedPatterns.push('.+?');
        }

        const paramGroupName = `p_${paramNameCounter}`;
        paramNameCounter++;
        paramMap.set(paramGroupName, maskName);

        const joined = allowedPatterns.join('|');
        const captureRegex = `(?<${paramGroupName}>${joined})`;

        if (templateRegex.includes(searchStr)) {
          templateRegex = templateRegex.replace(searchStr, captureRegex);
        } else {
          break;
        }
      }
    }

    templateRegex = templateRegex.replace(/\\ /g, '\\s+');
    templateRegex = `^${templateRegex}$`;

    const result = { regex: templateRegex, paramMap };
    this.extractionCache.put(cacheKey, result);
    return result;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

function simpleHash(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return hash;
}
