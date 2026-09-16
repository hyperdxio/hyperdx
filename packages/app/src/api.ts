import { useCallback } from 'react';
import Router from 'next/router';
import type { HTTPError, Options, ResponsePromise } from 'ky';
import ky from 'ky-universal';
import type {
  Alert,
  AlertApiResponse,
  AlertEvaluationsApiResponse,
  AlertHistoryRangeApiResponse,
  AlertsApiResponse,
  InstallationApiResponse,
  MeApiResponse,
  OnboardingDataApiResponse,
  OnboardingTaskId,
  PresetDashboard,
  PresetDashboardFilter,
  RotateAccessKeyApiResponse,
  RotateApiKeyApiResponse,
  TagResourceType,
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
import { AlertSource, AlertState } from '@hyperdx/common-utils/dist/types';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { IS_LOCAL_MODE } from './config';
import { getLocalDashboardTags } from './dashboard';
import { getLocalSavedSearchTags } from './savedSearch';
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

// Standalone export so other mutation hooks in this file can compose it.
export function useCompleteOnboardingTask() {
  const queryClient = useQueryClient();
  return useMutation<
    OnboardingDataApiResponse,
    Error | HTTPError,
    OnboardingTaskId
  >({
    mutationFn: async (taskId: OnboardingTaskId) =>
      hdxServer('me/onboarding/task', {
        method: 'POST',
        json: { taskId },
      }).json<OnboardingDataApiResponse>(),
    onSuccess: data => {
      // Union completedTasks (not replace) so an out-of-order response can't
      // drop a newer task; keep isDismissed from the cache since a concurrent
      // dismiss's state isn't reflected in this response.
      queryClient.setQueryData<MeApiResponse | null>(['me'], prev => {
        if (prev?.onboardingData == null) {
          return prev == null
            ? prev
            : { ...prev, onboardingData: data.onboardingData };
        }
        const merged = new Set([
          ...prev.onboardingData.completedTasks,
          ...data.onboardingData.completedTasks,
        ]);
        return {
          ...prev,
          onboardingData: {
            ...prev.onboardingData,
            completedTasks: [...merged],
          },
        };
      });
    },
  });
}

// Patches the `me` cache in place (no request, no invalidation) after the
// backend has already recorded a task server-side. Invalidating `['me']` would
// refetch for every useMe consumer (metadata, clickhouse settings, AppNav) for
// a change only the sidebar cares about.
export function useMarkOnboardingTaskComplete() {
  const queryClient = useQueryClient();
  return useCallback(
    (taskId: OnboardingTaskId) => {
      queryClient.setQueryData<MeApiResponse | null>(['me'], prev => {
        // `?.`: this runs in dashboard/alert mutation onSuccess, and a throw
        // would flip a succeeded save to "Unable to save".
        if (prev?.onboardingData == null) {
          return prev;
        }
        if (prev.onboardingData.completedTasks.includes(taskId)) {
          return prev;
        }
        return {
          ...prev,
          onboardingData: {
            ...prev.onboardingData,
            completedTasks: [...prev.onboardingData.completedTasks, taskId],
          },
        };
      });
    },
    [queryClient],
  );
}

const ALERTS_PAGE_SIZE = 100;

type AlertsQueryParams = {
  /** Case-insensitive substring of the alert's display name. */
  search?: string | null;
  tag?: string | null;
  source?: AlertSource | null;
  state?: AlertState | null;
  /** A user id; narrows the list to alerts that user created. */
  createdBy?: string | null;
};

/**
 * Drops blank filters so the query key is a function of what is actually sent:
 * the several spellings of "no filter" (`undefined`, `null`, `''`) can't each
 * open their own cache entry.
 */
function normalizeAlertsQueryParams(params: AlertsQueryParams) {
  const search = params.search?.trim();
  return {
    ...(search ? { search } : {}),
    ...(params.tag ? { tag: params.tag } : {}),
    ...(params.source ? { source: params.source } : {}),
    ...(params.state ? { state: params.state } : {}),
    ...(params.createdBy ? { createdBy: params.createdBy } : {}),
  };
}

const TAGS_QUERY_KEY_PREFIX = ['team/tags'] as const;

/** Invalidates every cached tag list */
export function useInvalidateTags() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY_PREFIX }),
    [queryClient],
  );
}

/**
 * Tags on locally persisted resources. Alerts are cloud-only, so local mode
 * never has alert tags.
 */
function getLocalTags(resourceType?: TagResourceType): string[] {
  const tags = [
    ...(resourceType == null || resourceType === 'dashboard'
      ? getLocalDashboardTags()
      : []),
    ...(resourceType == null || resourceType === 'savedSearch'
      ? getLocalSavedSearchTags()
      : []),
  ];
  return Array.from(new Set(tags));
}

const api = {
  useCreateAlert() {
    const markOnboardingTaskComplete = useMarkOnboardingTaskComplete();
    const invalidateTags = useInvalidateTags();
    return useMutation<{ data: Alert }, Error, Alert>({
      mutationFn: async alert =>
        server('alerts', {
          method: 'POST',
          json: alert,
        }).json(),
      // Backend records the task; just sync the cache.
      onSuccess: () => {
        invalidateTags();
        if (!IS_LOCAL_MODE) {
          markOnboardingTaskComplete('alert');
        }
      },
    });
  },
  useUpdateAlert() {
    const markOnboardingTaskComplete = useMarkOnboardingTaskComplete();
    const invalidateTags = useInvalidateTags();
    return useMutation<{ data: Alert }, Error, { id: string } & Alert>({
      mutationFn: async alert =>
        server(`alerts/${alert.id}`, {
          method: 'PUT',
          json: alert,
        }).json(),
      onSuccess: () => {
        invalidateTags();
        if (!IS_LOCAL_MODE) {
          markOnboardingTaskComplete('alert');
        }
      },
    });
  },
  useDeleteAlert() {
    const invalidateTags = useInvalidateTags();
    return useMutation<void, Error, string>({
      mutationFn: async (alertId: string) => {
        await server(`alerts/${alertId}`, {
          method: 'DELETE',
        });
      },
      onSuccess: () => {
        invalidateTags();
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
  useAlerts(
    params: AlertsQueryParams = {},
    { enabled = true }: { enabled?: boolean } = {},
  ) {
    const normalized = normalizeAlertsQueryParams(params);
    return useInfiniteQuery({
      enabled,
      queryKey: ['alerts', normalized] as const,
      queryFn: ({ pageParam: cursor }) =>
        hdxServer(`alerts`, {
          searchParams: {
            limit: ALERTS_PAGE_SIZE,
            ...normalized,
            ...(cursor != null && { cursor }),
          },
        }).json<AlertsApiResponse>(),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: lastPage =>
        lastPage.hasMore ? lastPage.nextCursor : undefined,
      placeholderData: keepPreviousData,
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
  getAlertEvaluationsQueryKey: (
    alertId: string | undefined,
    startTime: number,
    endTime: number,
  ) => ['alertEvaluations', alertId, startTime, endTime] as const,
  // Paginated evaluation history for the alert detail page: one entry per
  // evaluation window (newest first), scoped to the given date range and
  // including errors recorded for each window. Older pages are keyed off the
  // server-provided `nextBefore` cursor, which advances even across gaps with
  // no evaluations. Bounds are quantized to the minute so live ticks don't
  // produce a new query key on every render.
  useAlertEvaluations(alertId: string | undefined, dateRange: [Date, Date]) {
    const BUCKET_MS = 60_000;
    const startTime =
      Math.floor(dateRange[0].getTime() / BUCKET_MS) * BUCKET_MS;
    const endTime = Math.floor(dateRange[1].getTime() / BUCKET_MS) * BUCKET_MS;
    return useInfiniteQuery({
      queryKey: api.getAlertEvaluationsQueryKey(alertId, startTime, endTime),
      queryFn: ({ pageParam }) =>
        hdxServer(`alerts/${alertId}/evaluations`, {
          method: 'GET',
          searchParams: {
            startTime,
            endTime,
            ...(pageParam != null && { before: pageParam }),
          },
        }).json<AlertEvaluationsApiResponse>(),
      initialPageParam: undefined as number | undefined,
      getNextPageParam: lastPage =>
        lastPage.hasMore ? lastPage.nextBefore : undefined,
      enabled: alertId != null && startTime < endTime,
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
    const queryClient = useQueryClient();
    return useMutation<RotateApiKeyApiResponse, Error | HTTPError>({
      mutationFn: async () =>
        hdxServer(`team/apiKey`, {
          method: 'PATCH',
        }).json<RotateApiKeyApiResponse>(),
      // The API key exists on both the me and team response
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['me'] });
        queryClient.invalidateQueries({ queryKey: ['team'] });
      },
    });
  },
  useRotatePersonalAccessKey() {
    const queryClient = useQueryClient();
    return useMutation<RotateAccessKeyApiResponse, Error | HTTPError>({
      mutationFn: async () =>
        hdxServer(`me/accessKey`, {
          method: 'PATCH',
        }).json<RotateAccessKeyApiResponse>(),
      // Seed the cache from the response rather than refetching `me`. The old
      // key is already revoked by the time this runs, so a refetch that fails
      // would leave every `useMe` consumer rendering a dead credential with no
      // way to reach the new one short of a reload.
      onSuccess: data => {
        queryClient.setQueryData<MeApiResponse | null>(['me'], prev =>
          prev == null ? prev : { ...prev, accessKey: data.newAccessKey },
        );
      },
    });
  },
  useDismissOnboarding() {
    const queryClient = useQueryClient();
    return useMutation<OnboardingDataApiResponse, Error | HTTPError, boolean>({
      mutationFn: async (isDismissed: boolean) =>
        hdxServer('me/onboarding/dismiss', {
          method: 'PATCH',
          json: { isDismissed },
        }).json<OnboardingDataApiResponse>(),
      onSuccess: data => {
        queryClient.setQueryData<MeApiResponse | null>(['me'], prev =>
          prev == null
            ? prev
            : { ...prev, onboardingData: data.onboardingData },
        );
      },
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
      staleTime: 1000 * 60,
      refetchOnWindowFocus: 'always',
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
    const queryClient = useQueryClient();
    return useMutation<{ name: string }, HTTPError, { name: string }>({
      mutationFn: async ({ name }) =>
        hdxServer(`team/name`, {
          method: 'PATCH',
          json: { name },
        }).json<{ name: string }>(),
      // The name lives in both the `team` and `me` responses
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['me'] });
        queryClient.invalidateQueries({ queryKey: ['team'] });
      },
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
  getTagsQueryKey: (resourceType?: TagResourceType) =>
    [...TAGS_QUERY_KEY_PREFIX, resourceType ?? null] as const,
  /** Tags that have been added to resources, optionally narrowed to one resource type. */
  useTags(resourceType?: TagResourceType) {
    return useQuery({
      queryKey: api.getTagsQueryKey(resourceType),
      queryFn: IS_LOCAL_MODE
        ? async () => ({ data: getLocalTags(resourceType) })
        : () =>
            hdxServer('team/tags', {
              searchParams: resourceType ? { resourceType } : undefined,
            }).json<TeamTagsApiResponse>(),
    });
  },
  useSaveWebhook() {
    const queryClient = useQueryClient();
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
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      },
    });
  },
  useUpdateWebhook() {
    const queryClient = useQueryClient();
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
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      },
    });
  },
  useWebhooks(services: string[]) {
    return useQuery<WebhooksApiResponse, Error>({
      // Prefixed so webhook mutations can invalidate every service variant.
      queryKey: ['webhooks', ...services],
      queryFn: () =>
        hdxServer('webhooks', {
          method: 'GET',
          searchParams: [...services.map(service => ['service', service])],
        }).json<WebhooksApiResponse>(),
      staleTime: 1000 * 60,
    });
  },
  useDeleteWebhook() {
    const queryClient = useQueryClient();
    return useMutation<
      Record<string, never>,
      Error | HTTPError,
      { id: string }
    >({
      mutationFn: async ({ id }: { id: string }) =>
        hdxServer(`webhooks/${id}`, {
          method: 'DELETE',
        }).json(),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      },
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
type PrometheusLabelsResponse = {
  status: 'success' | 'error';
  data?: string[];
  error?: string;
};

/** Reports the reason a Prometheus-shaped error body carries, not ky's. */
async function withPrometheusError<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
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

/**
 * Some Prometheus backends return the same label name or value more than once,
 * de-dupe to prevent any duplicate option errors downstream.
 */
const uniqueLabels = (
  resp: PrometheusLabelsResponse,
): PrometheusLabelsResponse =>
  resp.data ? { ...resp, data: [...new Set(resp.data)] } : resp;

const prometheusFetch = <T>(
  path: string,
  searchParams: Record<string, string>,
): Promise<T> =>
  withPrometheusError(() => server.post(path, { searchParams }).json<T>());

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

  labels: (params: {
    connectionId: string;
    database?: string;
    table?: string;
    start?: number;
    end?: number;
  }): Promise<PrometheusLabelsResponse> =>
    server
      .get('v1/prometheus/labels', {
        searchParams: labelLookupSearchParams(params),
      })
      .json<PrometheusLabelsResponse>()
      .then(uniqueLabels),

  labelValues: (params: {
    label: string;
    connectionId: string;
    database?: string;
    table?: string;
    start?: number;
    end?: number;
    match?: string;
  }): Promise<PrometheusLabelsResponse> =>
    withPrometheusError(() =>
      server
        .get(`v1/prometheus/label/${params.label}/values`, {
          searchParams: labelLookupSearchParams(params),
        })
        .json<PrometheusLabelsResponse>()
        .then(uniqueLabels),
    ),
};

function labelLookupSearchParams(params: {
  connectionId: string;
  database?: string;
  table?: string;
  start?: number;
  end?: number;
  match?: string;
}): Record<string, string> {
  return {
    connectionId: params.connectionId,
    ...(params.database ? { database: params.database } : {}),
    ...(params.table ? { table: params.table } : {}),
    ...(params.start != null ? { start: String(params.start) } : {}),
    ...(params.end != null ? { end: String(params.end) } : {}),
    ...(params.match ? { 'match[]': params.match } : {}),
  };
}
