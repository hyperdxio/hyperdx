import type {
  CreateOrgApiKeyApiResponse,
  OrgApiKeyApiResponse,
  OrgApiKeysApiResponse,
} from '@hyperdx/common-utils/dist/types';
import {
  CreateOrgApiKeyRequestSchema,
  UpdateOrgApiKeyRequestSchema,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { z } from 'zod';
import { processRequest, validateRequest } from 'zod-express-middleware';

import {
  createOrgApiKey,
  deleteOrgApiKey,
  formatOrgApiKey,
  listOrgApiKeys,
  updateOrgApiKeyDescription,
} from '@/controllers/orgApiKey';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { getCounter } from '@/utils/instrumentation';
import { canManageOrgApiKeys } from '@/utils/orgApiKeyPolicy';
import { objectIdSchema } from '@/utils/zod';

const orgApiKeyOperations = getCounter('hyperdx.org_api_key.operations', {
  description: 'Org API key changes made in Team Settings, by operation.',
});

// Session-only on purpose: no key can create or revoke another key.
const router = express.Router();

router.use((req, res, next) => {
  if (req.user == null || !canManageOrgApiKeys(req.user)) {
    return res.sendStatus(403);
  }
  next();
});

router.get(
  '/',
  async (req, res: express.Response<OrgApiKeysApiResponse>, next) => {
    try {
      const keys = await listOrgApiKeys(getNonNullUserWithTeam(req).teamId);
      res.json({ data: keys.map(formatOrgApiKey) });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/',
  processRequest({ body: CreateOrgApiKeyRequestSchema }),
  async (req, res: express.Response<CreateOrgApiKeyApiResponse>, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      const { doc, key } = await createOrgApiKey(teamId, userId, req.body);
      await doc.populate('createdBy', 'name email');
      orgApiKeyOperations.add(1, { operation: 'create' });
      res.json({ ...formatOrgApiKey(doc), key });
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/:id',
  processRequest({
    params: z.object({ id: objectIdSchema }),
    body: UpdateOrgApiKeyRequestSchema,
  }),
  async (req, res: express.Response<OrgApiKeyApiResponse>, next) => {
    try {
      const doc = await updateOrgApiKeyDescription(
        getNonNullUserWithTeam(req).teamId,
        req.params.id,
        req.body.description,
      );
      if (doc == null) {
        return res.sendStatus(404);
      }
      orgApiKeyOperations.add(1, { operation: 'update' });
      res.json(formatOrgApiKey(doc));
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const doc = await deleteOrgApiKey(
        getNonNullUserWithTeam(req).teamId,
        req.params.id,
      );
      if (doc == null) {
        return res.sendStatus(404);
      }
      orgApiKeyOperations.add(1, { operation: 'revoke' });
      res.sendStatus(204);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
