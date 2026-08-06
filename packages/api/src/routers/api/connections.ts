import { ConnectionSchema } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { validateRequest } from 'zod-express-middleware';

import {
  createConnection,
  deleteConnection,
  getConnectionById,
  getConnectionsByTeam,
  updateConnection,
} from '@/controllers/connection';
import { getNonNullUserWithTeam } from '@/middleware/auth';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);

    const connections = await getConnectionsByTeam(teamId.toString());

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

      // `platformProvisioned` records how a connection came to exist and
      // decides whether IaC export treats it as safe to `terraform import`, so
      // it is server-owned. `validateRequest` only validates — it does not
      // replace `req.body` — so a client-supplied value would otherwise reach
      // the model. Re-parsing rather than omitting the one key by name: zod
      // strips every unknown key, so this holds for the next server-owned
      // field too, and lodash's `omit` types its key as `keyof any` rather
      // than `keyof T`, so a typo in the name would compile silently.
      const body = ConnectionSchema.omit({ id: true }).parse(req.body);

      const connection = await createConnection(teamId.toString(), {
        ...body,
        password: req.body.password ?? '',
        team: teamId,
        hyperdxSettingPrefix: req.body.hyperdxSettingPrefix ?? undefined,
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

      const shouldUnsetPrefix =
        req.body.hyperdxSettingPrefix === null ||
        req.body.hyperdxSettingPrefix === '';

      // `platformProvisioned` is server-owned — see the POST handler above.
      const { hyperdxSettingPrefix, ...restBody } = ConnectionSchema.parse(
        req.body,
      );

      const newConnection = {
        ...restBody,
        team: teamId,
        ...(req.body.password
          ? { password: req.body.password }
          : {
              password: connection.password,
            }),
        ...(!shouldUnsetPrefix && hyperdxSettingPrefix
          ? { hyperdxSettingPrefix }
          : {}),
      };

      const updatedConnection = await updateConnection(
        teamId.toString(),
        req.params.id,
        newConnection,
        shouldUnsetPrefix ? ['hyperdxSettingPrefix'] : [],
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
