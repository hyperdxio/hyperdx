import { recordAction } from '@/knowledge/incidents/store';
import { recordActionSchema } from '@/knowledge/incidents/types';
import { APPEND_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';

import { jsonResult, withTarget } from './shared';

export function registerRecordAction({ context, registerTool }: ToolRegistrar) {
  registerTool(
    'clickstack_record_incident_action',
    {
      title: 'Record an incident action',
      annotations: APPEND_TOOL,
      description:
        'Record one step of an investigation: a query you ran, a hypothesis, a remediation, or a note. Returns the step number, which clickstack_resolve_incident uses to label outcomes.',
      inputSchema: recordActionSchema,
    },
    async input =>
      withTarget(context, async t => {
        const row = await recordAction(t, context.userId, input);
        return jsonResult({ seq: row.seq });
      }),
  );
}
