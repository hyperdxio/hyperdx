import type { ToolDefinition, ToolRegistrar } from '@/mcp/tools/types';

import { registerGetSavedSearch } from './getSavedSearch';
import { registerSaveSavedSearch } from './saveSavedSearch';

const savedSearchesTools: ToolDefinition = (registrar: ToolRegistrar) => {
  registerGetSavedSearch(registrar);
  registerSaveSavedSearch(registrar);
};

export default savedSearchesTools;
