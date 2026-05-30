import {
  SmartView as SmartViewBase,
  SmartViewResource,
} from '@hyperdx/common-utils/dist/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hdxServer } from './api';

export type SmartView = SmartViewBase & {
  createdAt?: string;
  updatedAt?: string;
};

export type SmartViewInput = Omit<SmartView, 'id' | 'createdAt' | 'updatedAt'>;

export function useSmartViews(resource: SmartViewResource) {
  return useQuery({
    queryKey: ['smart-views', resource],
    queryFn: () =>
      hdxServer(`smart-views?resource=${resource}`).json<SmartView[]>(),
  });
}

export function useCreateSmartView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SmartViewInput) =>
      hdxServer('smart-views', {
        method: 'POST',
        json: body,
      }).json<SmartView>(),
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
    }) =>
      hdxServer(`smart-views/${id}`, {
        method: 'PATCH',
        json: patch,
      }).json<SmartView>(),
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      resource,
    }: {
      id: string;
      resource: SmartViewResource;
    }) => hdxServer(`smart-views/${id}`, { method: 'DELETE' }).json<void>(),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ['smart-views', vars.resource],
      });
    },
  });
}
