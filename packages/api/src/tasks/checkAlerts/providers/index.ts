import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { Tile } from '@hyperdx/common-utils/dist/types';
import _ from 'lodash';

import { ObjectId } from '@/models';
import { IAlert } from '@/models/alert';
import { IAlertHistory } from '@/models/alertHistory';
import { IConnection } from '@/models/connection';
import { IDashboard } from '@/models/dashboard';
import { ISavedSearch } from '@/models/savedSearch';
import { ISource } from '@/models/source';
import { IWebhook } from '@/models/webhook';
import DefaultAlertProvider from '@/tasks/checkAlerts/providers/default';
import logger from '@/utils/logger';

import { AggregatedAlertHistory } from '..';

export enum AlertTaskType {
  SAVED_SEARCH,
  TILE,
}

// Discriminated union of possible alert channel types with populated channel data
export type PopulatedAlertChannel = { type: 'webhook' } & { channel: IWebhook };

// Details about the alert and the source for the alert. Depending on
// the taskType either:
//   1. the savedSearch field is required or
//   2. the tile and dashboard field are required
//
// The dependent typing means less null checks when using these values as
// the are required when the type is set accordingly.
export type AlertDetails = {
  alert: IAlert;
  source: ISource;
  previous: AggregatedAlertHistory | undefined;
  previousMap: Map<string, AggregatedAlertHistory>; // Map of alertId:group -> history for group-by alerts
} & (
  | {
      taskType: AlertTaskType.SAVED_SEARCH;
      savedSearch: Omit<ISavedSearch, 'source'>;
    }
  | {
      taskType: AlertTaskType.TILE;
      tile: Tile;
      dashboard: IDashboard;
    }
);

// AlertTask instances can carry metadata, of type T, for the provider that created
// them. The `metadata` field is only valid when T is defined to be a legal type.
export type AlertTask<T = never> = {
  alerts: AlertDetails[];
  conn: IConnection;
  now: Date;
} & ([T] extends [never] ? unknown : { metadata: T });

export interface AlertProvider {
  init(): Promise<void>;

  asyncDispose(): Promise<void>;

  getAlertTasks(): Promise<AlertTask[]>;

  buildLogSearchLink(params: {
    endTime: Date;
    savedSearch: ISavedSearch;
    startTime: Date;
  }): string;

  buildChartLink(params: {
    dashboardId: string;
    endTime: Date;
    granularity: string;
    startTime: Date;
  }): string;

  /** Save the given AlertHistory and update the associated alert's state */
  updateAlertState(alertHistory: IAlertHistory): Promise<void>;

  /** Fetch all webhooks for the given team, returning a map of webhook ID to webhook */
  getWebhooks(teamId: string | ObjectId): Promise<Map<string, IWebhook>>;

  /** Create and return an authenticated ClickHouse client */
  getClickHouseClient(
    connection: IConnection,
    requestTimeout?: number,
  ): Promise<ClickhouseClient>;
}

const ADDITIONAL_PROVIDERS: Record<string, () => AlertProvider> = {
  // Additional alert provider create functions should appear in this object
  // defined with a provider name.
};

export async function loadProvider(
  providerName?: string | undefined | null,
): Promise<AlertProvider> {
  if (providerName && providerName !== 'default') {
    const providerFn = _.get(ADDITIONAL_PROVIDERS, providerName);
    if (providerFn) {
      try {
        return providerFn();
      } catch (err) {
        logger.error(
          {
            cause: err,
            providerName,
          },
          `error creating instance of ${providerName} provider; using default`,
        );
      }
    }
  }

  return new DefaultAlertProvider();
}
