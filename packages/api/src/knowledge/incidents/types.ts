import { z } from 'zod';

const actionTypeSchema = z.enum(['query', 'hypothesis', 'remediation', 'note']);
const outcomeSchema = z.enum(['unknown', 'led_to_fix', 'useful', 'dead_end']);
export type ActionType = z.infer<typeof actionTypeSchema>;
type Outcome = z.infer<typeof outcomeSchema>;

export const openIncidentSchema = z.object({
  title: z.string().min(1).max(200).describe('Short incident title.'),
  alertingService: z
    .string()
    .min(1)
    .describe('Name of the service that alerted.'),
  symptomKeys: z
    .array(z.string().regex(/^[a-z_]+:.+$/))
    .max(50)
    .default([])
    .describe('Node keys describing the symptoms, such as "service:checkout".'),
  summary: z.string().max(5000).optional().describe('Longer description.'),
});
export type OpenIncidentInput = z.input<typeof openIncidentSchema>;

export const recordActionSchema = z.object({
  incidentId: z.string().uuid().describe('Id from clickstack_open_incident.'),
  actionType: actionTypeSchema.describe('Kind of step.'),
  tool: z.string().max(100).optional().describe('Tool used, if any.'),
  args: z
    .record(z.unknown())
    .optional()
    .describe('Arguments the tool was called with.'),
  reason: z.string().max(500).optional().describe('Why you took this step.'),
  summary: z.string().min(1).max(2000).describe('What the step found or did.'),
});
export type RecordActionInput = z.input<typeof recordActionSchema>;

export const resolveIncidentSchema = z.object({
  incidentId: z.string().uuid().describe('Id from clickstack_open_incident.'),
  rootCause: z.string().min(1).max(5000).describe('What went wrong.'),
  rootCauseNode: z.string().min(1).describe('Node key where the cause sits.'),
  resolution: z.string().min(1).max(5000).describe('What fixed it.'),
  affectedNodes: z
    .array(z.string())
    .max(100)
    .default([])
    .describe('Node keys that were impacted.'),
  outcomes: z
    .array(
      z.object({
        seq: z.number().int().min(1).describe('Step number.'),
        outcome: outcomeSchema.describe('What the step turned out to be.'),
      }),
    )
    .default([])
    .describe(
      'Outcome labels for steps from clickstack_record_incident_action.',
    ),
  summary: z.string().max(5000).optional().describe('Longer description.'),
});
export type ResolveIncidentInput = z.input<typeof resolveIncidentSchema>;

export type IncidentRow = {
  incident_id: string;
  title: string;
  status: 'open' | 'resolved';
  opened_at: string;
  resolved_at: string | null;
  alerting_node: string;
  root_cause_node: string;
  root_cause: string;
  resolution: string;
  symptom_keys: string[];
  summary: string;
  embedding: number[];
  confirmed_by: string;
  version: number;
  // JSON GraphPath from alerting_node to root_cause_node, captured at resolve; '' when none was found.
  path: string;
};

export type ActionRow = {
  incident_id: string;
  seq: number;
  ts: string;
  actor: string;
  action_type: ActionType;
  tool: string;
  args: string;
  reason: string;
  outcome: Outcome;
  summary: string;
};
