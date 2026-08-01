import type { ToolDefinition, ToolRegistrar } from '@/mcp/tools/types';

import { registerDeleteWebhook } from './deleteWebhook';
import { registerGetAlert } from './getAlert';
import { registerGetWebhook } from './getWebhook';
import { registerSaveAlert } from './saveAlert';
import { registerSaveWebhook } from './saveWebhook';

const alertsTools: ToolDefinition = (registrar: ToolRegistrar) => {
  registerGetAlert(registrar);
  registerGetWebhook(registrar);
  registerSaveWebhook(registrar);
  registerDeleteWebhook(registrar);
  registerSaveAlert(registrar);
};

export default alertsTools;
