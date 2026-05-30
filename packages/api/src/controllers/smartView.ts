import {
  SmartViewResource,
  SmartViewWithoutId,
} from '@hyperdx/common-utils/dist/types';

import SmartView, { ISmartView } from '@/models/smartView';

export function getSmartViews(
  userId: string,
  teamId: string,
  resource?: SmartViewResource,
) {
  const filter: Record<string, unknown> = { owner: userId, team: teamId };
  if (resource) filter.resource = resource;
  return SmartView.find(filter).sort({ ordering: 1, createdAt: 1 });
}

export function getSmartView(id: string, userId: string, teamId: string) {
  return SmartView.findOne({ _id: id, owner: userId, team: teamId });
}

export function createSmartView(
  userId: string,
  teamId: string,
  view: SmartViewWithoutId,
) {
  return SmartView.create({
    ...view,
    owner: userId,
    team: teamId,
  });
}

export function updateSmartView(
  id: string,
  userId: string,
  teamId: string,
  patch: Partial<SmartViewWithoutId>,
) {
  return SmartView.findOneAndUpdate(
    { _id: id, owner: userId, team: teamId },
    patch,
    { new: true },
  );
}

export function deleteSmartView(id: string, userId: string, teamId: string) {
  return SmartView.deleteOne({ _id: id, owner: userId, team: teamId });
}

export type SmartViewExport = ISmartView;
