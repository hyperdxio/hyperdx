import * as config from '@/config';
import { createTeam, isTeamExisting } from '@/controllers/team';
import { findUserByEmail } from '@/controllers/user';
import User from '@/models/user';

import logger from './logger';

export const userInitialize = async () => {
  logger.info('Initializing user...');
  const email = config.EMAIL;
  const password = config.PASSWORD;

  if (!email && !password) {
    return;
  }

  if (email === '' && password === '') {
    logger.error('Email and password must not be empty');
    logger.info('Continuing without initializing user');
    return;
  }

  const user = await findUserByEmail(email);

  if (user) {
    logger.info('User already exists');
    return;
  }

  if (await isTeamExisting()) {
    logger.info('Team already exists');
    return;
  }

  (User as any).register(
    new User({ email }),
    password,
    async (err: Error, user: any) => {
      if (err) {
        throw new Error(err.message);
      }

      const team = await createTeam({
        name: `${email}'s Team`,
      });
      user.team = team._id;
      user.name = email;
      try {
        await user.save();
        logger.info('User initialized successfully, with email: ', email);
      } catch (e) {
        logger.error('Failed to initializing user');
      }
    },
  );
};
