import Router from 'next/router';
import type { HTTPError, Options, ResponsePromise } from 'ky';
import ky from 'ky-universal';
import type {
  Alert,
  AlertApiResponse,
  AlertHistoryRangeApiResponse,
  AlertsApiResponse,
  InstallationApiResponse,
  MeApiResponse,
  PresetDashboard,
  PresetDashboardFilter,
  RotateApiKeyApiResponse,
  TeamApiResponse,
  TeamClickHouseSettingsUpdate,
  TeamInvitationsApiResponse,
  TeamMembersApiResponse,
  TeamTagsApiResponse,
  UpdateClickHouseSettingsApiResponse,
  WebhookCreateApiResponse,
  WebhooksApiResponse,
  WebhookTestApiResponse,
  WebhookUpdateApiResponse,
} from '@hyperdx/common-utils/dist/types';
import { useMutation, useQuery } from '@tanstack/react-query';

import { IS_LOCAL_MODE } from './config';
import { getLocalDashboardTags } from './dashboard';
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

const server = ky.create({
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
  useCreateAlert() {
    return useMutation<{ data: Alert }, Error, Alert>({
      mutationFn: async alert =>
        server('alerts', {
          method: 'POST',
          json: alert,
        }).json(),
    });
  },
  useUpdateAlert() {
    return useMutation<{ data: Alert }, Error, { id: string } & Alert>({
      mutationFn: async alert =>
        server(`alerts/${alert.id}`, {
          method: 'PUT',
          json: alert,
        }).json(),
    });
  },
  useDeleteAlert() {
    return useMutation<void, Error, string>({
      mutationFn: async (alertId: string) => {
        await server(`alerts/${alertId}`, {
          method: 'DELETE',
        });
      },
    });
  },
  useSilenceAlert() {
    return useMutation<void, Error, { alertId: string; mutedUntil: string }>({
      mutationFn: async ({ alertId, mutedUntil }) => {
        await server(`alerts/${alertId}/silenced`, {
          method: 'POST',
          json: { mutedUntil },
        });
      },
    });
  },
  useUnsilenceAlert() {
    return useMutation<void, Error, string>({
      mutationFn: async (alertId: string) => {
        await server(`alerts/${alertId}/silenced`, {
          method: 'DELETE',
        });
      },
    });
  },
  usePresetDashboardFilters(
    presetDashboard: PresetDashboard,
    sourceId: string,
    enabled: boolean = true,
  ) {
    return useQuery({
      queryKey: [`dashboards`, `preset`, presetDashboard, `filters`, sourceId],
      queryFn: () =>
        hdxServer(`dashboards/preset/${presetDashboard}/filters/`, {
          method: 'GET',
          searchParams: { sourceId },
        }).json<PresetDashboardFilter[]>(),
      enabled: !!sourceId && enabled,
    });
  },
  useCreatePresetDashboardFilter() {
    return useMutation<PresetDashboardFilter, Error, PresetDashboardFilter>({
      mutationFn: async (filter: PresetDashboardFilter) =>
        hdxServer(`dashboards/preset/${filter.presetDashboard}/filter`, {
          method: 'POST',
          json: { filter },
        }).json<PresetDashboardFilter>(),
    });
  },
  useUpdatePresetDashboardFilter() {
    return useMutation<PresetDashboardFilter, Error, PresetDashboardFilter>({
      mutationFn: async (filter: PresetDashboardFilter) =>
        hdxServer(`dashboards/preset/${filter.presetDashboard}/filter`, {
          method: 'PUT',
          json: { filter },
        }).json<PresetDashboardFilter>(),
    });
  },
  useDeletePresetDashboardFilter() {
    return useMutation<
      PresetDashboardFilter,
      Error,
      { id: string; presetDashboard: PresetDashboard }
    >({
      mutationFn: async ({
        id,
        presetDashboard,
      }: {
        id: string;
        presetDashboard: PresetDashboard;
      }) =>
        hdxServer(`dashboards/preset/${presetDashboard}/filter/${id}`, {
          method: 'DELETE',
        }).json<PresetDashboardFilter>(),
    });
  },
  getAlertsQueryKey: () => ['alerts'] as const,
  getAlertQueryKey: (alertId: string | undefined) =>
    ['alert', alertId] as const,
  useAlerts() {
    return useQuery({
      queryKey: api.getAlertsQueryKey(),
      queryFn: () => hdxServer(`alerts`).json<AlertsApiResponse>(),
    });
  },
  useAlert(alertId: string | undefined) {
    return useQuery({
      queryKey: api.getAlertQueryKey(alertId),
      queryFn: () => hdxServer(`alerts/${alertId}`).json<AlertApiResponse>(),
      enabled: alertId != null,
    });
  },
  getAlertHistoryQueryKey: (
    alertId: string | undefined,
    startTime: number,
    endTime: number,
  ) => ['alertHistory', alertId, startTime, endTime] as const,
  // Fetches alert firing/recovery transitions within a time range, for drawing
  // annotations on dashboard charts. Bounds are quantized to the minute so a
  // live/auto-refreshing dashboard doesn't produce a new query key (and refetch
  // every alerted tile) on every sub-minute tick.
  useAlertHistory(
    alertId: string | undefined,
    dateRange: [Date, Date],
    { enabled = true }: { enabled?: boolean } = {},
  ) {
    const BUCKET_MS = 60_000;
    const startTime =
      Math.floor(dateRange[0].getTime() / BUCKET_MS) * BUCKET_MS;
    const endTime = Math.floor(dateRange[1].getTime() / BUCKET_MS) * BUCKET_MS;
    return useQuery({
      queryKey: api.getAlertHistoryQueryKey(alertId, startTime, endTime),
      queryFn: () =>
        hdxServer(`alerts/${alertId}/history`, {
          method: 'GET',
          searchParams: { startTime, endTime },
        }).json<AlertHistoryRangeApiResponse>(),
      enabled: enabled && alertId != null,
    });
  },
  useServices() {
    return useQuery({
      queryKey: [`services`],
      queryFn: () =>
        hdxServer(`chart/services`, {
          method: 'GET',
        }).json<ServicesResponse>(),
    });
  },
  useRotateTeamApiKey() {
    return useMutation<RotateApiKeyApiResponse, Error | HTTPError>({
      mutationFn: async () =>
        hdxServer(`team/apiKey`, {
          method: 'PATCH',
        }).json<RotateApiKeyApiResponse>(),
    });
  },
  useDeleteTeamMember() {
    return useMutation<
      { message: string },
      Error | HTTPError,
      { userId: string }
    >({
      mutationFn: async ({ userId }: { userId: string }) =>
        hdxServer(`team/member/${userId}`, {
          method: 'DELETE',
        }).json<{ message: string }>(),
    });
  },
  useTeamInvitations() {
    return useQuery<TeamInvitationsApiResponse>({
      queryKey: [`team/invitations`],
      queryFn: () =>
        hdxServer(`team/invitations`).json<TeamInvitationsApiResponse>(),
    });
  },
  useSaveTeamInvitation() {
    return useMutation<
      { url: string },
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
        }).json<{ url: string }>(),
    });
  },
  useDeleteTeamInvitation() {
    return useMutation({
      mutationFn: async ({ id }: { id: string }) =>
        hdxServer(`team/invitation/${id}`, {
          method: 'DELETE',
        }).json<{ message: string }>(),
    });
  },
  useInstallation() {
    return useQuery<InstallationApiResponse | undefined, Error>({
      queryKey: [`installation`],
      queryFn: () => {
        if (IS_LOCAL_MODE) {
          return;
        }
        return hdxServer(`installation`).json<InstallationApiResponse>();
      },
    });
  },
  useMe() {
    return useQuery<MeApiResponse | null>({
      queryKey: [`me`],
      queryFn: () => {
        if (IS_LOCAL_MODE) {
          return null;
        }
        return hdxServer(`me`).json<MeApiResponse>();
      },
    });
  },
  useTeam() {
    return useQuery({
      queryKey: [`team`],
      queryFn: () => {
        if (IS_LOCAL_MODE) {
          return null;
        }
        return hdxServer(`team`).json<TeamApiResponse>();
      },
      retry: 1,
    });
  },
  useTeamMembers() {
    return useQuery<TeamMembersApiResponse>({
      queryKey: [`team/members`],
      queryFn: () => hdxServer(`team/members`).json<TeamMembersApiResponse>(),
    });
  },
  useSetTeamName() {
    return useMutation<{ name: string }, HTTPError, { name: string }>({
      mutationFn: async ({ name }) =>
        hdxServer(`team/name`, {
          method: 'PATCH',
          json: { name },
        }).json<{ name: string }>(),
    });
  },
  useUpdateClickhouseSettings() {
    return useMutation<
      UpdateClickHouseSettingsApiResponse,
      HTTPError,
      TeamClickHouseSettingsUpdate
    >({
      mutationFn: async settings =>
        hdxServer(`team/clickhouse-settings`, {
          method: 'PATCH',
          json: settings,
        }).json<UpdateClickHouseSettingsApiResponse>(),
    });
  },
  useTags() {
    return useQuery({
      queryKey: [`team/tags`],
      queryFn: IS_LOCAL_MODE
        ? async () => ({ data: getLocalDashboardTags() })
        : () => hdxServer(`team/tags`).json<TeamTagsApiResponse>(),
    });
  },
  useSaveWebhook() {
    return useMutation<
      WebhookCreateApiResponse,
      Error | HTTPError,
      {
        service: string;
        url: string;
        name: string;
        description: string;
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
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
      }) =>
        hdxServer(`webhooks`, {
          method: 'POST',
          json: {
            name,
            service,
            url,
            description,
            queryParams: queryParams || {},
            headers: headers || {},
            body,
          },
        }).json<WebhookCreateApiResponse>(),
    });
  },
  useUpdateWebhook() {
    return useMutation<
      WebhookUpdateApiResponse,
      Error | HTTPError,
      {
        id: string;
        service: string;
        url: string;
        name: string;
        description: string;
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
        body?: string;
      }
    >({
      mutationFn: async ({
        id,
        service,
        url,
        name,
        description,
        queryParams,
        headers,
        body,
      }) =>
        hdxServer(`webhooks/${id}`, {
          method: 'PUT',
          json: {
            name,
            service,
            url,
            description,
            queryParams: queryParams || {},
            headers: headers || {},
            body,
          },
        }).json<WebhookUpdateApiResponse>(),
    });
  },
  useWebhooks(services: string[]) {
    return useQuery<WebhooksApiResponse, Error>({
      queryKey: [...services],
      queryFn: () =>
        hdxServer('webhooks', {
          method: 'GET',
          searchParams: [...services.map(service => ['service', service])],
        }).json<WebhooksApiResponse>(),
    });
  },
  useDeleteWebhook() {
    return useMutation<
      Record<string, never>,
      Error | HTTPError,
      { id: string }
    >({
      mutationFn: async ({ id }: { id: string }) =>
        hdxServer(`webhooks/${id}`, {
          method: 'DELETE',
        }).json(),
    });
  },
  useTestWebhook() {
    return useMutation<
      WebhookTestApiResponse,
      Error | HTTPError,
      {
        service: string;
        url: string;
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
        body?: string;
        webhookId?: string;
      }
    >({
      mutationFn: async ({
        service,
        url,
        queryParams,
        headers,
        body,
        webhookId,
      }) =>
        hdxServer(`webhooks/test`, {
          method: 'POST',
          json: {
            service,
            url,
            queryParams: queryParams || {},
            headers: headers || {},
            body,
            ...(webhookId && { webhookId }),
          },
        }).json<WebhookTestApiResponse>(),
    });
  },
  useRegisterPassword() {
    return useMutation<
      { status: string },
      Error,
      { email: string; password: string; confirmPassword: string }
    >({
      mutationFn: async ({ email, password, confirmPassword }) =>
        hdxServer(`register/password`, {
          method: 'POST',
          json: {
            email,
            password,
            confirmPassword,
          },
        }).json<{ status: string }>(),
    });
  },
  useTestConnection() {
    return useMutation<
      { success: boolean; error?: string },
      Error,
      { host: string; username: string; password: string }
    >({
      mutationFn: async ({ host, username, password }) =>
        hdxServer(`clickhouse-proxy/test`, {
          method: 'POST',
          json: {
            host,
            username,
            password,
          },
        }).json<{ success: boolean; error?: string }>(),
    });
  },
};
export default api;

// --------------------------
// Prometheus API
// --------------------------
type PrometheusMetric = Record<string, string>;
type PrometheusMatrixResult = {
  metric: PrometheusMetric;
  values: [number, string][];
};
type PrometheusQueryRangeResponse = {
  status: 'success' | 'error';
  data?: {
    resultType: 'matrix';
    result: PrometheusMatrixResult[];
  };
  error?: string;
};
type PrometheusLabelValuesResponse = {
  status: 'success' | 'error';
  data?: string[];
  error?: string;
};
// Native Prometheus /query_exemplars shape: one entry per series, each with its
// own exemplar list. `labels` carries the trace/span id (label naming varies by
// exporter, e.g. trace_id vs traceID — normalized downstream).
type PrometheusExemplarsResult = {
  seriesLabels: PrometheusMetric;
  exemplars: { labels: PrometheusMetric; value: string; timestamp: number }[];
};
type PrometheusQueryExemplarsResponse = {
  status: 'success' | 'error';
  data?: PrometheusExemplarsResult[];
  error?: string;
};

async function prometheusFetch<T>(
  path: string,
  searchParams: Record<string, string>,
): Promise<T> {
  try {
    return await server.post(path, { searchParams }).json();
  } catch (e: any) {
    // ky throws HTTPError on non-2xx — read the response body for the real error
    if (e?.response) {
      try {
        const body = await e.response.json();
        if (body?.error) {
          throw new Error(body.error);
        }
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message !== e.message) {
          throw parseErr;
        }
      }
    }
    throw e;
  }
}

export const prometheusApi = {
  queryRange: (params: {
    query: string;
    start: number;
    end: number;
    step: string;
    connectionId: string;
    database?: string;
    table?: string;
  }): Promise<PrometheusQueryRangeResponse> =>
    prometheusFetch('v1/prometheus/query_range', {
      query: params.query,
      start: String(params.start),
      end: String(params.end),
      step: params.step,
      connectionId: params.connectionId,
      ...(params.database ? { database: params.database } : {}),
      ...(params.table ? { table: params.table } : {}),
    }),

  queryExemplars: (params: {
    query: string;
    start: number;
    end: number;
    connectionId: string;
    database?: string;
    table?: string;
  }): Promise<PrometheusQueryExemplarsResponse> =>
    prometheusFetch('v1/prometheus/query_exemplars', {
      query: params.query,
      start: String(params.start),
      end: String(params.end),
      connectionId: params.connectionId,
      ...(params.database ? { database: params.database } : {}),
      ...(params.table ? { table: params.table } : {}),
    }),

  labelValues: (params: {
    label: string;
    connectionId: string;
    database?: string;
    table?: string;
  }): Promise<PrometheusLabelValuesResponse> =>
    server
      .get(`v1/prometheus/label/${params.label}/values`, {
        searchParams: {
          connectionId: params.connectionId,
          ...(params.database ? { database: params.database } : {}),
          ...(params.table ? { table: params.table } : {}),
        },
      })
      .json(),
};
