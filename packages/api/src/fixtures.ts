import {
  DisplayType,
  RawSqlSavedChartConfig,
  SavedChartConfig,
  Tile,
} from '@berg/common-utils/dist/types';
import mongoose from 'mongoose';
import request from 'supertest';

import * as config from '@/config';
import { getTeam } from '@/controllers/team';
import { findUserByEmail } from '@/controllers/user';
import { mongooseConnection } from '@/models';
import Server from '@/server';
import { MetricModel } from '@/utils/logParser';

import { ExternalDashboardTile } from './utils/zod';

const MOCK_USER = {
  email: 'fake@deploysentinel.com',
  password: 'TacoCat!2#4X',
};

export const connectDB = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  if (config.MONGO_URI == null) {
    throw new Error('MONGO_URI is not set');
  }
  await mongoose.connect(config.MONGO_URI);
};

export const closeDB = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  await mongooseConnection.dropDatabase();
  await mongoose.disconnect();
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
  // Populate fake persistent data here...
};

class MockServer extends Server {
  protected shouldHandleGracefulShutdown = false;

  getHttpServer() {
    return this.appServer;
  }

  async start(): Promise<void> {
    if (!config.IS_CI) {
      throw new Error('ONLY execute this in CI env 😈 !!!');
    }
    try {
      await super.start();
      await initCiEnvs();
    } catch (err) {
      console.error(err);
    }
  }

  async stop() {
    await new Promise<void>((resolve, reject) => {
      this.appServer.close(err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
    await super.shutdown();
  }

  clearDBs() {
    return clearDBCollections();
  }
}

export const getServer = () => new MockServer();

export const getAgent = (server: MockServer) =>
  request.agent(server.getHttpServer());

export const getLoggedInAgent = async (server: MockServer) => {
  const agent = getAgent(server);

  await agent
    .post('/register/password')
    .send({ ...MOCK_USER, confirmPassword: MOCK_USER.password })
    .expect(200);

  const user = await findUserByEmail(MOCK_USER.email);
  const team = await getTeam(user?.team as any);

  if (team === null || user === null) {
    throw Error('team or user not found');
  }

  // login app
  await agent.post('/login/password').send(MOCK_USER).expect(302);

  return {
    agent,
    team,
    user,
  };
};

enum MetricsDataType {
  Gauge = 'Gauge',
  Histogram = 'Histogram',
  Sum = 'Sum',
  Summary = 'Summary',
  // TODO: support 'ExponentialHistogram'
}

// TODO: DEPRECATED
export function buildMetricSeries({
  tags,
  name,
  points,
  data_type,
  is_delta,
  is_monotonic,
  unit,
  team_id,
}: {
  tags: Record<string, string>;
  name: string;
  points: { value: number; timestamp: number; le?: string }[];
  data_type: MetricsDataType;
  is_monotonic: boolean;
  is_delta: boolean;
  unit: string;
  team_id: string;
}): MetricModel[] {
  // @ts-ignore TODO: Fix Timestamp types
  return points.map(({ value, timestamp, le }) => ({
    _string_attributes: { ...tags, ...(le && { le }) },
    name,
    value,
    timestamp: `${timestamp}000000`,
    data_type,
    is_monotonic,
    is_delta,
    unit,
    team_id,
  }));
}

export const randomMongoId = () => new mongoose.Types.ObjectId().toHexString();

export const makeTile = (opts?: { id?: string; sourceId?: string }): Tile => ({
  id: opts?.id ?? randomMongoId(),
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  config: makeChartConfig(opts),
});

export const makeChartConfig = (opts?: {
  id?: string;
  sourceId?: string;
}): SavedChartConfig => ({
  name: 'Test Chart',
  source: opts?.sourceId ?? 'test-source',
  displayType: DisplayType.Line,
  select: [
    {
      aggFn: 'count',
      aggCondition: '',
      aggConditionLanguage: 'lucene',
      valueExpression: '',
    },
  ],
  where: '',
  whereLanguage: 'lucene',
  granularity: 'auto',
  implicitColumnExpression: 'Body',
  numberFormat: {
    output: 'number',
  },
  filters: [],
});

// TODO: DEPRECATED
export const makeExternalChart = (opts?: {
  id?: string;
  sourceId?: string;
}) => ({
  name: 'Test Chart',
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  series: [
    {
      type: 'time',
      sourceId: opts?.sourceId ?? '68dd82484f54641b08667897',
      aggFn: 'count',
      where: '',
      groupBy: [],
    },
  ],
});

export const makeExternalTile = (opts?: {
  sourceId?: string;
}): ExternalDashboardTile => ({
  name: 'Test Chart',
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  config: {
    displayType: 'line',
    sourceId: opts?.sourceId ?? '68dd82484f54641b08667897',
    select: [
      {
        aggFn: 'count',
        where: '',
      },
    ],
  },
});

export const makeRawSqlTile = (opts?: {
  id?: string;
  displayType?: DisplayType;
  sqlTemplate?: string;
  connectionId?: string;
}): Tile => ({
  id: opts?.id ?? randomMongoId(),
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  config: {
    configType: 'sql',
    displayType: opts?.displayType ?? DisplayType.Line,
    sqlTemplate: opts?.sqlTemplate ?? 'SELECT 1',
    connection: opts?.connectionId ?? 'test-connection',
  } satisfies RawSqlSavedChartConfig,
});
