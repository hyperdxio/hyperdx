import express from 'express';
import { z } from 'zod';

import { SavedSearch } from '@/models/savedSearch';
import { processRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
import { objectIdSchema } from '@/utils/zod';

const bodySchema = z.object({
  name: z.string().min(1).max(1024),
  sourceId: objectIdSchema,
  where: z.string().max(8192).optional(),
  whereLanguage: z.enum(['lucene', 'sql']).optional(),
  select: z.string().max(4096).optional(),
  orderBy: z.string().max(1024).optional(),
  tags: z.array(z.string().max(32)).max(50).optional(),
});

const router = express.Router();

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
 *       '401':
 *         description: Unauthorized
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
 *       '401':
 *         description: Unauthorized
 *       '404':
 *         description: Saved search not found
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
 *       '400':
 *         description: Bad request
 *       '401':
 *         description: Unauthorized
 */
router.post(
  '/',
  validateRequest({ body: bodySchema }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) return res.sendStatus(403);

      const { name, sourceId, where, whereLanguage, select, orderBy, tags } =
        req.body;
      const doc = await new SavedSearch({
        team: teamId,
        source: sourceId,
        name,
        where,
        whereLanguage,
        select,
        orderBy,
        tags,
      }).save();

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
 *     description: Updates an existing saved search
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
 *             $ref: '#/components/schemas/CreateSavedSearchRequest'
 *     responses:
 *       '200':
 *         description: Successfully updated saved search
 *       '401':
 *         description: Unauthorized
 *       '404':
 *         description: Saved search not found
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

      const { name, sourceId, where, whereLanguage, select, orderBy, tags } =
        req.body;
      const doc = await SavedSearch.findOneAndUpdate(
        { _id: req.params.id, team: teamId },
        {
          $set: {
            name,
            source: sourceId,
            where,
            whereLanguage,
            select,
            orderBy,
            tags,
          },
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
 *     description: Deletes a saved search
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
 *       '401':
 *         description: Unauthorized
 *       '404':
 *         description: Saved search not found
 */
router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) return res.sendStatus(403);

      const doc = await SavedSearch.findOneAndDelete({
        _id: req.params.id,
        team: teamId,
      });
      if (doc == null) return res.sendStatus(404);

      res.json({});
    } catch (e) {
      next(e);
    }
  },
);

export default router;
