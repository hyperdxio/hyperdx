import { FilterSchema } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { z } from 'zod';

import {
  createSavedSearch,
  deleteSavedSearch,
  getSavedSearch,
  updateSavedSearch,
} from '@/controllers/savedSearch';
import { getSource } from '@/controllers/sources';
import { SavedSearch } from '@/models/savedSearch';
import { processRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
import {
  getPagination,
  paginationMeta,
  paginationQuerySchema,
} from '@/utils/pagination';
import { objectIdSchema } from '@/utils/zod';

// External request body. Uses `sourceId` (not the internal `source`) so the
// create/update contract matches the shape returned by toExternalJSON().
const savedSearchRequestSchema = z.object({
  name: z.string().trim().min(1),
  sourceId: objectIdSchema,
  select: z.string().optional().default(''),
  where: z.string().optional().default(''),
  whereLanguage: z.enum(['lucene', 'sql']).optional().default('lucene'),
  orderBy: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  filters: z.array(FilterSchema).optional(),
});

// Maps the validated external body to the internal controller input, renaming
// sourceId -> source.
function toSavedSearchInput(
  body: z.infer<typeof savedSearchRequestSchema>,
): Parameters<typeof createSavedSearch>[1] {
  const { sourceId, ...rest } = body;
  return { ...rest, source: sourceId };
}

// Runs after body validation. Ensures sourceId references a source owned by the
// team; the Mongoose model would otherwise accept any ObjectId and let a saved
// search point at another team's source.
async function requireValidSourceId(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const source = await getSource(teamId.toString(), req.body.sourceId);
    if (source == null) {
      return res
        .status(400)
        .json({ message: 'sourceId must be an existing source id' });
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * @openapi
 * components:
 *   schemas:
 *     SavedSearch:
 *       type: object
 *       required:
 *         - id
 *         - name
 *         - sourceId
 *       properties:
 *         id:
 *           type: string
 *           readOnly: true
 *           description: Unique saved search ID. Server-generated.
 *           example: 507f1f77bcf86cd799439011
 *         name:
 *           type: string
 *           description: Display name for the saved search.
 *           example: Production Errors
 *         sourceId:
 *           type: string
 *           description: ID of the source this saved search queries.
 *           example: 507f1f77bcf86cd799439012
 *         select:
 *           type: string
 *           description: Comma-separated list of column expressions to display. Empty uses the source default.
 *           example: Timestamp, ServiceName, Body
 *         where:
 *           type: string
 *           description: Row filter expression. The language is controlled by whereLanguage.
 *           example: "SeverityText:ERROR"
 *         whereLanguage:
 *           type: string
 *           enum: [lucene, sql]
 *           description: Language used for the where filter.
 *           example: lucene
 *         orderBy:
 *           type: string
 *           description: ORDER BY expression. Empty uses the source default.
 *           example: Timestamp DESC
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           description: Tags used to organize saved searches.
 *         filters:
 *           type: array
 *           description: Structured pinned filters applied to the search.
 *           items:
 *             type: object
 *         teamId:
 *           type: string
 *           readOnly: true
 *           description: ID of the team that owns the saved search.
 *           example: 507f1f77bcf86cd799439013
 *         createdAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *           description: Creation timestamp.
 *           example: "2025-01-01T00:00:00.000Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *           description: Last update timestamp.
 *           example: "2025-06-15T10:30:00.000Z"
 *     SavedSearchInput:
 *       type: object
 *       required:
 *         - name
 *         - sourceId
 *       properties:
 *         name:
 *           type: string
 *           description: Display name for the saved search.
 *           example: Production Errors
 *         sourceId:
 *           type: string
 *           description: ID of the source to query. Must belong to the team.
 *           example: 507f1f77bcf86cd799439012
 *         select:
 *           type: string
 *           description: Comma-separated list of column expressions to display. Empty uses the source default.
 *           example: Timestamp, ServiceName, Body
 *         where:
 *           type: string
 *           description: Row filter expression. The language is controlled by whereLanguage.
 *           example: "SeverityText:ERROR"
 *         whereLanguage:
 *           type: string
 *           enum: [lucene, sql]
 *           default: lucene
 *           description: Language used for the where filter.
 *           example: lucene
 *         orderBy:
 *           type: string
 *           description: ORDER BY expression. Empty uses the source default.
 *           example: Timestamp DESC
 *         tags:
 *           type: array
 *           description: Tags used to organize saved searches.
 *           items:
 *             type: string
 *         filters:
 *           type: array
 *           description: Structured pinned filters applied to the search.
 *           items:
 *             type: object
 *     SavedSearchesListResponse:
 *       type: object
 *       required:
 *         - data
 *         - meta
 *       properties:
 *         data:
 *           type: array
 *           description: List of saved search objects.
 *           items:
 *             $ref: '#/components/schemas/SavedSearch'
 *         meta:
 *           $ref: '#/components/schemas/PaginationMeta'
 *           description: Pagination metadata for this result page.
 *     SavedSearchResponseEnvelope:
 *       type: object
 *       properties:
 *         data:
 *           $ref: '#/components/schemas/SavedSearch'
 *           description: The saved search object.
 */

const router = express.Router();

/**
 * @openapi
 * /api/v2/saved-searches:
 *   get:
 *     summary: List Saved Searches
 *     description: Retrieves saved searches for the authenticated team.
 *     operationId: listSavedSearches
 *     tags: [Saved Searches]
 *     parameters:
 *       - name: limit
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *           default: 1000
 *         description: Maximum number of saved searches to return.
 *       - name: offset
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of saved searches to skip before returning results.
 *     responses:
 *       '200':
 *         description: Successfully retrieved saved searches
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SavedSearchesListResponse'
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
router.get(
  '/',
  validateRequest({ query: paginationQuerySchema }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const { limit, offset } = getPagination(req.query);
      const filter = { team: teamId.toString() };
      // Sort by _id so skip/offset paging is stable across requests.
      const [savedSearches, total] = await Promise.all([
        SavedSearch.find(filter).sort({ _id: 1 }).skip(offset).limit(limit),
        SavedSearch.countDocuments(filter),
      ]);

      return res.json({
        data: savedSearches.map(s => s.toExternalJSON()),
        meta: paginationMeta({ limit, offset }, total),
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/saved-searches/{id}:
 *   get:
 *     summary: Get Saved Search
 *     description: Retrieves a specific saved search by ID.
 *     operationId: getSavedSearch
 *     tags: [Saved Searches]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Saved search ID
 *         example: "507f1f77bcf86cd799439011"
 *     responses:
 *       '200':
 *         description: Successfully retrieved saved search
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SavedSearchResponseEnvelope'
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
      if (teamId == null) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const savedSearch = await getSavedSearch(
        teamId.toString(),
        req.params.id,
      );

      if (savedSearch == null) {
        return res.status(404).json({ message: 'Saved search not found' });
      }

      res.json({ data: savedSearch.toExternalJSON() });
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
 *     description: Creates a new saved search.
 *     operationId: createSavedSearch
 *     tags: [Saved Searches]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SavedSearchInput'
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
router.post(
  '/',
  validateRequest({ body: savedSearchRequestSchema }),
  requireValidSourceId,
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const userId = req.user?._id;
      if (teamId == null) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const savedSearch = await createSavedSearch(
        teamId.toString(),
        toSavedSearchInput(req.body),
        userId?.toString(),
      );

      res.json({ data: savedSearch.toExternalJSON() });
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
 *       Updates an existing saved search. Send the full object: `name`,
 *       `sourceId`, `select`, `where`, `whereLanguage`, and `tags` are always
 *       written (they fall back to their defaults when omitted). Omitting the
 *       optional `orderBy` or `filters` leaves the stored value unchanged
 *       rather than clearing it.
 *     operationId: updateSavedSearch
 *     tags: [Saved Searches]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Saved search ID
 *         example: "507f1f77bcf86cd799439011"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SavedSearchInput'
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
    body: savedSearchRequestSchema,
  }),
  requireValidSourceId,
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const userId = req.user?._id;
      if (teamId == null) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const savedSearch = await updateSavedSearch(
        teamId.toString(),
        req.params.id,
        toSavedSearchInput(req.body),
        userId?.toString(),
      );

      if (savedSearch == null) {
        return res.status(404).json({ message: 'Saved search not found' });
      }

      res.json({ data: savedSearch.toExternalJSON() });
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
 *     description: Deletes a saved search and any alerts attached to it.
 *     operationId: deleteSavedSearch
 *     tags: [Saved Searches]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Saved search ID
 *         example: "507f1f77bcf86cd799439011"
 *     responses:
 *       '200':
 *         description: Successfully deleted saved search
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmptyResponse'
 *             example: {}
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
      if (teamId == null) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const deleted = await deleteSavedSearch(teamId.toString(), req.params.id);

      if (deleted == null) {
        return res.status(404).json({ message: 'Saved search not found' });
      }

      res.json({});
    } catch (e) {
      next(e);
    }
  },
);

export default router;
