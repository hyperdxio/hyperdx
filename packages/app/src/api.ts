import Router from 'next/router';
import type { HTTPError, Options, ResponsePromise } from 'ky';
import ky from 'ky-universal';
import type { UseQueryOptions } from 'react-query';
import { useInfiniteQuery, useMutation, useQuery } from 'react-query';

import { SERVER_URL } from './config';
import type {
  AlertChannel,
  AlertInterval,
  AlertSource,
  AlertType,
  ChartSeries,
  Dashboard,
  LogView,
  MetricsDataType,
  Session,
} from './types';

type ApiAlertInput = {
  channel: AlertChannel;
  interval: AlertInterval;
  threshold: number;
  type: AlertType;
  source: AlertSource;
  groupBy?: string;
  logViewId?: string;
  dashboardId?: string;
  chartId?: string;
};

type ApiAlertAckInput = {
  alertId: string;
  mutedUntil: Date;
};

type ServicesResponse = {
  data: Record<
    string,
    Array<{
      'k8s.namespace.name'?: string;
      'k8s.pod.name'?: string;
      'k8s.pod.uid'?: string;
    }>
  >;
};

function loginHook(request: Request, options: any, response: Response) {
  // marketing pages
  const WHITELIST_PATHS = [
    '/',
    '/forgot',
    '/join-team',
    '/login',
    '/register',
    '/reset-password',
  ];
  if (!WHITELIST_PATHS.includes(Router.pathname) && response.status === 401) {
    try {
      window.sessionStorage.setItem('hdx-login-redirect-url', Router.asPath);
    } catch (e: any) {
      console.error(e);
    }
    Router.push('/login');
  }
}

export const apiConfigs = {
  prefixUrl: SERVER_URL,
};

export const server = ky.create({
  prefixUrl: SERVER_URL,
  credentials: 'include',
  hooks: {
    afterResponse: [loginHook],
  },
  timeout: false,
});

const hdxServer = (
  url: string,
  options?: Options | undefined,
): ResponsePromise => {
  return server(url, {
    ...apiConfigs,
    ...options,
  });
};

const api = {
  usePropertyTypeMappings(options?: UseQueryOptions<any, Error>) {
    return useQuery<Map<string, 'string' | 'number' | 'bool'>, Error>(
      `logs/propertyTypeMappings`,
      () =>
        hdxServer(`logs/propertyTypeMappings`, {
          method: 'GET',
        })
          .json<{ data: any[] }>()
          .then(res => new Map(res.data)),
      {
        staleTime: 1000 * 60 * 5, // Cache every 5 min
        ...options,
      },
    );
  },
  useMetricsNames() {
    return useQuery<
      {
        data: {
          data_type: string;
          is_delta: boolean;
          is_monotonic: boolean;
          name: string;
          unit: string;
        }[];
      },
      Error
    >({
      refetchOnWindowFocus: false,
      queryKey: ['metrics/names'],
      queryFn: () =>
        hdxServer('metrics/names', {
          method: 'GET',
        }).json(),
    });
  },
  useMetricsTags(
    metrics: {
      name: string;
      dataType: MetricsDataType;
    }[],
  ) {
    return useQuery<
      {
        data: {
          name: string;
          data_type: string;
          tags: Record<string, string>[];
        }[];
      },
      Error
    >({
      refetchOnWindowFocus: false,
      queryKey: ['metrics/tags', metrics],
      queryFn: () =>
        hdxServer('metrics/tags', {
          method: 'POST',
          json: {
            metrics,
          },
        }).json(),
    });
  },
  useMetricsChart(
    {
      aggFn,
      endDate,
      granularity,
      name,
      q,
      startDate,
      groupBy,
    }: {
      aggFn: string;
      endDate: Date;
      granularity: string | undefined;
      name: string; // WARN: name consists of metric name and type
      q: string;
      startDate: Date;
      groupBy: string;
    },
    options?: UseQueryOptions<any, Error>,
  ) {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();

    // FIXME: pass metric name and type separately
    const [metricName, metricDataType] = name.split(' - ');

    return useQuery<any, Error>({
      refetchOnWindowFocus: false,
      queryKey: [
        'metrics/chart',
        name,
        aggFn,
        endTime,
        granularity,
        startTime,
        q,
        groupBy,
      ],
      queryFn: () =>
        hdxServer('metrics/chart', {
          method: 'POST',
          json: {
            aggFn,
            endTime,
            granularity,
            groupBy,
            name: metricName,
            q,
            startTime,
            type: metricDataType,
          },
        }).json(),
      ...options,
    });
  },
  useMultiSeriesChart(
    {
      startDate,
      series,
      sortOrder,
      granularity,
      endDate,
      seriesReturnType,
      postGroupWhere,
    }: {
      series: ChartSeries[];
      endDate: Date;
      granularity?: string;
      startDate: Date;
      sortOrder?: 'asc' | 'desc';
      seriesReturnType: 'column' | 'ratio';
      postGroupWhere?: string;
    },
    options?: UseQueryOptions<any, Error>,
  ) {
    const enrichedSeries = series.map(s => {
      if (s.type != 'search' && s.type != 'markdown' && s.table === 'metrics') {
        const [metricName, metricDataType] = (s.field ?? '').split(' - ');
        return {
          ...s,
          field: metricName,
          metricDataType,
        };
      }

      return s;
    });
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    return useQuery<
      {
        data: {
          ts_bucket: string;
          group: string[];
          [dataKey: `series_${number}.data`]: number;
        }[];
      },
      Error
    >({
      refetchOnWindowFocus: false,
      queryKey: [
        'chart/series',
        enrichedSeries,
        endTime,
        granularity,
        startTime,
        sortOrder,
        seriesReturnType,
        postGroupWhere,
      ],
      queryFn: () =>
        hdxServer('chart/series', {
          method: 'POST',
          json: {
            series: enrichedSeries,
            endTime,
            startTime,
            granularity,
            sortOrder,
            seriesReturnType,
            postGroupWhere,
          },
        }).json(),
      retry: 1,
      ...options,
    });
  },
  useSpanPerformanceChart(
    {
      endDate,
      parentSpanWhere,
      childrenSpanWhere,
      startDate,
    }: {
      endDate: Date;
      parentSpanWhere: string;
      childrenSpanWhere: string;
      startDate: Date;
    },
    options?: UseQueryOptions<any, Error>,
  ) {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    return useQuery<
      {
        data: {
          ts_bucket: string;
          group: string[];
          [dataKey: `series_${number}.data`]: number;
        }[];
      },
      Error
    >({
      refetchOnWindowFocus: false,
      queryKey: [
        'logs/chart/spanPerformance',
        startTime,
        endTime,
        parentSpanWhere,
        childrenSpanWhere,
      ],
      queryFn: () =>
        hdxServer('logs/chart/spanPerformance', {
          method: 'POST',
          json: {
            startTime,
            endTime,
            parentSpanWhere,
            childrenSpanWhere,
          },
        }).json(),
      retry: 1,
      ...options,
    });
  },
  useLogsChart(
    {
      aggFn,
      endDate,
      field,
      granularity,
      groupBy,
      q,
      startDate,
      sortOrder,
    }: {
      aggFn: string;
      endDate: Date;
      field: string;
      granularity: string | undefined;
      groupBy: string;
      q: string;
      startDate: Date;
      sortOrder?: 'asc' | 'desc';
    },
    options?: UseQueryOptions<any, Error>,
  ) {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    return useQuery<any, Error>({
      refetchOnWindowFocus: false,
      queryKey: [
        'logs/chart',
        aggFn,
        endTime,
        field,
        granularity,
        groupBy,
        q,
        startTime,
        sortOrder,
      ],
      queryFn: () =>
        hdxServer('logs/chart', {
          method: 'GET',
          searchParams: [
            ['aggFn', aggFn],
            ['endTime', endTime],
            ['field', field ?? ''],
            ...(granularity != null ? [['granularity', granularity]] : []),
            ['groupBy', groupBy ?? ''],
            ['q', q],
            ['startTime', startTime],
            ...(sortOrder != null ? [['sortOrder', sortOrder]] : []),
          ],
        }).json(),
      retry: 1,
      ...options,
    });
  },
  useLogsChartHistogram(
    {
      endDate,
      field,
      q,
      startDate,
    }: {
      endDate: Date;
      field: string;
      q: string;
      startDate: Date;
    },
    options?: UseQueryOptions<any, Error>,
  ) {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    return useQuery<any, Error>({
      refetchOnWindowFocus: false,
      queryKey: ['logs/chart/histogram', endTime, field, q, startTime],
      queryFn: () =>
        hdxServer('logs/chart/histogram', {
          method: 'GET',
          searchParams: [
            ['endTime', endTime],
            ['field', field ?? ''],
            ['q', q],
            ['startTime', startTime],
          ],
        }).json(),
      retry: 1,
      ...options,
    });
  },
  useLogBatch(
    {
      q,
      startDate,
      endDate,
      extraFields,
      order,
      limit = 100,
    }: {
      q: string;
      startDate: Date;
      endDate: Date;
      extraFields: string[];
      order: 'asc' | 'desc' | null;
      limit?: number;
    },
    options?: UseQueryOptions<any, Error>,
  ) {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    return useInfiniteQuery<{ data: any[] }, Error>({
      queryKey: ['logs', q, startTime, endTime, extraFields, order, limit],
      queryFn: async ({ pageParam = 0 }) =>
        hdxServer('logs', {
          method: 'GET',
          searchParams: [
            ['endTime', endTime],
            ['offset', pageParam],
            ['q', q],
            ['startTime', startTime],
            ['order', order],
            ['limit', limit],
            ...extraFields.map(field => ['extraFields[]', field]),
          ],
        }).json(),
      ...options,
    });
  },
  useLogPatterns(
    {
      q,
      startDate,
      endDate,
      sampleRate,
    }: {
      q: string;
      startDate: Date;
      endDate: Date;
      sampleRate: number;
    },
    options?: UseQueryOptions<any, Error>,
  ) {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    return useQuery<{ data: any[] }, Error>({
      queryKey: ['logs', 'patterns', q, startTime, endTime],
      queryFn: async () =>
        hdxServer('logs/patterns', {
          method: 'GET',
          searchParams: [
            ['endTime', endTime],
            ['q', q],
            ['startTime', startTime],
            ['sampleRate', sampleRate],
          ],
        }).json(),
      ...options,
    });
  },
  useSessions({
    endDate,
    startDate,
    q,
  }: {
    endDate: Date;
    startDate: Date;
    q: string;
  }) {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    return useQuery<{ data: Session[] }, Error>({
      refetchOnWindowFocus: false,
      queryKey: [startTime, endTime, q],
      queryFn: () =>
        hdxServer('sessions', {
          method: 'GET',
          searchParams: [
            ['endTime', endTime],
            ['q', q],
            ['startTime', startTime],
          ],
        }).json(),
    });
  },
  useLogViews() {
    return useQuery<{ data: LogView[] }, Error>({
      queryKey: ['log-views'],
      queryFn: () => hdxServer('log-views', { method: 'GET' }).json(),
    });
  },
  useDeleteLogView() {
    return useMutation<any, Error, string>(
      `log-views`,
      async (logViewId: string) =>
        hdxServer(`log-views/${logViewId}`, {
          method: 'DELETE',
        }),
    );
  },
  useSaveLogView() {
    return useMutation<
      any,
      Error,
      {
        name: string;
        query: string;
        tags?: string;
      }
    >(`log-views`, async ({ name, query, tags }) =>
      hdxServer('log-views', {
        method: 'POST',
        json: {
          query,
          name,
          tags,
        },
      }).json(),
    );
  },
  useUpdateLogView() {
    return useMutation<
      any,
      Error,
      {
        id: string;
        query?: string;
        tags?: string[];
      }
    >(`log-views`, async ({ id, query, tags }) =>
      hdxServer(`log-views/${id}`, {
        method: 'PATCH',
        json: {
          query,
          tags,
        },
      }).json(),
    );
  },
  useAlerts() {
    return useQuery<any, Error>(`alerts`, () =>
      hdxServer(`alerts`, { method: 'GET' }).json(),
    );
  },
  useSaveAlert() {
    return useMutation<any, Error, ApiAlertInput>(`alerts`, async alert =>
      hdxServer('alerts', {
        method: 'POST',
        json: alert,
      }).json(),
    );
  },
  useUpdateAlert() {
    return useMutation<any, Error, { id: string } & ApiAlertInput>(
      `alerts`,
      async alert =>
        hdxServer(`alerts/${alert.id}`, {
          method: 'PUT',
          json: alert,
        }).json(),
    );
  },
  useDeleteAlert() {
    return useMutation<any, Error, string>(`alerts`, async (alertId: string) =>
      hdxServer(`alerts/${alertId}`, {
        method: 'DELETE',
      }),
    );
  },
  useSilenceAlert() {
    return useMutation<any, Error, ApiAlertAckInput>('alerts', async alertAck =>
      hdxServer(`alerts/${alertAck.alertId}/silenced`, {
        method: 'POST',
        json: alertAck,
      }),
    );
  },
  useUnsilenceAlert() {
    return useMutation<any, Error, string>(`alerts`, async (alertId: string) =>
      hdxServer(`alerts/${alertId}/silenced`, {
        method: 'DELETE',
      }),
    );
  },
  useLogHistogram(
    q: string,
    startDate: Date,
    endDate: Date,
    options?: UseQueryOptions<any, Error>,
  ) {
    const st = startDate.getTime();
    const et = endDate.getTime();
    return useQuery<any, Error>({
      queryKey: ['logs/histogram', q, st, et],
      queryFn: () =>
        hdxServer('logs/histogram', {
          method: 'GET',
          searchParams: [
            ['q', q],
            ['startTime', st],
            ['endTime', et],
          ],
        }).json(),
      ...options,
    });
  },
  useDashboards(options?: UseQueryOptions<any, Error>) {
    return useQuery<{ data: Dashboard[] }, Error>(
      `dashboards`,
      () => hdxServer(`dashboards`, { method: 'GET' }).json(),
      options,
    );
  },
  useCreateDashboard() {
    return useMutation<
      any,
      HTTPError,
      { name: string; query: string; charts: any[]; tags?: string[] }
    >(async ({ name, charts, query, tags }) =>
      hdxServer(`dashboards`, {
        method: 'POST',
        json: { name, charts, query, tags },
      }).json(),
    );
  },
  useUpdateDashboard() {
    return useMutation<
      any,
      HTTPError,
      {
        id: string;
        name?: string;
        query?: string;
        charts?: any[];
        tags?: string[];
      }
    >(async ({ id, name, charts, query, tags }) =>
      hdxServer(`dashboards/${id}`, {
        method: 'PUT',
        json: { name, charts, query, tags },
      }).json(),
    );
  },
  useDeleteDashboard() {
    return useMutation<any, HTTPError, { id: string }>(async ({ id }) =>
      hdxServer(`dashboards/${id}`, {
        method: 'DELETE',
      }).json(),
    );
  },
  useServices() {
    return useQuery<ServicesResponse, Error>(
      `services`,
      () =>
        hdxServer(`chart/services`, {
          method: 'GET',
        }).json() as Promise<ServicesResponse>,
    );
  },
  useLogDetails(
    logId: string,
    sortKey: string,
    options?: UseQueryOptions<any, Error>,
  ) {
    return useQuery<any, Error>(
      `logs/${logId}`,
      () =>
        hdxServer(`logs/${logId}?sortKey=${sortKey}`, { method: 'GET' }).json(),
      {
        staleTime: 1000 * 60 * 5, // 5 min
        ...options,
      },
    );
  },
  useRotateTeamApiKey() {
    return useMutation<any, HTTPError>(async () =>
      hdxServer(`team/apiKey`, {
        method: 'PATCH',
      }).json(),
    );
  },
  useDeleteTeamMember() {
    return useMutation<any, HTTPError, { userId: string }>(async ({ userId }) =>
      server(`team/users/${userId}`, {
        method: 'DELETE',
      }).json(),
    );
  },
  useDeleteTeamInvite() {
    return useMutation<any, HTTPError, { id: string }>(async ({ id }) =>
      server(`team/teamInvites/${id}`, {
        method: 'DELETE',
      }).json(),
    );
  },
  useSaveTeamInvitation() {
    return useMutation<any, HTTPError, { name?: string; email: string }>(
      async ({ name, email }) =>
        hdxServer(`team/invitation`, {
          method: 'POST',
          json: {
            name,
            email,
          },
        }).json(),
    );
  },
  useInstallation() {
    return useQuery<any, HTTPError>(`installation`, () =>
      hdxServer(`installation`).json(),
    );
  },
  useMe() {
    return useQuery<any, HTTPError>(`me`, () => hdxServer(`me`).json());
  },
  useTeam() {
    return useQuery<any, HTTPError>(`team`, () => hdxServer(`team`).json(), {
      retry: 1,
    });
  },
  useTeamInvitations() {
    return useQuery<any, HTTPError>(`team/invitations`, () =>
      hdxServer(`team/invitations`).json(),
    );
  },
  useTeamMembers() {
    return useQuery<any, HTTPError>(`team/members`, () =>
      hdxServer(`team/members`).json(),
    );
  },
  useTags() {
    return useQuery<{ data: string[] }, HTTPError>(`team/tags`, () =>
      hdxServer(`team/tags`).json<{ data: string[] }>(),
    );
  },
  useSaveWebhook() {
    return useMutation<
      any,
      HTTPError,
      {
        service: string;
        url: string;
        name: string;
        description?: string;
        queryParams?: Map<string, string>;
        headers?: Map<string, string>;
        body?: string;
      }
    >(async ({ service, url, name, description, queryParams, headers, body }) =>
      hdxServer(`webhooks`, {
        method: 'POST',
        json: {
          name,
          service,
          url,
          description,
          queryParams,
          headers,
          body,
        },
      }).json(),
    );
  },
  useWebhooks(services: string[]) {
    return useQuery<any, Error>({
      queryKey: [...services],
      queryFn: () =>
        hdxServer('webhooks', {
          method: 'GET',
          searchParams: [...services.map(service => ['service', service])],
        }).json(),
    });
  },
  useDeleteWebhook() {
    return useMutation<any, HTTPError, { id: string }>(async ({ id }) =>
      hdxServer(`webhooks/${id}`, {
        method: 'DELETE',
      }).json(),
    );
  },
  useRegisterPassword() {
    return useMutation<
      any,
      HTTPError,
      { email: string; password: string; confirmPassword: string }
    >(async ({ email, password, confirmPassword }) =>
      hdxServer(`register/password`, {
        method: 'POST',
        json: {
          email,
          password,
          confirmPassword,
        },
      }).json(),
    );
  },
};
export default api;
