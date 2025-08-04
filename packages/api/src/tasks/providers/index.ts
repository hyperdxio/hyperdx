import { AlertDocument } from '@/models/alert';
import { ISavedSearch } from '@/models/savedSearch';

import DefaultAlertProvider from './default';

export type AlertTask = {
  alerts: AlertDocument[];
};

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

function isValidProvider(obj: any): obj is AlertProvider {
  return (
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
        }
      }
    } catch {
      /* will be caught falling through to the default return */
    }
  }

  console.warn(`load "${providerName}" failed, using default alert provider`);
  return new DefaultAlertProvider();
}
