import type { TemplateMinerConfig } from './config';

export class MaskingInstruction {
  private regex: RegExp;
  private _pattern: string;
  maskWith: string;
  perWord: boolean;

  constructor(pattern: string, maskWith: string, perWord = false) {
    this._pattern = pattern;
    this.regex = new RegExp(pattern, 'g');
    this.maskWith = maskWith;
    this.perWord = perWord;
  }

  get pattern(): string {
    return this._pattern;
  }

  mask(content: string, maskPrefix: string, maskSuffix: string): string {
    const replacement = maskPrefix + this.maskWith + maskSuffix;
    this.regex.lastIndex = 0;
    if (!this.perWord) return content.replace(this.regex, replacement);
    // One mask per word of the match, so the line keeps its token count.
    return content.replace(this.regex, match =>
      match.replace(/\S+/g, replacement),
    );
  }
}

export class LogMasker {
  maskPrefix: string;
  maskSuffix: string;
  private _maskingInstructions: MaskingInstruction[];
  private maskNameToInstructions: Map<string, MaskingInstruction[]>;

  constructor(
    maskingInstructions: MaskingInstruction[],
    maskPrefix: string,
    maskSuffix: string,
  ) {
    this.maskPrefix = maskPrefix;
    this.maskSuffix = maskSuffix;
    this._maskingInstructions = maskingInstructions;
    this.maskNameToInstructions = new Map();
    for (const mi of maskingInstructions) {
      const list = this.maskNameToInstructions.get(mi.maskWith) ?? [];
      list.push(mi);
      this.maskNameToInstructions.set(mi.maskWith, list);
    }
  }

  static fromConfig(config: TemplateMinerConfig): LogMasker {
    return new LogMasker(
      config.maskingInstructions.map(
        mi => new MaskingInstruction(mi.pattern, mi.maskWith, mi.perWord),
      ),
      config.maskPrefix,
      config.maskSuffix,
    );
  }

  mask(content: string): string {
    let result = content;
    for (const mi of this._maskingInstructions) {
      result = mi.mask(result, this.maskPrefix, this.maskSuffix);
    }
    return result;
  }

  get maskNames(): string[] {
    return Array.from(this.maskNameToInstructions.keys());
  }

  instructionsByMaskName(maskName: string): MaskingInstruction[] {
    return this.maskNameToInstructions.get(maskName) ?? [];
  }
}
