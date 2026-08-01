export class MaskingInstruction {
  private regex: RegExp;
  private _pattern: string;
  maskWith: string;

  constructor(pattern: string, maskWith: string) {
    this._pattern = pattern;
    this.regex = new RegExp(pattern, 'g');
    this.maskWith = maskWith;
  }

  get pattern(): string {
    return this._pattern;
  }

  mask(content: string, maskPrefix: string, maskSuffix: string): string {
    const replacement = maskPrefix + this.maskWith + maskSuffix;
    this.regex.lastIndex = 0;
    return content.replace(this.regex, replacement);
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
