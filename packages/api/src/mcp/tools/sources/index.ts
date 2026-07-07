import type { ToolDefinition, ToolRegistrar } from '@/mcp/tools/types';

import { registerDescribeMetric } from './describeMetric';
import { registerDescribeSource } from './describeSource';
import { registerListMetrics } from './listMetrics';
import { registerListSources } from './listSources';

const sourcesTools: ToolDefinition = (registrar: ToolRegistrar) => {
  registerListSources(registrar);
  registerDescribeSource(registrar);
  registerListMetrics(registrar);
  registerDescribeMetric(registrar);
};

export default sourcesTools;
