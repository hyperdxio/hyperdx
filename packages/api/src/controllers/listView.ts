import {
  ListViewResource,
  ListViewWithoutId,
} from '@hyperdx/common-utils/dist/types';

import ListView, { IListView } from '@/models/listView';

export function getListViews(
  userId: string,
  teamId: string,
  resource?: ListViewResource,
) {
  const filter: Record<string, unknown> = { owner: userId, team: teamId };
  if (resource) filter.resource = resource;
  return ListView.find(filter).sort({ ordering: 1, createdAt: 1 });
}

export function getListView(id: string, userId: string, teamId: string) {
  return ListView.findOne({ _id: id, owner: userId, team: teamId });
}

export function createListView(
  userId: string,
  teamId: string,
  view: ListViewWithoutId,
) {
  return ListView.create({
    ...view,
    owner: userId,
    team: teamId,
  });
}

export function updateListView(
  id: string,
  userId: string,
  teamId: string,
  patch: Partial<ListViewWithoutId>,
) {
  return ListView.findOneAndUpdate(
    { _id: id, owner: userId, team: teamId },
    patch,
    { new: true },
  );
}

export function deleteListView(id: string, userId: string, teamId: string) {
  return ListView.deleteOne({ _id: id, owner: userId, team: teamId });
}

export type ListViewExport = IListView;
