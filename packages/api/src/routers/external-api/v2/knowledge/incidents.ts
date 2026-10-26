import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { findSimilarIncidents } from '@/knowledge/incidents/find';
import {
  deleteIncidentsByTitlePrefix,
  listIncidentsForReview,
} from '@/knowledge/incidents/listing';
import { buildPlaybook } from '@/knowledge/incidents/playbook';
import {
  confirmIncident,
  listActions,
  openIncident,
  recordAction,
  requireIncident,
  resolveIncident,
} from '@/knowledge/incidents/store';
import {
  openIncidentSchema,
  recordActionSchema,
  resolveIncidentSchema,
} from '@/knowledge/incidents/types';

import { publicIncident, route } from './route';

const router = express.Router();

const bool = z.enum(['true', 'false']);
const listQuery = z.object({
  status: z.enum(['open', 'resolved']).optional(),
  confirmed: bool.optional(),
});
const similarQuery = z.object({
  service: z.string().min(1),
  text: z.string().optional(),
  symptomKeys: z.string().max(2000).optional(),
  includeUnconfirmed: bool.default('false'),
  topK: z.coerce.number().int().min(1).max(10).optional(),
});
const idParams = z.object({ id: z.string().uuid() });

/**
 * @openapi
 * /api/v2/knowledge/incidents:
 *   post:
 *     summary: Open Incident
 *     description: Opens an incident record for an investigation.
 *     operationId: openKnowledgeIncident
 *     tags: [Knowledge]
 *     responses:
 *       '201':
 *         description: The opened incident
 *   get:
 *     summary: List Incidents
 *     description: Lists the team's incidents newest first, up to 100, filtered by status and confirmation, so a person can review them before confirming.
 *     operationId: listKnowledgeIncidents
 *     tags: [Knowledge]
 *     parameters:
 *       - { name: status, in: query, schema: { type: string, enum: [open, resolved] }, description: Only incidents with this status. }
 *       - { name: confirmed, in: query, schema: { type: string, enum: ['true', 'false'] }, description: Only confirmed or only unconfirmed incidents. }
 *     responses:
 *       '200':
 *         description: Incidents without embeddings
 *   delete:
 *     summary: Delete Incidents By Title Prefix
 *     description: Deletes the team's incidents whose title starts with titlePrefix (at least 3 characters), with their actions and edges.
 *     operationId: deleteKnowledgeIncidents
 *     tags: [Knowledge]
 *     parameters:
 *       - { name: titlePrefix, in: query, required: true, schema: { type: string, minLength: 3 }, description: Title prefix to match. }
 *     responses:
 *       '200':
 *         description: Number of incidents deleted
 */
router.post(
  '/',
  validateRequest({ body: openIncidentSchema }),
  route('knowledge.open_incident', async ({ req, res, target, actor }) => {
    const data = await openIncident(target, actor, req.body);
    res.status(201).json({ data: publicIncident(data) });
  }),
);

router.get(
  '/',
  validateRequest({ query: listQuery }),
  route('knowledge.list_incidents', async ({ req, res, target }) => {
    const q = listQuery.parse(req.query);
    const rows = await listIncidentsForReview(target, {
      status: q.status,
      confirmed: q.confirmed === undefined ? undefined : q.confirmed === 'true',
    });
    res.json({ data: rows.map(publicIncident) });
  }),
);

router.delete(
  '/',
  validateRequest({ query: z.object({ titlePrefix: z.string().min(3) }) }),
  route('knowledge.delete_incidents', async ({ req, res, target }) => {
    const { titlePrefix } = z
      .object({ titlePrefix: z.string() })
      .parse(req.query);
    const deleted = await deleteIncidentsByTitlePrefix(target, titlePrefix);
    res.json({ data: { deleted } });
  }),
);

/**
 * @openapi
 * /api/v2/knowledge/incidents/similar:
 *   get:
 *     summary: Find Similar Incidents
 *     description: Ranks resolved incidents by symptom overlap, graph closeness and age. Only confirmed incidents unless includeUnconfirmed is true or the team setting is on.
 *     operationId: findSimilarKnowledgeIncidents
 *     tags: [Knowledge]
 *     parameters:
 *       - { name: service, in: query, required: true, schema: { type: string }, description: Alerting service name or node key. }
 *       - { name: text, in: query, schema: { type: string }, description: Symptom description. }
 *       - { name: symptomKeys, in: query, schema: { type: string }, description: Comma-separated node keys. }
 *       - { name: includeUnconfirmed, in: query, schema: { type: string, enum: ['true', 'false'] }, description: Also rank unconfirmed incidents. }
 *       - { name: topK, in: query, schema: { type: integer, minimum: 1, maximum: 10 }, description: Matches to return. }
 *     responses:
 *       '200':
 *         description: Ranked incidents with their scores
 */
// Defined before the /:id routes so "similar" is never read as an id.
router.get(
  '/similar',
  route('knowledge.similar_incidents', async ({ req, res, target }) => {
    const q = similarQuery.parse(req.query);
    const hits = await findSimilarIncidents(target, {
      service: q.service,
      text: q.text,
      symptomKeys: (q.symptomKeys ?? '')
        .split(',')
        .map(k => k.trim())
        .filter(Boolean)
        .slice(0, 50),
      includeUnconfirmed: q.includeUnconfirmed === 'true',
      topK: q.topK,
    });
    res.json({
      data: hits.map(h => ({ ...h, incident: publicIncident(h.incident) })),
    });
  }),
);

/**
 * @openapi
 * /api/v2/knowledge/incidents/{id}:
 *   get:
 *     summary: Get Incident
 *     description: Returns one incident and its recorded actions.
 *     operationId: getKnowledgeIncident
 *     tags: [Knowledge]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid }, description: Incident id. }
 *     responses:
 *       '200':
 *         description: The incident and its actions
 *       '404':
 *         description: Incident not found
 */
router.get(
  '/:id',
  validateRequest({ params: idParams }),
  route('knowledge.get_incident', async ({ req, res, target }) => {
    const incident = await requireIncident(target, req.params.id);
    const actions = await listActions(target, incident.incident_id);
    res.json({ data: { incident: publicIncident(incident), actions } });
  }),
);

/**
 * @openapi
 * /api/v2/knowledge/incidents/{id}/actions:
 *   post:
 *     summary: Record Incident Action
 *     description: Records one investigation step on an open incident.
 *     operationId: recordKnowledgeIncidentAction
 *     tags: [Knowledge]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid }, description: Incident id. }
 *     responses:
 *       '201':
 *         description: The recorded action with its step number
 *       '409':
 *         description: Incident already resolved
 */
router.post(
  '/:id/actions',
  validateRequest({
    params: idParams,
    body: recordActionSchema.omit({ incidentId: true }),
  }),
  route('knowledge.record_action', async ({ req, res, target, actor }) => {
    const data = await recordAction(target, actor, {
      ...req.body,
      incidentId: req.params.id,
    });
    res.status(201).json({ data });
  }),
);

/**
 * @openapi
 * /api/v2/knowledge/incidents/{id}/resolve:
 *   post:
 *     summary: Resolve Incident
 *     description: Resolves an incident with its root cause, resolution and step outcomes.
 *     operationId: resolveKnowledgeIncident
 *     tags: [Knowledge]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid }, description: Incident id. }
 *     responses:
 *       '200':
 *         description: The resolved incident
 *       '409':
 *         description: Incident already resolved
 */
router.post(
  '/:id/resolve',
  validateRequest({
    params: idParams,
    body: resolveIncidentSchema.omit({ incidentId: true }),
  }),
  route('knowledge.resolve_incident', async ({ req, res, target, actor }) => {
    const data = await resolveIncident(target, actor, {
      ...req.body,
      incidentId: req.params.id,
    });
    res.json({ data: publicIncident(data) });
  }),
);

/**
 * @openapi
 * /api/v2/knowledge/incidents/{id}/confirm:
 *   post:
 *     summary: Confirm Incident
 *     description: Marks a resolved incident as reviewed by the caller, which makes it available to retrieval.
 *     operationId: confirmKnowledgeIncident
 *     tags: [Knowledge]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid }, description: Incident id. }
 *     responses:
 *       '200':
 *         description: The confirmed incident
 *       '409':
 *         description: Incident is not resolved
 */
router.post(
  '/:id/confirm',
  validateRequest({ params: idParams }),
  route('knowledge.confirm_incident', async ({ req, res, target, actor }) => {
    const data = await confirmIncident(target, actor, req.params.id);
    res.json({ data: publicIncident(data) });
  }),
);

/**
 * @openapi
 * /api/v2/knowledge/incidents/{id}/playbook:
 *   get:
 *     summary: Get Incident Playbook
 *     description: Returns the steps that led to the fix and the leads ruled out.
 *     operationId: getKnowledgeIncidentPlaybook
 *     tags: [Knowledge]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid }, description: Incident id. }
 *     responses:
 *       '200':
 *         description: The playbook
 */
router.get(
  '/:id/playbook',
  validateRequest({ params: idParams }),
  route('knowledge.get_playbook', async ({ req, res, target }) => {
    const incident = await requireIncident(target, req.params.id);
    const actions = await listActions(target, incident.incident_id);
    res.json({ data: buildPlaybook(incident, actions) });
  }),
);

export default router;
