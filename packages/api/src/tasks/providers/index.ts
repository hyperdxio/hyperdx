import { Tile } from '@hyperdx/common-utils/dist/types';

import { IAlert } from '@/models/alert';
import { IConnection } from '@/models/connection';
import { IDashboard } from '@/models/dashboard';
import { ISavedSearch } from '@/models/savedSearch';
import { ISource } from '@/models/source';
import DefaultAlertProvider from '@/tasks/providers/default';

export enum AlertTaskType {
  SAVED_SEARCH,
  TILE,
}

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
}

export function isValidProvider(obj: any): obj is AlertProvider {
  return (
    obj != null &&
    typeof obj.init === 'function' &&
    typeof obj.asyncDispose === 'function' &&
    typeof obj.getAlertTasks === 'function' &&
    typeof obj.buildLogSearchLink === 'function' &&
    typeof obj.buildChartLink === 'function'
  );
}

export async function loadProvider(
  providerName?: string | undefined | null,
): Promise<AlertProvider> {
  if (providerName && providerName !== 'default') {
    try {
      const ProviderClass = (await import(`./${providerName}`)).default;
      if (typeof ProviderClass === 'function') {
        const providerInstance = new ProviderClass();
        if (isValidProvider(providerInstance)) {
          return providerInstance;
        } else {
          console.warn(`"${providerName}" does not implement AlertProvider`);
        }
      } else {
        console.warn(`"${providerName}" does not export default constructor`);
      }
    } catch (e) {
      console.warn(`failed to load "${providerName}: ${e}"`);
    }
  }

  return new DefaultAlertProvider();
}
