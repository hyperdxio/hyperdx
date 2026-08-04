import type { ToolDefinition, ToolRegistrar } from '@/mcp/tools/types';

import { registerEmergingSignals } from './emergingSignals';
import { registerEventDeltas } from './eventDeltas';
import { registerEventPatterns } from './eventPatterns';
import { registerSearch } from './search';
import { registerSql } from './sql';
import { registerTable } from './table';
import { registerTimeseries } from './timeseries';

const queryTools: ToolDefinition = (registrar: ToolRegistrar) => {
  registerTimeseries(registrar);
  registerTable(registrar);
  registerSearch(registrar);
  registerEventPatterns(registrar);
  registerEventDeltas(registrar);
  registerEmergingSignals(registrar);
  registerSql(registrar);
};

export default queryTools;
