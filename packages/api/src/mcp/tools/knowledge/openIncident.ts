import { openIncident } from '@/knowledge/incidents/store';
import { openIncidentSchema } from '@/knowledge/incidents/types';
import { APPEND_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';

import { jsonResult, withTarget } from './shared';

export function registerOpenIncident({ context, registerTool }: ToolRegistrar) {
  registerTool(
    'clickstack_open_incident',
    {
      title: 'Open an incident record',
      annotations: APPEND_TOOL,
      description:
        'Start an incident record when you begin investigating an alert. Returns the incident id to use with clickstack_record_incident_action and clickstack_resolve_incident. ' +
        'symptomKeys are node keys such as "service:checkout" or "datastore:postgresql:orders-db".',
      inputSchema: openIncidentSchema,
    },
    async input =>
      withTarget(context, async t => {
        const row = await openIncident(t, context.userId, input);
        return jsonResult({
          incidentId: row.incident_id,
          symptomKeys: row.symptom_keys,
        });
      }),
  );
}
