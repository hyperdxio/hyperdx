import express from 'express';

import { Api404Error } from '@/utils/errors';
import { getTeam } from '@/controllers/team';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    if (req.user == null) {
      throw new Api404Error('Request without user found');
    }

    const {
      _id: id,
      accessKey,
      createdAt,
      email,
      name,
      team: teamId,
    } = req.user;

    const team = await getTeam(teamId);

    return res.json({
      accessKey,
      createdAt,
      email,
      id,
      name,
      team,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
