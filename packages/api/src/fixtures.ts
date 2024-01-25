import mongoose from 'mongoose';
import request from 'supertest';
import { z } from 'zod';

import * as clickhouse from '@/clickhouse';
import {
  LogsPropertyTypeMappingsModel,
  MetricsPropertyTypeMappingsModel,
} from '@/clickhouse/propertyTypeMappingsModel';
import {
  LogPlatform,
  LogStreamModel,
  LogType,
  MetricModel,
} from '@/utils/logParser';
import { redisClient } from '@/utils/redis';

import * as config from './config';
import { getTeam } from './controllers/team';
import { findUserByEmail } from './controllers/user';
import { mongooseConnection } from './models';
import Server from './server';
import { externalAlertSchema } from './utils/zod';

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

  // Populate fake persistent data here...
};

class MockServer extends Server {
  getHttpServer() {
    return this.httpServer;
  }

  async start(): Promise<void> {
    if (!config.IS_CI) {
      throw new Error('ONLY execute this in CI env 😈 !!!');
    }
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

class MockAPIServer extends MockServer {
  protected readonly appType = 'api';
}

class MockAggregatorServer extends MockServer {
  protected readonly appType = 'aggregator';
}

export const getServer = (appType: 'api' | 'aggregator' = 'api') => {
  switch (appType) {
    case 'api':
      return new MockAPIServer();
    case 'aggregator':
      return new MockAggregatorServer();
    default:
      throw new Error(`Invalid app type: ${appType}`);
  }
};

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

// ------------------------------------------------
// ------------------ Redis -----------------------
// ------------------------------------------------
export const clearRedis = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  await redisClient.flushAll();
};

// ------------------------------------------------
// ------------------ Clickhouse ------------------
// ------------------------------------------------
export const clearClickhouseTables = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  const promises: any[] = [];
  for (const table of Object.values(clickhouse.TableName)) {
    promises.push(
      clickhouse.client.command({
        query: `TRUNCATE TABLE default.${table}`,
        clickhouse_settings: {
          wait_end_of_query: 1,
        },
      }),
    );
  }
  await Promise.all(promises);
};

export function buildEvent({
  level,
  source = 'test',
  timestamp,
  platform = LogPlatform.NodeJS,
  type = LogType.Log,
  end_timestamp = 0,
  span_name,
  service = 'test-service',
  ...properties
}: {
  level?: string;
  source?: string;
  timestamp?: number; // ms timestamp
  platform?: LogPlatform;
  type?: LogType;
  end_timestamp?: number; //ms timestamp
  span_name?: string;
  service?: string;
} & {
  [key: string]: number | string | boolean;
}): LogStreamModel {
  const ts = timestamp ?? Date.now();

  const boolNames: string[] = [];
  const boolValues: number[] = [];
  const numberNames: string[] = [];
  const numberValues: number[] = [];
  const stringNames: string[] = [];
  const stringValues: string[] = [];

  Object.entries(properties).forEach(([key, value]) => {
    if (typeof value === 'boolean') {
      boolNames.push(key);
      boolValues.push(value ? 1 : 0);
    } else if (typeof value === 'number') {
      numberNames.push(key);
      numberValues.push(value);
    } else if (typeof value === 'string') {
      stringNames.push(key);
      stringValues.push(value);
    }
  });

  return {
    // TODO: Fix Timestamp Types
    // @ts-ignore
    timestamp: `${ts}000000`,
    // @ts-ignore
    observed_timestamp: `${ts}000000`,
    _source: source,
    _platform: platform,
    _service: service,
    severity_text: level,
    // @ts-ignore
    end_timestamp: `${end_timestamp}000000`,
    type,
    span_name,
    'bool.names': boolNames,
    'bool.values': boolValues,
    'number.names': numberNames,
    'number.values': numberValues,
    'string.names': stringNames,
    'string.values': stringValues,
  };
}

export function buildMetricSeries({
  tags,
  name,
  points,
  data_type,
  is_delta,
  is_monotonic,
  unit,
}: {
  tags: Record<string, string>;
  name: string;
  points: { value: number; timestamp: number; le?: string }[];
  data_type: clickhouse.MetricsDataType;
  is_monotonic: boolean;
  is_delta: boolean;
  unit: string;
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
  }));
}

export function mockLogsPropertyTypeMappingsModel(propertyMap: {
  [property: string]: 'bool' | 'number' | 'string';
}) {
  const propertyTypesMappingsModel = new LogsPropertyTypeMappingsModel(
    1,
    'fake team id',
    () => Promise.resolve({}),
  );
  jest
    .spyOn(propertyTypesMappingsModel, 'get')
    .mockImplementation((property: string) => {
      // eslint-disable-next-line security/detect-object-injection
      return propertyMap[property];
    });

  jest
    .spyOn(clickhouse, 'buildLogsPropertyTypeMappingsModel')
    .mockImplementation(() => Promise.resolve(propertyTypesMappingsModel));

  return propertyTypesMappingsModel;
}

export function mockSpyMetricPropertyTypeMappingsModel(propertyMap: {
  [property: string]: 'bool' | 'number' | 'string';
}) {
  const model = new MetricsPropertyTypeMappingsModel(1, 'fake');

  jest.spyOn(model, 'get').mockImplementation((property: string) => {
    // eslint-disable-next-line security/detect-object-injection
    return propertyMap[property];
  });

  jest
    .spyOn(clickhouse, 'buildMetricsPropertyTypeMappingsModel')
    .mockImplementation(() => Promise.resolve(model));

  return model;
}

const randomId = () => Math.random().toString(36).substring(7);

export const makeChart = (opts?: { id?: string }) => ({
  id: opts?.id ?? randomId(),
  name: 'Test Chart',
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  series: [
    {
      type: 'time',
      table: 'metrics',
    },
  ],
});

export const makeExternalChart = (opts?: { id?: string }) => ({
  name: 'Test Chart',
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  series: [
    {
      type: 'time',
      dataSource: 'events',
      aggFn: 'count',
    },
  ],
});

export const makeAlert = ({
  dashboardId,
  chartId,
}: {
  dashboardId: string;
  chartId: string;
}) => ({
  channel: {
    type: 'webhook',
    webhookId: 'test-webhook-id',
  },
  interval: '15m',
  threshold: 8,
  type: 'presence',
  source: 'CHART',
  dashboardId,
  chartId,
});

export const makeExternalAlert = ({
  dashboardId,
  chartId,
  threshold = 8,
  interval = '15m',
}: {
  dashboardId: string;
  chartId: string;
  threshold?: number;
  interval?: '15m' | '1m' | '5m' | '30m' | '1h' | '6h' | '12h' | '1d';
}): z.infer<typeof externalAlertSchema> => ({
  channel: {
    type: 'slack_webhook',
    webhookId: '65ad876b6b08426ab4ba7830',
  },
  interval,
  threshold,
  threshold_type: 'above',
  source: 'chart',
  dashboardId,
  chartId,
});
