import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import mongoose from 'mongoose';

import * as config from '@/config';
import { ObjectId } from '@/models';
import { AlertSource, AlertThresholdType, IAlert } from '@/models/alert';
import { ISource } from '@/models/source';
import { IWebhook } from '@/models/webhook';
import CheckAlertTask from '@/tasks/checkAlerts';
import * as checkAlerts from '@/tasks/checkAlerts';
import {
  AlertDetails,
  AlertProvider,
  AlertTaskType,
  loadProvider,
} from '@/tasks/providers';

import { CheckAlertsTaskArgs } from '../types';

jest.mock('@/tasks/providers', () => {
  return {
    ...jest.requireActual('@/tasks/providers'),
    loadProvider: jest.fn(),
  };
});

describe('CheckAlertTask', () => {
  describe('execute', () => {
    let mockAlertProvider: jest.Mocked<AlertProvider>;
    let mockProcessAlert: jest.SpyInstance;

    beforeEach(() => {
      jest.clearAllMocks();

      mockAlertProvider = {
        init: jest.fn(),
        getAlertTasks: jest.fn(),
        getWebhooks: jest.fn(),
        updateAlertState: jest.fn(),
        asyncDispose: jest.fn(),
        buildChartLink: jest.fn(),
        buildLogSearchLink: jest.fn(),
        getClickHouseClient: jest
          .fn()
          .mockResolvedValue({} as ClickhouseClient),
      };

      jest.mocked(loadProvider).mockResolvedValue(mockAlertProvider);

      mockProcessAlert = jest
        .spyOn(checkAlerts, 'processAlert')
        .mockResolvedValue(undefined);
    });

    afterEach(async () => {
      jest.clearAllMocks();
    });

    it('should throw error for invalid task name', async () => {
      const args = { taskName: 'invalid-task' } as any;
      const task = new CheckAlertTask(args);

      await expect(task.execute()).rejects.toThrow(
        `CheckAlertTask can only handle 'check-alerts' tasks, received: invalid-task`,
      );
    });

    it('should execute successfully with no alert tasks', async () => {
      const args: CheckAlertsTaskArgs = { taskName: 'check-alerts' };
      const task = new CheckAlertTask(args);

      mockAlertProvider.getAlertTasks.mockResolvedValue([]);
      mockAlertProvider.getWebhooks.mockResolvedValue(new Map());

      await task.execute();

      const mockLoadProvider = jest.mocked(loadProvider);
      expect(mockLoadProvider).toHaveBeenCalledWith(undefined);
      expect(mockAlertProvider.init).toHaveBeenCalled();
      expect(mockAlertProvider.getAlertTasks).toHaveBeenCalled();
      expect(mockAlertProvider.getWebhooks).not.toHaveBeenCalled();
      expect(mockProcessAlert).not.toHaveBeenCalled();
    });

    it('should execute successfully with custom provider', async () => {
      const args: CheckAlertsTaskArgs = {
        taskName: 'check-alerts',
        provider: 'custom-provider',
      };
      const task = new CheckAlertTask(args);

      mockAlertProvider.getAlertTasks.mockResolvedValue([]);
      mockAlertProvider.getWebhooks.mockResolvedValue(new Map());

      await task.execute();

      const mockLoadProvider = jest.mocked(loadProvider);
      expect(mockLoadProvider).toHaveBeenCalledWith('custom-provider');
      expect(mockAlertProvider.init).toHaveBeenCalled();
    });

    it('should process alert tasks', async () => {
      const args: CheckAlertsTaskArgs = { taskName: 'check-alerts' };
      const task = new CheckAlertTask(args);

      const mockAlert = {
        id: 'alert-123',
        team: { _id: new mongoose.Types.ObjectId() },
        source: AlertSource.SAVED_SEARCH,
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: { type: 'webhook', webhookId: 'webhook-123' },
      } as IAlert;

      const mockSource = {
        id: 'source-123',
        from: { databaseName: 'default', tableName: 'otel_logs' },
        timestampValueExpression: 'Timestamp',
      } as ISource;

      const mockAlertTask = {
        alerts: [
          {
            alert: mockAlert,
            source: mockSource,
            taskType: AlertTaskType.SAVED_SEARCH,
            previous: undefined,
          } as AlertDetails,
        ],
        conn: {
          id: 'conn-123',
          _id: new mongoose.Types.ObjectId(),
          host: config.CLICKHOUSE_HOST,
          username: config.CLICKHOUSE_USER,
          password: config.CLICKHOUSE_PASSWORD,
          name: '',
          team: new mongoose.Types.ObjectId(),
        },
        now: new Date(),
      };

      const teamWebhooksById = new Map<string, IWebhook>([
        [
          'webhook-123',
          {
            _id: 'webhook-123',
            url: 'http://example.com/webhook',
          } as unknown as IWebhook,
        ],
      ]);

      mockAlertProvider.getAlertTasks.mockResolvedValue([mockAlertTask]);
      mockAlertProvider.getWebhooks.mockResolvedValue(teamWebhooksById);
      mockAlertProvider.getClickHouseClient.mockResolvedValue(
        new ClickhouseClient({}),
      );

      await task.execute();

      expect(mockAlertProvider.getAlertTasks).toHaveBeenCalled();
      expect(mockProcessAlert).toHaveBeenCalledWith(
        mockAlertTask.now,
        mockAlertTask.alerts[0],
        expect.any(ClickhouseClient),
        'conn-123',
        mockAlertProvider,
        teamWebhooksById,
      );

      mockProcessAlert.mockRestore();
    });

    it("should ensure that the correct team's webhooks are passed to processAlert", async () => {
      const args: CheckAlertsTaskArgs = { taskName: 'check-alerts' };
      const task = new CheckAlertTask(args);

      // Create two teams
      const team1Id = new mongoose.Types.ObjectId();
      const team2Id = new mongoose.Types.ObjectId();

      const mockAlert1 = {
        id: 'alert-123',
        team: { _id: team1Id },
        source: AlertSource.SAVED_SEARCH,
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: { type: 'webhook', webhookId: 'webhook-team1' },
      } as IAlert;

      const mockAlert2 = {
        id: 'alert-456',
        team: { _id: team2Id },
        source: AlertSource.SAVED_SEARCH,
        threshold: 5,
        thresholdType: AlertThresholdType.BELOW,
        interval: '1m',
        channel: { type: 'webhook', webhookId: 'webhook-team2' },
      } as IAlert;

      const mockSource = {
        id: 'source-123',
        from: { databaseName: 'default', tableName: 'otel_logs' },
        timestampValueExpression: 'Timestamp',
      } as ISource;

      const mockAlertTask1 = {
        alerts: [
          {
            alert: mockAlert1,
            source: mockSource,
            taskType: AlertTaskType.SAVED_SEARCH,
            previous: undefined,
          } as AlertDetails,
        ],
        conn: {
          id: 'conn-123',
          _id: new mongoose.Types.ObjectId(),
          host: config.CLICKHOUSE_HOST,
          username: config.CLICKHOUSE_USER,
          password: config.CLICKHOUSE_PASSWORD,
          name: 'Team1 Connection',
          team: team1Id,
        },
        now: new Date(),
      };

      const mockAlertTask2 = {
        alerts: [
          {
            alert: mockAlert2,
            source: mockSource,
            taskType: AlertTaskType.SAVED_SEARCH,
            previous: undefined,
          } as AlertDetails,
        ],
        conn: {
          id: 'conn-456',
          _id: new mongoose.Types.ObjectId(),
          host: config.CLICKHOUSE_HOST,
          username: config.CLICKHOUSE_USER,
          password: config.CLICKHOUSE_PASSWORD,
          name: 'Team2 Connection',
          team: team2Id,
        },
        now: new Date(),
      };

      // Create team-specific webhooks
      const team1WebhooksById = new Map<string, IWebhook>([
        [
          'webhook-team1',
          {
            _id: 'webhook-team1',
            name: 'Team1 Webhook',
            url: 'http://team1.example.com/webhook',
            team: team1Id,
          } as unknown as IWebhook,
        ],
      ]);

      const team2WebhooksById = new Map<string, IWebhook>([
        [
          'webhook-team2',
          {
            _id: 'webhook-team2',
            name: 'Team2 Webhook',
            url: 'http://team2.example.com/webhook',
            team: team2Id,
          } as unknown as IWebhook,
        ],
      ]);

      mockAlertProvider.getAlertTasks.mockResolvedValue([
        mockAlertTask1,
        mockAlertTask2,
      ]);

      mockAlertProvider.getClickHouseClient.mockResolvedValue(
        new ClickhouseClient({}),
      );

      // Mock getWebhooks to return team-specific webhooks
      mockAlertProvider.getWebhooks.mockImplementation(
        (teamId: string | ObjectId): Promise<Map<string, IWebhook>> => {
          if (teamId === team1Id.toString()) {
            return Promise.resolve(team1WebhooksById);
          } else if (teamId === team2Id.toString()) {
            return Promise.resolve(team2WebhooksById);
          }
          return Promise.resolve(new Map());
        },
      );

      await task.execute();

      // Verify processAlert was called twice with correct team-specific webhooks
      expect(mockProcessAlert).toHaveBeenCalledTimes(2);

      // First call should use team1's webhooks
      expect(mockProcessAlert).toHaveBeenNthCalledWith(
        1,
        mockAlertTask1.now,
        mockAlertTask1.alerts[0],
        expect.any(ClickhouseClient),
        'conn-123',
        mockAlertProvider,
        team1WebhooksById,
      );

      // Second call should use team2's webhooks
      expect(mockProcessAlert).toHaveBeenNthCalledWith(
        2,
        mockAlertTask2.now,
        mockAlertTask2.alerts[0],
        expect.any(ClickhouseClient),
        'conn-456',
        mockAlertProvider,
        team2WebhooksById,
      );

      // Verify getWebhooks was called for each team
      expect(mockAlertProvider.getWebhooks).toHaveBeenCalledWith(
        team1Id.toString(),
      );
      expect(mockAlertProvider.getWebhooks).toHaveBeenCalledWith(
        team2Id.toString(),
      );
    });
  });
});
