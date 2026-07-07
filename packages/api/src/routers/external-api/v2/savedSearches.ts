import { SearchConditionLanguageSchema } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import {
  createSavedSearch,
  deleteSavedSearch,
} from '@/controllers/savedSearch';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import { processRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
import { objectIdSchema } from '@/utils/zod';

// Body schema for create/update. `where`, `select` and `tags` are defaulted to
// empty values (rather than left optional) so that externally-created searches
// satisfy the same non-`undefined` invariant the internal create path
// guarantees via `SavedSearchSchema.omit({ id: true })` — downstream consumers
// such as `tasks/checkAlerts` read these fields directly into query
// construction. `whereLanguage` reuses the shared enum to avoid drift.
// Length-bounded variant of FilterSchema so that 100 filters with arbitrarily
// large strings can't persist multi-MB documents close to Mongo's 16 MB limit.
const boundedFilterSchema = z.union([
  z.object({
    type: z.enum(['lucene', 'sql']),
    condition: z.string().max(8192),
  }),
  z.object({
    type: z.literal('sql_ast'),
    operator: z.enum(['=', '<', '>', '!=', '<=', '>=']),
    left: z.string().max(8192),
    right: z.string().max(8192),
  }),
]);

const bodySchema = z.object({
  name: z.string().min(1).max(1024),
  sourceId: objectIdSchema,
  where: z.string().max(8192).default(''),
  whereLanguage: SearchConditionLanguageSchema,
  select: z.string().max(4096).default(''),
  orderBy: z.string().max(1024).optional(),
  tags: z.array(z.string().max(32)).max(50).default([]),
  filters: z.array(boundedFilterSchema).max(100).optional(),
});

// Fields that are optional on the body and therefore cleared (rather than
// merged) when omitted from a PUT request. See the PUT handler for details.
const CLEARABLE_ON_REPLACE = ['whereLanguage', 'orderBy', 'filters'] as const;

/**
 * Verifies that `sourceId` refers to a source owned by `teamId`. Returns true
 * when the source exists and belongs to the team, false otherwise. Extracted so
 * the create and update handlers share a single ownership check.
 */
async function isSourceOwnedByTeam(
  teamId: mongoose.Types.ObjectId | string,
  sourceId: string,
): Promise<boolean> {
  const source = await Source.findOne({ _id: sourceId, team: teamId });
  return source != null;
}

const router = express.Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     SavedSearchFilter:
 *       description: |
 *         A structured filter applied to the saved search. Either a
 *         language-based condition or a SQL AST comparison.
 *       oneOf:
 *         - type: object
 *           required:
 *             - type
 *             - condition
 *           properties:
 *             type:
 *               type: string
 *               enum: [lucene, sql]
 *               description: Language used to interpret `condition`.
 *               example: lucene
 *             condition:
 *               type: string
 *               description: The filter condition expression.
 *               example: "level:error"
 *         - type: object
 *           required:
 *             - type
 *             - operator
 *             - left
 *             - right
 *           properties:
 *             type:
 *               type: string
 *               enum: [sql_ast]
 *               example: sql_ast
 *             operator:
 *               type: string
 *               enum: ['=', '<', '>', '!=', '<=', '>=']
 *               example: "="
 *             left:
 *               type: string
 *               example: ServiceName
 *             right:
 *               type: string
 *               example: "'api'"
 *     SavedSearch:
 *       type: object
 *       required:
 *         - id
 *         - name
 *         - teamId
 *       properties:
 *         id:
 *           type: string
 *           description: Unique saved search ID.
 *           example: 507f1f77bcf86cd799439012
 *         name:
 *           type: string
 *           description: Display name for the saved search.
 *           example: Production errors
 *         sourceId:
 *           type: string
 *           description: ID of the source this saved search queries.
 *           example: 507f1f77bcf86cd799439013
 *         where:
 *           type: string
 *           description: Search condition/filter expression.
 *           example: "SeverityText:ERROR"
 *         whereLanguage:
 *           type: string
 *           enum: [lucene, sql, promql]
 *           description: Language used to interpret the `where` expression.
 *           example: lucene
 *         select:
 *           type: string
 *           description: Comma-separated list of columns to select.
 *           example: "Timestamp,Body,ServiceName"
 *         orderBy:
 *           type: string
 *           description: Ordering expression.
 *           example: "Timestamp DESC"
 *         tags:
 *           type: array
 *           description: Tags associated with the saved search.
 *           items:
 *             type: string
 *           example: ["errors", "production"]
 *         filters:
 *           type: array
 *           description: Structured filters applied to the saved search.
 *           items:
 *             $ref: '#/components/schemas/SavedSearchFilter'
 *         teamId:
 *           type: string
 *           description: ID of the team that owns the saved search.
 *           example: 507f1f77bcf86cd799439011
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp.
 *           example: "2025-01-01T00:00:00.000Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp.
 *           example: "2025-06-15T10:30:00.000Z"
 *     CreateSavedSearchRequest:
 *       type: object
 *       required:
 *         - name
 *         - sourceId
 *       properties:
 *         name:
 *           type: string
 *           description: Display name for the saved search.
 *           example: Production errors
 *         sourceId:
 *           type: string
 *           description: ID of the source this saved search queries.
 *           example: 507f1f77bcf86cd799439013
 *         where:
 *           type: string
 *           description: Search condition/filter expression. Defaults to an empty string when omitted.
 *           example: "SeverityText:ERROR"
 *         whereLanguage:
 *           type: string
 *           enum: [lucene, sql, promql]
 *           description: Language used to interpret the `where` expression.
 *           example: lucene
 *         select:
 *           type: string
 *           description: Comma-separated list of columns to select. Defaults to an empty string when omitted.
 *           example: "Timestamp,Body,ServiceName"
 *         orderBy:
 *           type: string
 *           description: Ordering expression.
 *           example: "Timestamp DESC"
 *         tags:
 *           type: array
 *           description: Tags associated with the saved search. Defaults to an empty array when omitted.
 *           items:
 *             type: string
 *           example: ["errors", "production"]
 *         filters:
 *           type: array
 *           description: Structured filters applied to the saved search.
 *           items:
 *             $ref: '#/components/schemas/SavedSearchFilter'
 *     UpdateSavedSearchRequest:
 *       type: object
 *       description: |
 *         Full replacement of a saved search (PUT semantics). `name` and
 *         `sourceId` are required. `where`, `select` and `tags` default to
 *         empty values when omitted. `whereLanguage`, `orderBy` and `filters`
 *         are cleared when omitted.
 *       required:
 *         - name
 *         - sourceId
 *       properties:
 *         name:
 *           type: string
 *           example: Production errors
 *         sourceId:
 *           type: string
 *           example: 507f1f77bcf86cd799439013
 *         where:
 *           type: string
 *           example: "SeverityText:ERROR"
 *         whereLanguage:
 *           type: string
 *           enum: [lucene, sql, promql]
 *           example: lucene
 *         select:
 *           type: string
 *           example: "Timestamp,Body,ServiceName"
 *         orderBy:
 *           type: string
 *           example: "Timestamp DESC"
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           example: ["errors", "production"]
 *         filters:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SavedSearchFilter'
 *     SavedSearchResponseEnvelope:
 *       type: object
 *       properties:
 *         data:
 *           $ref: '#/components/schemas/SavedSearch'
 *     SavedSearchListResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SavedSearch'
 */

/**
 * @openapi
 * /api/v2/saved-searches:
 *   get:
 *     summary: List Saved Searches
 *     description: Retrieves a list of all saved searches for the authenticated team
 *     operationId: listSavedSearches
 *     tags: [Saved Searches]
 *     responses:
 *       '200':
 *         description: Successfully retrieved saved searches
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SavedSearchListResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) return res.sendStatus(403);

    const results = await SavedSearch.find({ team: teamId }).sort({ name: 1 });
    res.json({ data: results.map(s => s.toExternalJSON()) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/v2/saved-searches/{id}:
 *   get:
 *     summary: Get Saved Search
 *     description: Retrieves a specific saved search by ID
 *     operationId: getSavedSearch
 *     tags: [Saved Searches]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Saved Search ID
 *     responses:
 *       '200':
 *         description: Successfully retrieved saved search
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SavedSearchResponseEnvelope'
 *       '400':
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               \$ref: '#/components/schemas/Error'
 *       '404':
 *         description: Saved search not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
  '/:id',
  validateRequest({ params: z.object({ id: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) return res.sendStatus(403);

      const doc = await SavedSearch.findOne({
        _id: req.params.id,
        team: teamId,
      });
      if (doc == null) return res.sendStatus(404);

      res.json({ data: doc.toExternalJSON() });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/saved-searches:
 *   post:
 *     summary: Create Saved Search
 *     description: Creates a new saved search
 *     operationId: createSavedSearch
 *     tags: [Saved Searches]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateSavedSearchRequest'
 *     responses:
 *       '200':
 *         description: Successfully created saved search
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SavedSearchResponseEnvelope'
 *       '400':
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "sourceId not found"
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               \$ref: '#/components/schemas/Error'
 */
router.post(
  '/',
  validateRequest({ body: bodySchema }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) return res.sendStatus(403);
      const userId = req.user?._id;

      const {
        name,
        sourceId,
        where,
        whereLanguage,
        select,
        orderBy,
        tags,
        filters,
      } = req.body;

      if (!(await isSourceOwnedByTeam(teamId, sourceId))) {
        return res.status(400).json({ message: 'sourceId not found' });
      }

      // Reuse the internal controller so `createdBy`/`updatedBy` audit metadata
      // is persisted consistently with the internal create path.
      const doc = await createSavedSearch(
        teamId.toString(),
        {
          name,
          source: sourceId,
          where,
          whereLanguage,
          select,
          orderBy,
          tags,
          filters,
        },
        userId?.toString(),
      );

      res.json({ data: doc.toExternalJSON() });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/saved-searches/{id}:
 *   put:
 *     summary: Update Saved Search
 *     description: |
 *       Replaces an existing saved search (full-replace semantics).
 *
 *       `name` and `sourceId` are required. `where`, `select` and `tags`
 *       default to empty values when omitted. `whereLanguage`, `orderBy` and
 *       `filters` are cleared when omitted from the request body.
 *     operationId: updateSavedSearch
 *     tags: [Saved Searches]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Saved Search ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateSavedSearchRequest'
 *     responses:
 *       '200':
 *         description: Successfully updated saved search
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SavedSearchResponseEnvelope'
 *       '400':
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "sourceId not found"
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               \$ref: '#/components/schemas/Error'
 *       '404':
 *         description: Saved search not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put(
  '/:id',
  validateRequest({
    params: z.object({ id: objectIdSchema }),
    body: bodySchema,
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) return res.sendStatus(403);
      const userId = req.user?._id;

      const { name, sourceId, where, select, tags } = req.body;

      if (!(await isSourceOwnedByTeam(teamId, sourceId))) {
        return res.status(400).json({ message: 'sourceId not found' });
      }

      // Full-replace semantics: required and defaulted fields are always set.
      // Optional fields that were omitted from the request are explicitly
      // unset (cleared) so the stored document deterministically matches the
      // request body rather than depending on ODM undefined handling.
      const $set: Record<string, unknown> = {
        name,
        source: sourceId,
        where,
        select,
        tags,
        updatedBy: userId,
      };
      const $unset: Record<string, ''> = {};
      for (const field of CLEARABLE_ON_REPLACE) {
        if (req.body[field] === undefined) {
          $unset[field] = '';
        } else {
          $set[field] = req.body[field];
        }
      }

      const doc = await SavedSearch.findOneAndUpdate(
        { _id: req.params.id, team: teamId },
        {
          $set,
          ...(Object.keys($unset).length > 0 ? { $unset } : {}),
        },
        { new: true },
      );
      if (doc == null) return res.sendStatus(404);

      res.json({ data: doc.toExternalJSON() });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/saved-searches/{id}:
 *   delete:
 *     summary: Delete Saved Search
 *     description: Deletes a saved search and any alerts that reference it
 *     operationId: deleteSavedSearch
 *     tags: [Saved Searches]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Saved Search ID
 *     responses:
 *       '200':
 *         description: Successfully deleted saved search
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmptyResponse'
 *             example: {}
 *       '400':
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               \$ref: '#/components/schemas/Error'
 *       '404':
 *         description: Saved search not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) return res.sendStatus(403);

      // Reuse the internal controller so alerts that reference this saved
      // search are cascade-deleted rather than left orphaned.
      const deleted = await deleteSavedSearch(teamId.toString(), req.params.id);
      if (deleted == null) return res.sendStatus(404);

      res.json({});
    } catch (e) {
      next(e);
    }
  },
);

export default router;
