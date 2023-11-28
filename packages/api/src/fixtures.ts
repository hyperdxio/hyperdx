import mongoose from 'mongoose';
import request from 'supertest';

import * as config from './config';
import Server from './server';
import { createTeam, getTeam } from './controllers/team';
import { findUserByEmail } from './controllers/user';
import { mongooseConnection } from './models';

const MOCK_USER = {
  email: 'fake@deploysentinel.com',
  password: 'TacoCat!2#4X',
};

export const connectDB = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  await mongoose.connect(config.MONGO_URI);
};

export const closeDB = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  await mongooseConnection.dropDatabase();
};

export const clearDBCollections = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  const collections = mongooseConnection.collections;
  await Promise.all(
    Object.values(collections).map(async collection => {
      await collection.deleteMany({}); // an empty mongodb selector object ({}) must be passed as the filter argument
    }),
  );
};

// after connectDB
export const initCiEnvs = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }

  // Populate fake data here...
};

class MockServer extends Server {
  getHttpServer() {
    return this.httpServer;
  }

  async start(): Promise<void> {
    await super.start();
    await initCiEnvs();
  }

  closeHttpServer() {
    return new Promise<void>((resolve, reject) => {
      this.httpServer.close(err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}

export const getServer = () => new MockServer();

export const getAgent = (server: MockServer) =>
  request.agent(server.getHttpServer());

export const getLoggedInAgent = async (server: MockServer) => {
  const agent = getAgent(server);

  await agent
    .post('/register/password')
    .send({ ...MOCK_USER, confirmPassword: 'wrong-password' })
    .expect(400);
  await agent
    .post('/register/password')
    .send({ ...MOCK_USER, confirmPassword: MOCK_USER.password })
    .expect(200);

  const user = await findUserByEmail(MOCK_USER.email);
  const team = await getTeam(user?.team as any);

  if (team === null || user === null) {
    throw Error('team or user not found');
  }

  await user.save();

  // login app
  await agent.post('/login/password').send(MOCK_USER).expect(302);

  return {
    agent,
    team,
    user,
  };
};
