import Router from 'next/router';
import type { HTTPError } from 'ky';
import ky from 'ky-universal';
import type { UseQueryOptions } from 'react-query';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from 'react-query';

import { API_SERVER_URL } from './config';
import type {
  AlertChannel,
  AlertInterval,
  AlertSource,
  AlertType,
  ChartSeries,
  LogView,
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

export const server = ky.create({
  prefixUrl: API_SERVER_URL,
  credentials: 'include',
  hooks: {
    afterResponse: [loginHook],
  },
  timeout: false,
});

const api = {
  usePropertyTypeMappings(options?: UseQueryOptions<any, Error>) {
    return useQuery<Map<string, 'string' | 'number' | 'bool'>, Error>(
      `logs/propertyTypeMappings`,
      () =>
        server(`logs/propertyTypeMappings`, {
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
  useMetricsTags() {
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
      queryKey: ['metrics/tags'],
      queryFn: () =>
        server('metrics/tags', {
          method: 'GET',
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
        server('metrics/chart', {
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
    }: {
      series: ChartSeries[];
      endDate: Date;
      granularity?: string;
      startDate: Date;
      sortOrder?: 'asc' | 'desc';
      seriesReturnType: 'column' | 'ratio';
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
    return useQuery<any, Error>({
      refetchOnWindowFocus: false,
      queryKey: [
        'chart/series',
        enrichedSeries,
        endTime,
        granularity,
        startTime,
        sortOrder,
        seriesReturnType,
      ],
      queryFn: () =>
        server('chart/series', {
          method: 'POST',
          json: {
            series: enrichedSeries,
            endTime,
            startTime,
            granularity,
            sortOrder,
            seriesReturnType,
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
        server('logs/chart', {
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
        server('logs/chart/histogram', {
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
        server('logs', {
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
        server('logs/patterns', {
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
        server('sessions', {
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
      queryFn: () => server.get('log-views').json(),
    });
  },
  useDeleteLogView() {
    return useMutation<any, Error, string>(
      `log-views`,
      async (logViewId: string) =>
        server(`log-views/${logViewId}`, {
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
      }
    >(`log-views`, async ({ name, query }) =>
      server('log-views', {
        method: 'POST',
        json: {
          query,
          name,
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
        query: string;
      }
    >(`log-views`, async ({ id, query }) =>
      server(`log-views/${id}`, {
        method: 'PATCH',
        json: {
          query,
        },
      }).json(),
    );
  },
  useAlerts() {
    return useQuery<any, Error>(`alerts`, () => server.get(`alerts`).json());
  },
  useSaveAlert() {
    return useMutation<any, Error, ApiAlertInput>(`alerts`, async alert =>
      server('alerts', {
        method: 'POST',
        json: alert,
      }).json(),
    );
  },
  useUpdateAlert() {
    return useMutation<any, Error, { id: string } & ApiAlertInput>(
      `alerts`,
      async alert =>
        server(`alerts/${alert.id}`, {
          method: 'PUT',
          json: alert,
        }).json(),
    );
  },
  useDeleteAlert() {
    return useMutation<any, Error, string>(`alerts`, async (alertId: string) =>
      server(`alerts/${alertId}`, {
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
        server('logs/histogram', {
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
    return useQuery<any, Error>(
      `dashboards`,
      () => server.get(`dashboards`).json(),
      options,
    );
  },
  useCreateDashboard() {
    return useMutation<
      any,
      HTTPError,
      { name: string; query: string; charts: any[] }
    >(async ({ name, charts, query }) =>
      server(`dashboards`, {
        method: 'POST',
        json: { name, charts, query },
      }).json(),
    );
  },
  useUpdateDashboard() {
    return useMutation<
      any,
      HTTPError,
      { id: string; name: string; query: string; charts: any[] }
    >(async ({ id, name, charts, query }) =>
      server(`dashboards/${id}`, {
        method: 'PUT',
        json: { name, charts, query },
      }).json(),
    );
  },
  useDeleteDashboard() {
    return useMutation<any, HTTPError, { id: string }>(async ({ id }) =>
      server(`dashboards/${id}`, {
        method: 'DELETE',
      }).json(),
    );
  },
  useLogDetails(
    logId: string,
    sortKey: string,
    options?: UseQueryOptions<any, Error>,
  ) {
    return useQuery<any, Error>(
      `logs/${logId}`,
      () => server.get(`logs/${logId}?sortKey=${sortKey}`).json(),
      {
        staleTime: 1000 * 60 * 5, // 5 min
        ...options,
      },
    );
  },
  useRotateTeamApiKey() {
    return useMutation<any, HTTPError>(async () =>
      server(`team/apiKey`, {
        method: 'PATCH',
      }).json(),
    );
  },
  useSendTeamInvite() {
    return useMutation<any, HTTPError, { name?: string; email: string }>(
      async ({ name, email }) =>
        server(`team`, {
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
      server(`installation`).json(),
    );
  },
  useMe() {
    return useQuery<any, HTTPError>(`me`, () => server(`me`).json());
  },
  useTeam() {
    return useQuery<any, HTTPError>(`team`, () => server(`team`).json(), {
      retry: 1,
    });
  },
  useSaveWebhook() {
    return useMutation<
      any,
      HTTPError,
      { service: string; url: string; name: string }
    >(async ({ service, url, name }) =>
      server(`webhooks`, {
        method: 'POST',
        json: {
          name,
          service,
          url,
        },
      }).json(),
    );
  },
  useWebhooks(service: string) {
    return useQuery<any, Error>({
      queryKey: [service],
      queryFn: () =>
        server('webhooks', {
          method: 'GET',
          searchParams: [['service', service]],
        }).json(),
    });
  },
  useDeleteWebhook() {
    return useMutation<any, HTTPError, { id: string }>(async ({ id }) =>
      server(`webhooks/${id}`, {
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
      server(`register/password`, {
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
