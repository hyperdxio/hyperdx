import { ISource, Source } from '@/models/source';

export function getSources(team: string) {
  return Source.find({ team });
}

export function getSource(team: string, sourceId: string) {
  return Source.findOne({ _id: sourceId, team });
}

export function createSource(team: string, source: Omit<ISource, 'id'>) {
  return Source.create({ ...source, team });
}

export function updateSource(
  team: string,
  sourceId: string,
  source: Omit<ISource, 'id'>,
) {
  return Source.findOneAndUpdate({ _id: sourceId, team }, source, {
    new: true,
  });
}

export function deleteSource(team: string, sourceId: string) {
  return Source.findOneAndDelete({ _id: sourceId, team });
}
