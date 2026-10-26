import { z } from 'zod';

import { buildPlaybook } from '@/knowledge/incidents/playbook';
import { getIncident, listActions } from '@/knowledge/incidents/store';
import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';

import { jsonResult, withTarget } from './shared';

export function registerPlaybook({ context, registerTool }: ToolRegistrar) {
  registerTool(
    'clickstack_get_incident_playbook',
    {
      title: 'Get an incident playbook',
      annotations: READ_ONLY_TOOL,
      description:
        'Return the steps that led to the fix in a past incident, and the leads that were ruled out. ' +
        'This is a prior, not a procedure: verify each step against the current window before repeating it.',
      inputSchema: z.object({
        incidentId: z.string().uuid().describe('Incident id.'),
      }),
    },
    async ({ incidentId }) =>
      withTarget(context, async t => {
        const incident = await getIncident(t, incidentId);
        if (!incident) return mcpUserError('Incident not found');
        return jsonResult(
          buildPlaybook(incident, await listActions(t, incidentId)),
        );
      }),
  );
}
