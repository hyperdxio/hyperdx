import React from 'react';
import Router from 'next/router';
import type { HTTPError, Options, ResponsePromise } from 'ky';
import ky from 'ky-universal';
import type {
  InfiniteData,
  QueryKey,
  UseInfiniteQueryOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';

import { IS_LOCAL_MODE } from './config';
import type {
  AlertChannel,
  AlertInterval,
  AlertSource,
  AlertType,
  ChartSeries,
  LogView,
  MetricsDataType,
  ServerDashboard,
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
      'deployment.environment'?: string;
      'k8s.namespace.name'?: string;
      'k8s.pod.name'?: string;
      'k8s.pod.uid'?: string;
    }>
  >;
};

type MultiSeriesChartInput = {
  series: ChartSeries[];
  endDate: Date;
  granularity?: string;
  startDate: Date;
  sortOrder?: 'asc' | 'desc';
  seriesReturnType: 'column' | 'ratio';
  postGroupWhere?: string;
};

type MultiSeriesChartResponse = {
  data: {
    ts_bucket: string;
    group: string[];
    [dataKey: `series_${number}.data`]: number;
  }[];
};

const getEnrichedSeries = (series: ChartSeries[]) =>
  series
    .filter(s => {
      // Skip time series without field
      if (s.type === 'time') {
        if (s.table === 'metrics' && !s.field) {
          return false;
        }
        if (s.table === 'logs' && !s.field && s.aggFn !== 'count') {
          return false;
        }
      }
      return true;
    })
    .map(s => {
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

export function loginHook(request: Request, options: any, response: Response) {
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
  prefixUrl: '/api',
  credentials: 'include',
  hooks: {
    afterResponse: [loginHook],
  },
  timeout: false,
});

export const hdxServer = (
  url: string,
  options?: Options | undefined,
): ResponsePromise => {
  return server(url, {
    ...options,
  });
};

const api = {
  usePropertyTypeMappings(options?: UseQueryOptions<any, Error>) {
    return useQuery({
      queryKey: [`logs/propertyTypeMappings`],

      queryFn: () =>
        hdxServer(`logs/propertyTypeMappings`, {
          method: 'GET',
        })
          .json<{ data: any[] }>()
          .then(res => new Map(res.data)),
      staleTime: 1000 * 60 * 5, // Cache every 5 min
      ...options,
    });
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
    }: MultiSeriesChartInput,
    options?: UseQueryOptions<any, Error>,
  ) {
    const enrichedSeries = getEnrichedSeries(series);

    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    return useQuery<MultiSeriesChartResponse, Error>({
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
      enabled: enrichedSeries.length > 0,
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
    options?: Partial<
      UseInfiniteQueryOptions<
        any,
        Error,
        InfiniteData<{ data: any[] }>,
        any,
        QueryKey,
        number
      >
    >,
  ) {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    return useInfiniteQuery<
      { data: any[] },
      Error,
      InfiniteData<{ data: any[] }>,
      QueryKey,
      number
    >({
      queryKey: ['logs', q, startTime, endTime, extraFields, order, limit],
      initialPageParam: 0,
      getNextPageParam: (lastPage: any, allPages: any) => {
        if (lastPage.rows === 0) return undefined;
        // @ts-ignore
        return allPages.flatMap(page => page.data).length;
      },
      queryFn: async ({ pageParam }: { pageParam: number }) =>
        hdxServer('logs', {
          method: 'GET',
          searchParams: [
            ['endTime', endTime],
            ['offset', pageParam],
            ['q', q],
            ['startTime', startTime],
            ['order', order],
            ['limit', limit],
            ...extraFields.map(field => ['extraFields[]', field] as const),
          ] as Array<Array<string | number | boolean>>,
        }).json(),
      ...options,
    });
  },
  useDashboards(options?: UseQueryOptions<any, Error>) {
    return useQuery({
      queryKey: [`dashboards`],
      queryFn: () => {
        if (IS_LOCAL_MODE) {
          return null;
        }
        return hdxServer(`dashboards`, { method: 'GET' }).json();
      },
      ...options,
    });
  },
  useCreateDashboard() {
    return useMutation({
      mutationFn: async ({
        name,
        charts,
        query,
        tags,
      }: {
        name: string;
        charts: any;
        query: any;
        tags: any;
      }) =>
        hdxServer(`dashboards`, {
          method: 'POST',
          json: { name, charts, query, tags },
        }).json(),
    });
  },
  useUpdateDashboard() {
    return useMutation({
      mutationFn: async ({
        id,
        name,
        charts,
        query,
        tags,
      }: {
        id: string;
        name: string;
        charts: any;
        query: any;
        tags: any;
      }) =>
        hdxServer(`dashboards/${id}`, {
          method: 'PUT',
          json: { name, charts, query, tags },
        }).json(),
    });
  },
  useDeleteDashboard() {
    return useMutation({
      mutationFn: async ({ id }: { id: string }) =>
        hdxServer(`dashboards/${id}`, {
          method: 'DELETE',
        }).json(),
    });
  },
  useServices() {
    return useQuery({
      queryKey: [`services`],
      queryFn: () =>
        hdxServer(`chart/services`, {
          method: 'GET',
        }).json() as Promise<ServicesResponse>,
    });
  },
  useRotateTeamApiKey() {
    return useMutation<any, Error | HTTPError>({
      mutationFn: async () =>
        hdxServer(`team/apiKey`, {
          method: 'PATCH',
        }).json(),
    });
  },
  useDeleteTeamMember() {
    return useMutation<any, Error | HTTPError, { userId: string }>({
      mutationFn: async ({ userId }: { userId: string }) =>
        hdxServer(`team/member/${userId}`, {
          method: 'DELETE',
        }).json(),
    });
  },
  useTeamInvitations() {
    return useQuery<any>({
      queryKey: [`team/invitations`],
      queryFn: () => hdxServer(`team/invitations`).json(),
    });
  },
  useSaveTeamInvitation() {
    return useMutation<
      any,
      Error | HTTPError,
      { name?: string; email: string }
    >({
      mutationFn: async ({ name, email }: { name?: string; email: string }) =>
        hdxServer(`team/invitation`, {
          method: 'POST',
          json: {
            name,
            email,
          },
        }).json(),
    });
  },
  useDeleteTeamInvitation() {
    return useMutation({
      mutationFn: async ({ id }: { id: string }) =>
        hdxServer(`team/invitation/${id}`, {
          method: 'DELETE',
        }).json(),
    });
  },
  useInstallation() {
    return useQuery<any, Error>({
      queryKey: [`installation`],
      queryFn: () => {
        if (IS_LOCAL_MODE) {
          return;
        }
        return hdxServer(`installation`).json();
      },
    });
  },
  useMe() {
    return useQuery<any>({
      queryKey: [`me`],
      queryFn: () => {
        if (IS_LOCAL_MODE) {
          return null;
        }
        return hdxServer(`me`).json();
      },
    });
  },
  useTeam() {
    return useQuery<any, Error>({
      queryKey: [`team`],
      queryFn: () => {
        if (IS_LOCAL_MODE) {
          return null;
        }
        return hdxServer(`team`).json();
      },
      retry: 1,
    });
  },
  useTeamMembers() {
    return useQuery<any>({
      queryKey: [`team/members`],
      queryFn: () => hdxServer(`team/members`).json(),
    });
  },
  useTags() {
    return useQuery({
      queryKey: [`team/tags`],
      queryFn: () => hdxServer(`team/tags`).json<{ data: string[] }>(),
    });
  },
  useSaveWebhook() {
    return useMutation<
      any,
      Error | HTTPError,
      {
        service: string;
        url: string;
        name: string;
        description: string;
        queryParams?: string;
        headers: string;
        body?: string;
      }
    >({
      mutationFn: async ({
        service,
        url,
        name,
        description,
        queryParams,
        headers,
        body,
      }: {
        service: string;
        url: string;
        name: string;
        description: string;
        queryParams?: string;
        headers: string;
        body?: string;
      }) =>
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
    });
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
    return useMutation<any, Error | HTTPError, { id: string }>({
      mutationFn: async ({ id }: { id: string }) =>
        hdxServer(`webhooks/${id}`, {
          method: 'DELETE',
        }).json(),
    });
  },
  useRegisterPassword() {
    return useMutation({
      // @ts-ignore
      mutationFn: async ({ email, password, confirmPassword }) =>
        hdxServer(`register/password`, {
          method: 'POST',
          json: {
            email,
            password,
            confirmPassword,
          },
        }).json(),
    });
  },
  useTestConnection() {
    return useMutation({
      mutationFn: async ({
        host,
        username,
        password,
      }: {
        host: string;
        username: string;
        password: string;
      }) =>
        hdxServer(`clickhouse-proxy/test`, {
          method: 'POST',
          json: {
            host,
            username,
            password,
          },
        }).json() as Promise<{ success: boolean }>,
    });
  },
};
export default api;

/**
 * This reason for this hook is to provide a drop-in replacement for api.useMultiSeriesChart
 * with a slightly different fetching logic.
 *
 * The original useMultiSeriesChart fetches data every time the input changes, even if the previous
 * fetch is still in progress. This can be a problem for some queries that take more than ~30s to run.
 * This hook will only fetch data if the input has changed and the previous fetch has completed.
 */
export const useMultiSeriesChartV2 = (
  input: MultiSeriesChartInput,
  { enabled = true }: { enabled?: boolean } = {},
) => {
  const [data, setData] = React.useState<MultiSeriesChartResponse | null>(null);
  const [isError, setIsError] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [lastLoadedKey, setLastLoadedKey] = React.useState<string | null>(null);

  const key = JSON.stringify(input);

  React.useEffect(() => {
    if (!enabled || isLoading || key === lastLoadedKey) {
      return;
    }

    setIsLoading(true);

    hdxServer('chart/series', {
      method: 'POST',
      json: {
        series: getEnrichedSeries(input.series),
        endTime: input.endDate.getTime(),
        startTime: input.startDate.getTime(),
        granularity: input.granularity,
        sortOrder: input.sortOrder,
        seriesReturnType: input.seriesReturnType,
        postGroupWhere: input.postGroupWhere,
        databaseName:
          input.series[0].type === 'time'
            ? input.series[0].databaseName
            : undefined,
        tableName:
          input.series[0].type === 'time'
            ? input.series[0].tableName
            : undefined,
        timestampColumn:
          input.series[0].type === 'time'
            ? input.series[0].timestampColumn
            : undefined,
        implicitColumn:
          input.series[0].type === 'time'
            ? input.series[0].implicitColumn
            : undefined,
      },
    })
      .json()
      .then((data: any) => {
        setData(data as MultiSeriesChartResponse);
        setIsError(false);
      })
      .catch(() => setIsError(true))
      .finally(() => {
        setIsLoading(false);
        setLastLoadedKey(key);
      });
  }, [enabled, isLoading, key, lastLoadedKey, input]);

  return {
    data,
    isError,
    isLoading,
  };
};
