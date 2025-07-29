import React from 'react';
import Router from 'next/router';
import type { HTTPError, Options, ResponsePromise } from 'ky';
import ky from 'ky-universal';
import type { Alert } from '@hyperdx/common-utils/dist/types';
import type { UseQueryOptions } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';

import { IS_LOCAL_MODE } from './config';
import type { AlertsPageItem } from './types';

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
  useSetTeamSearchRowLimit() {
    return useMutation<any, HTTPError, { searchRowLimit: number }>({
      mutationFn: async ({ searchRowLimit }) =>
        hdxServer(`team/search-row-limit`, {
          method: 'PATCH',
          json: { searchRowLimit },
        }).json(),
    });
  },
  useSetFieldMetadataDisabled() {
    return useMutation<any, HTTPError, { fieldMetadataDisabled: boolean }>({
      mutationFn: async ({ fieldMetadataDisabled }) =>
        hdxServer(`team/field-metadata`, {
          method: 'PATCH',
          json: { fieldMetadataDisabled },
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
        }).json() as Promise<{ success: boolean; error?: string }>,
    });
  },
};
export default api;
