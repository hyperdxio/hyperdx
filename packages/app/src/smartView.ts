import {
  SmartView as SmartViewBase,
  SmartViewResource,
} from '@hyperdx/common-utils/dist/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hdxServer } from './api';
import { IS_LOCAL_MODE } from './config';
import { createEntityStore } from './localStore';

export type SmartView = SmartViewBase & {
  createdAt?: string;
  updatedAt?: string;
};

export type SmartViewInput = Omit<SmartView, 'id' | 'createdAt' | 'updatedAt'>;

// Local-mode storage mirrors the favorites + dashboards pattern; the
// Vercel preview deployments and standalone `IS_LOCAL_MODE` builds have
// no `/smart-views` backend, so all CRUD goes through localStorage and
// React Query never tries to hit the API.
const localSmartViews = createEntityStore<SmartView>('hdx-local-smart-views');

function normalizeSmartView(view: Partial<SmartView>): SmartView {
  // Coerce any missing fields so downstream consumers (sidebar, drawer,
  // evaluateSmartView) never have to defend against undefined `rules`,
  // missing `combinator`, etc. A SmartView stored before a default
  // landed will still render and edit cleanly.
  return {
    id: view.id ?? '',
    name: view.name ?? '',
    icon: view.icon,
    resource: view.resource ?? 'dashboard',
    rules: Array.isArray(view.rules) ? view.rules : [],
    combinator: view.combinator ?? 'all',
    ordering: typeof view.ordering === 'number' ? view.ordering : 0,
    isShared: view.isShared,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

async function fetchSmartViews(
  resource: SmartViewResource,
): Promise<SmartView[]> {
  if (IS_LOCAL_MODE) {
    return localSmartViews
      .getAll()
      .filter(v => v?.resource === resource)
      .map(normalizeSmartView)
      .sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0));
  }
  const raw = await hdxServer(`smart-views?resource=${resource}`).json<
    Partial<SmartView>[]
  >();
  return Array.isArray(raw) ? raw.map(normalizeSmartView) : [];
}

export function useSmartViews(resource: SmartViewResource) {
  return useQuery({
    queryKey: ['smart-views', resource],
    queryFn: () => fetchSmartViews(resource),
  });
}

export function useCreateSmartView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SmartViewInput) => {
      if (IS_LOCAL_MODE) {
        return Promise.resolve(localSmartViews.create(body));
      }
      return hdxServer('smart-views', {
        method: 'POST',
        json: body,
      }).json<SmartView>();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ['smart-views', vars.resource],
      });
    },
  });
}

export function useUpdateSmartView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<SmartViewInput>;
    }) => {
      if (IS_LOCAL_MODE) {
        return Promise.resolve(localSmartViews.update(id, patch));
      }
      return hdxServer(`smart-views/${id}`, {
        method: 'PATCH',
        json: patch,
      }).json<SmartView>();
    },
    onSuccess: data => {
      queryClient.invalidateQueries({
        queryKey: ['smart-views', data.resource],
      });
    },
  });
}

export function useDeleteSmartView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      resource: _resource,
    }: {
      id: string;
      resource: SmartViewResource;
    }) => {
      if (IS_LOCAL_MODE) {
        localSmartViews.delete(id);
        return Promise.resolve();
      }
      return hdxServer(`smart-views/${id}`, { method: 'DELETE' }).json<void>();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ['smart-views', vars.resource],
      });
    },
  });
}
