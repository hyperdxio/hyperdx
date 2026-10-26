import { useQuery } from '@tanstack/react-query';

import { hdxServer } from '@/api';

import type { IncidentDetail, IncidentGraphResponse, Playbook } from './types';

// Carries the status and the API's message, which explains 412 setup problems.
export class KnowledgeRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await hdxServer(url, { throwHttpErrors: false });
  if (!res.ok) {
    const body: { message?: string } = await res.json().catch(() => ({}));
    throw new KnowledgeRequestError(
      res.status,
      body.message ?? `Request failed with status ${res.status}`,
    );
  }
  return res.json();
}

export function useIncidentGraph() {
  return useQuery<IncidentGraphResponse, KnowledgeRequestError>({
    queryKey: ['knowledge', 'graph'],
    queryFn: () => getJson('knowledge/graph'),
    retry: false,
  });
}

export function usePlaybook(incidentId: string) {
  return useQuery<Playbook, KnowledgeRequestError>({
    queryKey: ['knowledge', 'playbook', incidentId],
    queryFn: () => getJson(`knowledge/incidents/${incidentId}/playbook`),
    retry: false,
  });
}

export function useIncidentDetail(incidentId: string | undefined) {
  return useQuery<IncidentDetail, KnowledgeRequestError>({
    queryKey: ['knowledge', 'incident', incidentId],
    queryFn: () => getJson(`knowledge/incidents/${incidentId}`),
    enabled: !!incidentId,
    retry: false,
  });
}
