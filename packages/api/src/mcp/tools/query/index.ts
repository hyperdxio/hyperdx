import type { ToolDefinition, ToolRegistrar } from '@/mcp/tools/types';
import { isPromqlEnabled } from '@/mcp/utils/promql';

import { registerEmergingSignals } from './emergingSignals';
import { registerEventDeltas } from './eventDeltas';
import { registerEventPatterns } from './eventPatterns';
import { registerPromql } from './promql';
import { registerSearch } from './search';
import { registerServiceHealth } from './serviceHealth';
import { registerSql } from './sql';
import { registerTable } from './table';
import { registerTimeseries } from './timeseries';

const queryTools: ToolDefinition = (registrar: ToolRegistrar) => {
  registerServiceHealth(registrar);
  registerTimeseries(registrar);
  registerTable(registrar);
  registerSearch(registrar);
  registerEventPatterns(registrar);
  registerEventDeltas(registrar);
  registerEmergingSignals(registrar);
  registerSql(registrar);
  // With PromQL off, PromQL sources are hidden, so there is nothing to query.
  if (isPromqlEnabled(registrar.context)) {
    registerPromql(registrar);
  }
};

export default queryTools;
