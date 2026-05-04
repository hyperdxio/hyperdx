export class LogCluster {
  logTemplateTokens: string[];
  clusterId: number;
  size: number;

  constructor(logTemplateTokens: string[], clusterId: number) {
    this.logTemplateTokens = [...logTemplateTokens];
    this.clusterId = clusterId;
    this.size = 1;
  }

  getTemplate(): string {
    return this.logTemplateTokens.join(' ');
  }

  toString(): string {
    return `ID=${String(this.clusterId).padEnd(5)} : size=${String(this.size).padEnd(10)}: ${this.getTemplate()}`;
  }
}
