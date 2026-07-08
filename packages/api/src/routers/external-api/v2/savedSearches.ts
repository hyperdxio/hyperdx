import { isRenderablePinnedFilter } from '@hyperdx/common-utils/dist/filters';
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
import { objectIdSchema, tagsSchema } from '@/utils/zod';

// Cap the number of pinned filters a single saved search can carry. Filters are
// applied per query, so an unbounded array is both a storage and a query-cost
// concern; 100 is far above any realistic UI-built search.
const MAX_SAVED_SEARCH_FILTERS = 100;

// Cap the filter condition to the same size as `where` — otherwise the
// `where`/`select` length caps are trivially bypassed by relocating a huge
// expression into a filter condition.
const MAX_FILTER_EXPR_LENGTH = 8 * 1024;

// Saved-search filters must use the pinned-filter shape the sidebar can render:
// `{ type: 'sql', condition: "<col> IN ('<v1>', ...)" }` (or `NOT IN` /
// `BETWEEN`) — the exact output of filtersToQuery. The shared `FilterSchema`
// also permits `lucene` and `sql_ast` shapes, and even a `type: 'sql'` condition
// that isn't a pinned-filter predicate (e.g. `foo = 1`) is silently dropped by
// the sidebar's reverse parser (parseQuery). So beyond restricting `type` to
// 'sql', validate the condition actually round-trips through parseQuery via the
// shared `isRenderablePinnedFilter` helper — a filter is accepted iff it would
// render. `type` defaults to 'sql' when omitted so a minimal `{ condition }`
// still validates.
const savedSearchFilterSchema = z
  .object({
    type: z.literal('sql').optional().default('sql'),
    condition: z.string().min(1).max(MAX_FILTER_EXPR_LENGTH),
  })
  .refine(
    f => isRenderablePinnedFilter({ type: 'sql', condition: f.condition }),
    {
      message:
        'filter condition must be a sidebar-renderable SQL predicate, e.g. "<column> IN (\'<value>\', ...)"',
      path: ['condition'],
    },
  );

// External request body. Uses `sourceId` (not the internal `source`) so the
// create/update contract matches the shape returned by toExternalJSON().
// PUT is a full replace: every optional field resets to its default when
// omitted (uniform semantics). orderBy/filters carry defaults for the same
// reason select/where/whereLanguage/tags do — so a read-modify-write client
// that drops a field gets a predictable reset rather than a silent preserve.
// String/array fields are size-capped to mirror the other external API schemas
// (see search.ts, dashboards) and to bound request/storage size.
const savedSearchRequestSchema = z.object({
  name: z.string().trim().min(1).max(1024),
  sourceId: objectIdSchema,
  select: z
    .string()
    .max(4 * 1024)
    .optional()
    .default(''),
  where: z
    .string()
    .max(8 * 1024)
    .optional()
    .default(''),
  whereLanguage: z.enum(['lucene', 'sql']).optional().default('lucene'),
  orderBy: z.string().max(1024).optional().default(''),
  tags: tagsSchema.default([]),
  filters: z
    .array(savedSearchFilterSchema)
    .max(MAX_SAVED_SEARCH_FILTERS)
    .default([]),
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
 *     SavedSearchFilter:
 *       type: object
 *       required:
 *         - condition
 *       description: >-
 *         A single pinned filter applied to the search. Filters must use the SQL
 *         predicate form the UI produces so they render as a sidebar facet:
 *         `<column> IN ('<value1>', ...)` (or `NOT IN` / `BETWEEN`). Conditions
 *         that are not in this form are rejected, since they would not appear in
 *         the sidebar.
 *       properties:
 *         type:
 *           type: string
 *           enum: [sql]
 *           default: sql
 *           description: Always `sql`. Only SQL predicate filters render in the sidebar.
 *           example: sql
 *         condition:
 *           type: string
 *           maxLength: 8192
 *           description: SQL predicate applied to the search, in `<column> IN (...)` form.
 *           example: "ServiceName IN ('checkout', 'payments')"
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
 *           maxItems: 50
 *           items:
 *             type: string
 *             maxLength: 32
 *           description: Tags used to organize saved searches.
 *           example: ["production", "errors"]
 *         filters:
 *           type: array
 *           maxItems: 100
 *           description: Structured pinned filters applied to the search.
 *           items:
 *             $ref: '#/components/schemas/SavedSearchFilter'
 *           example:
 *             - type: sql
 *               condition: "ServiceName IN ('checkout', 'payments')"
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
 *           maxLength: 1024
 *           description: Display name for the saved search.
 *           example: Production Errors
 *         sourceId:
 *           type: string
 *           description: ID of the source to query. Must belong to the team.
 *           example: 507f1f77bcf86cd799439012
 *         select:
 *           type: string
 *           maxLength: 4096
 *           description: Comma-separated list of column expressions to display. Empty uses the source default.
 *           example: Timestamp, ServiceName, Body
 *         where:
 *           type: string
 *           maxLength: 8192
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
 *           maxLength: 1024
 *           description: ORDER BY expression. Empty uses the source default.
 *           example: Timestamp DESC
 *         tags:
 *           type: array
 *           maxItems: 50
 *           description: Tags used to organize saved searches.
 *           items:
 *             type: string
 *             maxLength: 32
 *           example: ["production", "errors"]
 *         filters:
 *           type: array
 *           maxItems: 100
 *           description: Structured pinned filters applied to the search.
 *           items:
 *             $ref: '#/components/schemas/SavedSearchFilter'
 *           example:
 *             - type: sql
 *               condition: "ServiceName IN ('checkout', 'payments')"
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
 *     description: >-
 *       Retrieves saved searches for the authenticated team (paginated). Results
 *       are capped at `limit` (default and maximum 1000). When more records exist
 *       than are returned, `meta.total` exceeds `data.length`; clients with large
 *       collections must page with `limit`/`offset` to retrieve them all.
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

      // Surface the full count at the HTTP layer too, so a client that reads
      // headers but not the `meta` body can still detect truncation.
      res.set('X-Total-Count', String(total));
      return res.json({
        data: savedSearches.map(s => s.toExternalJSON()),
        meta: paginationMeta({ limit, offset }, total, 'saved-searches'),
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
 *       Updates an existing saved search. This is a full replace: send the
 *       full object. Every optional field (`select`, `where`, `whereLanguage`,
 *       `orderBy`, `tags`, `filters`) is always written and falls back to its
 *       default when omitted, so omitting a field resets it rather than
 *       preserving the stored value.
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
