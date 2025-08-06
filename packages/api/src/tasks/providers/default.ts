import mongoose from 'mongoose';
import ms from 'ms';
import { URLSearchParams } from 'url';

import * as config from '@/config';
import { LOCAL_APP_TEAM } from '@/controllers/team';
import { connectDB, mongooseConnection } from '@/models';
import Alert from '@/models/alert';
import { ISavedSearch } from '@/models/savedSearch';
import { convertMsToGranularityString } from '@/utils/common';

import { AlertProvider, AlertTask } from './index';

export default class DefaultAlertProvider implements AlertProvider {
  async init() {
    await Promise.all([connectDB()]);
  }

  async asyncDispose() {
    await Promise.all([mongooseConnection.close()]);
  }

  async getAlertTasks(): Promise<AlertTask[]> {
    const alerts = await Alert.find({});
    if (config.IS_LOCAL_APP_MODE) {
      alerts.forEach(_alert => {
        // The id is the 12 character string `_local_team_', which will become an ObjectId
        // as the ASCII hex values, so 5f6c6f63616c5f7465616d5f.
        _alert.team = new mongoose.Types.ObjectId(LOCAL_APP_TEAM.id);
      });
    }

    return [{ alerts }];
  }

  buildLogSearchLink({
    endTime,
    savedSearch,
    startTime,
  }: {
    endTime: Date;
    savedSearch: ISavedSearch;
    startTime: Date;
  }): string {
    const url = new URL(`${config.FRONTEND_URL}/search/${savedSearch.id}`);
    const queryParams = new URLSearchParams({
      from: startTime.getTime().toString(),
      to: endTime.getTime().toString(),
      isLive: 'false',
    });
    url.search = queryParams.toString();
    return url.toString();
  }

  buildChartLink({
    dashboardId,
    endTime,
    granularity,
    startTime,
  }: {
    dashboardId: string;
    endTime: Date;
    granularity: string;
    startTime: Date;
  }): string {
    const url = new URL(`${config.FRONTEND_URL}/dashboards/${dashboardId}`);
    // extend both start and end time by 7x granularity
    const from = (startTime.getTime() - ms(granularity) * 7).toString();
    const to = (endTime.getTime() + ms(granularity) * 7).toString();
    const queryParams = new URLSearchParams({
      from,
      granularity: convertMsToGranularityString(ms(granularity)),
      to,
    });
    url.search = queryParams.toString();
    return url.toString();
  }
}
