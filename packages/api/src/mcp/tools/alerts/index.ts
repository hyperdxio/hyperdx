import type { ToolDefinition, ToolRegistrar } from '@/mcp/tools/types';

import { registerGetAlert } from './getAlert';
import { registerGetWebhook } from './getWebhook';
import { registerSaveAlert } from './saveAlert';

const alertsTools: ToolDefinition = (registrar: ToolRegistrar) => {
  registerGetAlert(registrar);
  registerGetWebhook(registrar);
  registerSaveAlert(registrar);
};

export default alertsTools;
