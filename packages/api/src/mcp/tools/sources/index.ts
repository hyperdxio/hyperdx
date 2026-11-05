import type { ToolDefinition, ToolRegistrar } from '@/mcp/tools/types';

import { registerDeleteSource } from './deleteSource';
import { registerDescribeMetric } from './describeMetric';
import { registerDescribeSource } from './describeSource';
import { registerDescribeTable } from './describeTable';
import { registerListMetrics } from './listMetrics';
import { registerListSources } from './listSources';
import { registerSaveSource } from './saveSource';

const sourcesTools: ToolDefinition = (registrar: ToolRegistrar) => {
  registerListSources(registrar);
  registerDescribeSource(registrar);
  registerDescribeTable(registrar);
  registerSaveSource(registrar);
  registerDeleteSource(registrar);
  registerListMetrics(registrar);
  registerDescribeMetric(registrar);
};

export default sourcesTools;
