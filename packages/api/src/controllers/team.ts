import { v4 as uuidv4 } from 'uuid';

import * as config from '@/config';
import type { ObjectId } from '@/models';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import Team from '@/models/team';

const LOCAL_APP_TEAM_ID = '_local_team_';
const LOCAL_APP_TEAM = {
  _id: LOCAL_APP_TEAM_ID,
  id: LOCAL_APP_TEAM_ID,
  name: 'Local App Team',
  // Placeholder keys
  hookId: uuidv4(),
  apiKey: uuidv4(),
  toJSON() {
    return this;
  },
};

export async function isTeamExisting() {
  if (config.IS_LOCAL_APP_MODE) {
    return true;
  }

  const teamCount = await Team.countDocuments({});
  return teamCount > 0;
}

export async function createTeam({ name }: { name: string }) {
  if (await isTeamExisting()) {
    throw new Error('Team already exists');
  }

  const team = new Team({ name });

  await team.save();

  return team;
}

export function getTeam(id: string | ObjectId, fields?: string[]) {
  if (config.IS_LOCAL_APP_MODE) {
    return LOCAL_APP_TEAM;
  }

  return Team.findById(id, fields);
}

export function getTeamByApiKey(apiKey: string) {
  if (config.IS_LOCAL_APP_MODE) {
    return LOCAL_APP_TEAM;
  }

  return Team.findOne({ apiKey });
}

export function rotateTeamApiKey(teamId: ObjectId) {
  return Team.findByIdAndUpdate(teamId, { apiKey: uuidv4() }, { new: true });
}

export function setTeamName(teamId: ObjectId, name: string) {
  return Team.findByIdAndUpdate(teamId, { name }, { new: true });
}

export async function getTags(teamId: ObjectId) {
  const [dashboardTags, savedSearchTags] = await Promise.all([
    Dashboard.aggregate([
      { $match: { team: teamId } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags' } },
    ]),
    SavedSearch.aggregate([
      { $match: { team: teamId } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags' } },
    ]),
  ]);

  return [
    ...new Set([
      ...dashboardTags.map(t => t._id),
      ...savedSearchTags.map(t => t._id),
    ]),
  ];
}
