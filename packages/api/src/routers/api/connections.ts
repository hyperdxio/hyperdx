import { ConnectionSchema } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { validateRequest } from 'zod-express-middleware';

import {
  createConnection,
  deleteConnection,
  getConnectionById,
  getConnections,
  updateConnection,
} from '@/controllers/connection';
import { getNonNullUserWithTeam } from '@/middleware/auth';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const connections = await getConnections();

    res.json(connections.map(c => c.toJSON({ virtuals: true })));
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  validateRequest({
    body: ConnectionSchema.omit({ id: true }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);

      const connection = await createConnection(teamId.toString(), {
        ...req.body,
        password: req.body.password ?? '',
        team: teamId,
      });

      res.status(200).send({ id: connection._id.toString() });
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/:id',
  validateRequest({
    body: ConnectionSchema,
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);

      const connection = await getConnectionById(
        teamId.toString(),
        req.params.id,
      );

      if (!connection) {
        res.status(404).send();
        return;
      }

      const newConnection = {
        ...req.body,
        team: teamId,
        ...(req.body.password
          ? { password: req.body.password }
          : {
              password: connection.password,
            }),
      };

      const updatedConnection = await updateConnection(
        teamId.toString(),
        req.params.id,
        newConnection,
      );

      if (!updatedConnection) {
        res.status(404).send();
        return;
      }

      res.status(200).send();
    } catch (e) {
      next(e);
    }
  },
);

router.delete('/:id', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);

    await deleteConnection(teamId.toString(), req.params.id);

    res.status(200).send();
  } catch (e) {
    next(e);
  }
});

export default router;
