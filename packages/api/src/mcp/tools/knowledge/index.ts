import type { ToolDefinition, ToolRegistrar } from '@/mcp/tools/types';

import { registerBlastRadius } from './blastRadius';
import { registerFindSimilar } from './findSimilar';
import { registerIncidentContext } from './incidentContext';
import { registerOpenIncident } from './openIncident';
import { registerPlaybook } from './playbook';
import { registerRecordAction } from './recordAction';
import { registerResolveIncident } from './resolveIncident';
import { registerTraceRootCause } from './rootCause';

const knowledgeTools: ToolDefinition = (registrar: ToolRegistrar) => {
  registerIncidentContext(registrar);
  registerTraceRootCause(registrar);
  registerBlastRadius(registrar);
  registerOpenIncident(registrar);
  registerRecordAction(registrar);
  registerResolveIncident(registrar);
  registerFindSimilar(registrar);
  registerPlaybook(registrar);
};

export default knowledgeTools;
