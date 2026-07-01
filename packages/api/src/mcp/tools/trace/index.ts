import type { ToolDefinition, ToolRegistrar } from '@/mcp/tools/types';

import { registerTraceBreakdown } from './breakdown';
import { registerTraceWaterfall } from './waterfall';

const traceTools: ToolDefinition = (registrar: ToolRegistrar) => {
  registerTraceWaterfall(registrar);
  registerTraceBreakdown(registrar);
};

export default traceTools;
