import React from 'react';
import Router from 'next/router';
import type { HTTPError, Options, ResponsePromise } from 'ky';
import ky from 'ky-universal';
import type { Alert } from '@hyperdx/common-utils/dist/types';
import type { UseQueryOptions } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';

import { IS_LOCAL_MODE } from './config';
import type { AlertsPageItem, Anomaly, Service, Incident } from './types';

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

type AlertsResponse = {
  data: AlertsPageItem[];
};

type ApiAlertInput = Alert;

export function loginHook(request: Request, options: any, response: Response) {
  // marketing pages
  const WHITELIST_PATHS = [
    '/',
    '/forgot',
    '/join-team',
    '/login',
    '/register',
    '/reset-password',
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
  useCreateAlert() {
    return useMutation<any, Error, ApiAlertInput>({
      mutationFn: async alert =>
        server('alerts', {
          method: 'POST',
          json: alert,
        }).json(),
    });
  },
  useUpdateAlert() {
    return useMutation<any, Error, { id: string } & ApiAlertInput>({
      mutationFn: async alert =>
        server(`alerts/${alert.id}`, {
          method: 'PUT',
          json: alert,
        }).json(),
    });
  },
  useDeleteAlert() {
    return useMutation<any, Error, string>({
      mutationFn: async (alertId: string) =>
        server(`alerts/${alertId}`, {
          method: 'DELETE',
        }),
    });
  },
  useSilenceAlert() {
    return useMutation<any, Error, { alertId: string; mutedUntil: string }>({
      mutationFn: async ({ alertId, mutedUntil }) =>
        server(`alerts/${alertId}/silenced`, {
          method: 'POST',
          json: { mutedUntil },
        }),
    });
  },
  useUnsilenceAlert() {
    return useMutation<any, Error, string>({
      mutationFn: async (alertId: string) =>
        server(`alerts/${alertId}/silenced`, {
          method: 'DELETE',
        }),
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
  useAlerts() {
    return useQuery({
      queryKey: [`alerts`],
      queryFn: () => hdxServer(`alerts`).json() as Promise<AlertsResponse>,
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
  // Registry Services (MongoDB)
  useRegistryServices(options?: UseQueryOptions<Service[], Error>) {
    return useQuery({
      queryKey: ['registry-services'],
      queryFn: () => hdxServer('services', { method: 'GET' }).json(),
      ...options,
    });
  },
  useRegistryService(serviceName: string, options?: UseQueryOptions<Service, Error>) {
    return useQuery({
      queryKey: ['registry-services', serviceName],
      queryFn: () => hdxServer(`services/${serviceName}`, { method: 'GET' }).json(),
      enabled: !!serviceName,
      ...options,
    });
  },
  useServiceChecks(serviceName: string, options?: UseQueryOptions<any[], Error>) {
    return useQuery({
      queryKey: ['service-checks', serviceName],
      queryFn: () => hdxServer(`services/${serviceName}/checks`, { method: 'GET' }).json(),
      enabled: !!serviceName,
      ...options,
    });
  },
  useUpdateService() {
    return useMutation<Service, Error, { name: string } & Partial<Service>>({
      mutationFn: async ({ name, ...updates }) =>
        hdxServer(`services/${name}`, {
          method: 'PATCH',
          json: updates,
        }).json(),
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
  useSetTeamName() {
    return useMutation<any, HTTPError, { name: string }>({
      mutationFn: async ({ name }) =>
        hdxServer(`team/name`, {
          method: 'PATCH',
          json: { name },
        }).json(),
    });
  },
  useUpdateClickhouseSettings() {
    return useMutation<
      any,
      HTTPError,
      {
        searchRowLimit?: number;
        fieldMetadataDisabled?: boolean;
        metadataMaxRowsToRead?: number;
      }
    >({
      mutationFn: async settings =>
        hdxServer(`team/clickhouse-settings`, {
          method: 'PATCH',
          json: settings,
        }).json(),
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
      }: {
        service: string;
        url: string;
        name: string;
        description: string;
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
        body?: string;
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
        }).json(),
    });
  },
  useUpdateWebhook() {
    return useMutation<
      any,
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
      }: {
        id: string;
        service: string;
        url: string;
        name: string;
        description: string;
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
        body?: string;
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
  useTestWebhook() {
    return useMutation<
      any,
      Error | HTTPError,
      {
        service: string;
        url: string;
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
        body?: string;
      }
    >({
      mutationFn: async ({
        service,
        url,
        queryParams,
        headers,
        body,
      }: {
        service: string;
        url: string;
        queryParams?: Record<string, string>;
        headers?: Record<string, string>;
        body?: string;
      }) =>
        hdxServer(`webhooks/test`, {
          method: 'POST',
          json: {
            service,
            url,
            queryParams: queryParams || {},
            headers: headers || {},
            body,
          },
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
        }).json() as Promise<{ success: boolean; error?: string }>,
    });
  },
  // SLO hooks
  useSLOs(options?: UseQueryOptions<any, Error>) {
    return useQuery({
      queryKey: ['slos'],
      queryFn: () => hdxServer('slos', { method: 'GET' }).json(),
      ...options,
    });
  },
  useSLO(sloId: string, options?: UseQueryOptions<any, Error>) {
    return useQuery({
      queryKey: ['slos', sloId],
      queryFn: () => hdxServer(`slos/${sloId}`, { method: 'GET' }).json(),
      ...options,
    });
  },
  useSLOStatus(sloId: string, options?: UseQueryOptions<any, Error>) {
    return useQuery({
      queryKey: ['slo-status', sloId],
      queryFn: () =>
        hdxServer(`slos/${sloId}/status`, { method: 'GET' }).json(),
      ...options,
    });
  },
  useSLOBurnRate(
    sloId: string,
    timeStart: Date,
    timeEnd: Date,
    options?: UseQueryOptions<any, Error>,
  ) {
    return useQuery({
      queryKey: [
        'slo-burn-rate',
        sloId,
        timeStart?.getTime(),
        timeEnd?.getTime(),
      ],
      queryFn: () =>
        hdxServer(`slos/${sloId}/burn-rate`, {
          method: 'GET',
          searchParams: {
            timeStart: timeStart.toISOString(),
            timeEnd: timeEnd.toISOString(),
          },
        }).json(),
      ...options,
    });
  },
  useCreateSLO() {
    return useMutation({
      mutationFn: async (slo: any) =>
        hdxServer('slos', {
          method: 'POST',
          json: slo,
        }).json(),
    });
  },
  useUpdateSLO() {
    return useMutation({
      mutationFn: async ({ id, ...slo }: { id: string; [key: string]: any }) =>
        hdxServer(`slos/${id}`, {
          method: 'PATCH',
          json: slo,
        }).json(),
    });
  },
  useDeleteSLO() {
    return useMutation({
      mutationFn: async (sloId: string) => {
        await hdxServer(`slos/${sloId}`, {
          method: 'DELETE',
        }).text();
      },
    });
  },
  useSLOBubbleUp(
    sloId: string,
    timeStart: Date,
    timeEnd: Date,
    options?: UseQueryOptions<any, Error>,
  ) {
    return useQuery({
      queryKey: [
        'slo-bubble-up',
        sloId,
        timeStart?.getTime(),
        timeEnd?.getTime(),
      ],
      queryFn: () =>
        hdxServer(`slos/${sloId}/bubbleup`, {
          method: 'POST',
          json: {
            timeStart: timeStart.toISOString(),
            timeEnd: timeEnd.toISOString(),
          },
        }).json(),
      enabled: !!sloId && !!timeStart && !!timeEnd,
      ...options,
    });
  },
  useAnomalies(
    searchParams?: {
      serviceName?: string;
      status?: 'open' | 'resolved' | 'ignored';
      limit?: number;
      offset?: number;
    },
    options?: UseQueryOptions<any, Error>,
  ) {
    return useQuery({
      queryKey: ['anomalies', searchParams],
      queryFn: () =>
        hdxServer('anomalies', {
          method: 'GET',
          searchParams: searchParams as any,
          // @ts-ignore
        }).json<{ data: Anomaly[]; meta: any }>(),
      ...options,
    });
  },
  useAnomaly(id: string, options?: UseQueryOptions<any, Error>) {
    return useQuery({
      queryKey: ['anomaly', id],
      queryFn: () =>
        hdxServer(`anomalies/${id}`, {
          method: 'GET',
          // @ts-ignore
        }).json<{ data: Anomaly }>(),
      enabled: !!id,
      ...options,
    });
  },
  useUpdateAnomaly() {
    return useMutation({
      mutationFn: async ({
        id,
        status,
      }: {
        id: string;
        status: 'open' | 'resolved' | 'ignored';
      }) =>
        hdxServer(`anomalies/${id}`, {
          method: 'PATCH',
          json: { status },
        }).json(),
    });
  },
  // Uptime Monitor hooks
  useUptimeMonitors(options?: UseQueryOptions<any, Error>) {
    return useQuery({
      queryKey: ['uptime-monitors'],
      queryFn: () => hdxServer('uptime-monitors', { method: 'GET' }).json(),
      ...options,
    });
  },
  useUptimeMonitor(monitorId: string, options?: UseQueryOptions<any, Error>) {
    return useQuery({
      queryKey: ['uptime-monitors', monitorId],
      queryFn: () =>
        hdxServer(`uptime-monitors/${monitorId}`, { method: 'GET' }).json(),
      enabled: !!monitorId,
      ...options,
    });
  },
  useCreateUptimeMonitor() {
    return useMutation({
      mutationFn: async (monitor: any) =>
        hdxServer('uptime-monitors', {
          method: 'POST',
          json: monitor,
        }).json(),
    });
  },
  useUpdateUptimeMonitor() {
    return useMutation({
      mutationFn: async ({
        id,
        ...monitor
      }: {
        id: string;
        [key: string]: any;
      }) =>
        hdxServer(`uptime-monitors/${id}`, {
          method: 'PUT',
          json: monitor,
        }).json(),
    });
  },
  useDeleteUptimeMonitor() {
    return useMutation({
      mutationFn: async (monitorId: string) => {
        await hdxServer(`uptime-monitors/${monitorId}`, {
          method: 'DELETE',
        }).text();
      },
    });
  },
  usePauseUptimeMonitor() {
    return useMutation({
      mutationFn: async ({
        id,
        pausedUntil,
      }: {
        id: string;
        pausedUntil?: string;
      }) =>
        hdxServer(`uptime-monitors/${id}/pause`, {
          method: 'POST',
          json: { pausedUntil },
        }).json(),
    });
  },
  useResumeUptimeMonitor() {
    return useMutation({
      mutationFn: async (monitorId: string) =>
        hdxServer(`uptime-monitors/${monitorId}/resume`, {
          method: 'POST',
        }).json(),
    });
  },
  useUptimeCheckHistory(
    monitorId: string,
    limit?: number,
    options?: UseQueryOptions<any, Error>,
  ) {
    return useQuery({
      queryKey: ['uptime-check-history', monitorId, limit],
      queryFn: () =>
        hdxServer(`uptime-monitors/${monitorId}/history`, {
          method: 'GET',
          searchParams: limit ? { limit: limit.toString() } : {},
        }).json(),
      enabled: !!monitorId,
      ...options,
    });
  },
  useUptimeStats(
    monitorId: string,
    startDate: Date,
    endDate: Date,
    options?: UseQueryOptions<any, Error>,
  ) {
    return useQuery({
      queryKey: [
        'uptime-stats',
        monitorId,
        startDate?.getTime(),
        endDate?.getTime(),
      ],
      queryFn: () =>
        hdxServer(`uptime-monitors/${monitorId}/stats`, {
          method: 'GET',
          searchParams: {
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          },
        }).json(),
      enabled: !!monitorId && !!startDate && !!endDate,
      ...options,
    });
  },
  // Incident hooks
  useIncidents(options?: UseQueryOptions<any, Error>) {
    return useQuery({
      queryKey: ['incidents'],
      queryFn: () => hdxServer('incidents', { method: 'GET' }).json(),
      ...options,
    });
  },
  useIncident(id: string, options?: UseQueryOptions<any, Error>) {
    return useQuery({
      queryKey: ['incidents', id],
      queryFn: () =>
        hdxServer(`incidents/${id}`, { method: 'GET' }).json<{
          data: Incident;
        }>(),
      enabled: !!id,
      ...options,
    });
  },
  useCreateIncident() {
    return useMutation({
      mutationFn: async (incident: any) =>
        hdxServer('incidents', {
          method: 'POST',
          json: incident,
        }).json(),
    });
  },
  useUpdateIncident() {
    return useMutation({
      mutationFn: async ({
        id,
        ...updates
      }: {
        id: string;
        [key: string]: any;
      }) =>
        hdxServer(`incidents/${id}`, {
          method: 'PATCH',
          json: updates,
        }).json(),
    });
  },
  useAddIncidentComment() {
    return useMutation({
      mutationFn: async ({ id, message }: { id: string; message: string }) =>
        hdxServer(`incidents/${id}/comments`, {
          method: 'POST',
          json: { message },
        }).json(),
    });
  },
  useAnalyzeIncident() {
    return useMutation({
      mutationFn: async (id: string) =>
        hdxServer(`incidents/${id}/analyze`, {
          method: 'POST',
        }).json(),
    });
  },
};
export default api;
