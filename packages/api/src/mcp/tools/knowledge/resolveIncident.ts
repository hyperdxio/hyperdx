import { resolveIncident } from '@/knowledge/incidents/store';
import { resolveIncidentSchema } from '@/knowledge/incidents/types';
import { APPEND_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';

import { withTarget } from './shared';

export function registerResolveIncident({
  context,
  registerTool,
}: ToolRegistrar) {
  registerTool(
    'clickstack_resolve_incident',
    {
      title: 'Resolve an incident',
      annotations: APPEND_TOOL,
      description:
        'Close an incident with its root cause, root cause node and resolution. Label steps from clickstack_record_incident_action with outcomes (led_to_fix, useful, dead_end) so future playbooks keep what worked.',
      inputSchema: resolveIncidentSchema,
    },
    async input =>
      withTarget(context, async t => {
        const row = await resolveIncident(t, context.userId, input);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(row, null, 2) },
            {
              type: 'text' as const,
              text: 'Recorded. This incident is not used for retrieval until a person confirms it.',
            },
          ],
        };
      }),
  );
}
