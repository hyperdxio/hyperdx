import mongoose from 'mongoose';
import request from 'supertest';

import * as config from './config';
import Server from './server';
import { createTeam } from './controllers/team';
import { mongooseConnection } from './models';

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
  // create a fake team with fake api key + setup gh integration
  await createTeam({ name: 'Fake Team' });
};

class MockServer extends Server {
  getHttpServer() {
    return this.httpServer;
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
