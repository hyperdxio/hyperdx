import { ReactNode } from 'react';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';

export type OptimizationSeverity = 'info' | 'recommended' | 'critical';

export type OptimizationFinding<TDetail = unknown> = {
  scopeId: string;
  summary: string;
  detail: TDetail;
};

export type OptimizationDetectionContext = {
  sources: TSource[];
  clickhouseClient: ClickhouseClient;
  metadata: Metadata;
};

export type RenderFindingProps<TDetail = unknown> = {
  finding: OptimizationFinding<TDetail>;
  source?: TSource;
};

export type OptimizationPlugin<TDetail = unknown> = {
  id: string;
  title: string;
  shortLabel: string;
  description: string;
  severity: OptimizationSeverity;
  detect: (
    ctx: OptimizationDetectionContext,
  ) => Promise<OptimizationFinding<TDetail>[]>;
  renderFinding: (props: RenderFindingProps<TDetail>) => ReactNode;
  resolveSource?: (
    finding: OptimizationFinding<TDetail>,
    sources: TSource[],
  ) => TSource | undefined;
  buildDDL?: (
    finding: OptimizationFinding<TDetail>,
    source: TSource,
  ) => string[];
};
