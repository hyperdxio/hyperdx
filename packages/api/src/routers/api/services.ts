import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { getServices, updateService, getService, getServiceChecks } from '@/controllers/services';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { ServiceTier } from '@/models/service';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);
    const services = await getServices(teamId.toString());
    return res.json(services);
  } catch (e) {
    next(e);
  }
});

router.get('/:name', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);
    const service = await getService(teamId.toString(), req.params.name);
    
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }
    
    return res.json(service);
  } catch (e) {
    next(e);
  }
});

router.get('/:name/checks', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);
    const checks = await getServiceChecks(teamId.toString(), req.params.name);
    return res.json(checks);
  } catch (e) {
    next(e);
  }
});

router.patch(
  '/:name',
  validateRequest({
    body: z.object({
      description: z.string().optional(),
      owner: objectIdSchema.optional(),
      tier: z.nativeEnum(ServiceTier).optional(),
      runbookUrl: z.string().url().optional(),
      repoUrl: z.string().url().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const updatedService = await updateService(
        teamId.toString(),
        req.params.name,
        req.body
      );

      if (!updatedService) {
        return res.status(404).json({ error: 'Service not found' });
      }

      return res.json(updatedService);
    } catch (e) {
      next(e);
    }
  }
);

export default router;
