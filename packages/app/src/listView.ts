import {
  ListView as ListViewBase,
  ListViewResource,
} from '@hyperdx/common-utils/dist/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hdxServer } from './api';
import { IS_LOCAL_MODE } from './config';
import { createEntityStore } from './localStore';

export type ListView = ListViewBase & {
  createdAt?: string;
  updatedAt?: string;
};

export type ListViewInput = Omit<ListView, 'id' | 'createdAt' | 'updatedAt'>;

// Local-mode storage mirrors the favorites + dashboards pattern; the
// Vercel preview deployments and standalone `IS_LOCAL_MODE` builds have
// no `/list-views` backend, so all CRUD goes through localStorage and
// React Query never tries to hit the API.
const localListViews = createEntityStore<ListView>('hdx-local-list-views');

function normalizeListView(view: Partial<ListView>): ListView {
  // Coerce any missing fields so downstream consumers (sidebar, drawer,
  // evaluateListView) never have to defend against undefined `rules`,
  // missing `combinator`, etc. A ListView stored before a default
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

async function fetchListViews(resource: ListViewResource): Promise<ListView[]> {
  if (IS_LOCAL_MODE) {
    return localListViews
      .getAll()
      .filter(v => v?.resource === resource)
      .map(normalizeListView)
      .sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0));
  }
  const raw = await hdxServer(`list-views?resource=${resource}`).json<
    Partial<ListView>[]
  >();
  return Array.isArray(raw) ? raw.map(normalizeListView) : [];
}

export function useListViews(resource: ListViewResource) {
  return useQuery({
    queryKey: ['list-views', resource],
    queryFn: () => fetchListViews(resource),
  });
}

export function useCreateListView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ListViewInput) => {
      if (IS_LOCAL_MODE) {
        return Promise.resolve(localListViews.create(body));
      }
      return hdxServer('list-views', {
        method: 'POST',
        json: body,
      }).json<ListView>();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ['list-views', vars.resource],
      });
    },
  });
}

export function useUpdateListView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<ListViewInput>;
    }) => {
      if (IS_LOCAL_MODE) {
        return Promise.resolve(localListViews.update(id, patch));
      }
      return hdxServer(`list-views/${id}`, {
        method: 'PATCH',
        json: patch,
      }).json<ListView>();
    },
    onSuccess: data => {
      queryClient.invalidateQueries({
        queryKey: ['list-views', data.resource],
      });
    },
  });
}

export function useDeleteListView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      resource: _resource,
    }: {
      id: string;
      resource: ListViewResource;
    }) => {
      if (IS_LOCAL_MODE) {
        localListViews.delete(id);
        return Promise.resolve();
      }
      return hdxServer(`list-views/${id}`, { method: 'DELETE' }).json<void>();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ['list-views', vars.resource],
      });
    },
  });
}
