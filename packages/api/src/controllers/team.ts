import { TeamClickHouseSettings } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

import * as config from '@/config';
import type { ObjectId } from '@/models';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import Team from '@/models/team';

const LOCAL_APP_TEAM_ID = '000000000000000000000001';
export const LOCAL_APP_TEAM = {
  _id: new mongoose.Types.ObjectId(LOCAL_APP_TEAM_ID),
  id: LOCAL_APP_TEAM_ID,
  name: 'Local App Team',
  // Placeholder keys
  hookId: uuidv4(),
  apiKey: uuidv4(),
  collectorAuthenticationEnforced: false,
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

export async function createTeam({
  name,
  collectorAuthenticationEnforced = true,
}: {
  name: string;
  collectorAuthenticationEnforced?: boolean;
}) {
  if (await isTeamExisting()) {
    throw new Error('Team already exists');
  }

  const team = new Team({ name, collectorAuthenticationEnforced });

  await team.save();

  return team;
}

export function getAllTeams(fields?: string[]) {
  if (config.IS_LOCAL_APP_MODE) {
    return [LOCAL_APP_TEAM];
  }

  return Team.find({}, fields);
}

export function getTeam(id?: string | ObjectId, fields?: string[]) {
  if (config.IS_LOCAL_APP_MODE) {
    return LOCAL_APP_TEAM;
  }

  return Team.findOne({}, fields);
}

export function getTeamByApiKey(apiKey: string) {
  if (config.IS_LOCAL_APP_MODE) {
    return LOCAL_APP_TEAM;
  }

  return Team.findOne({ apiKey });
}

export function rotateTeamApiKey(teamId: ObjectId) {
  return Team.findByIdAndUpdate(teamId, { apiKey: uuidv4() }, { returnDocument: 'after' });
}

export function setTeamName(teamId: ObjectId, name: string) {
  return Team.findByIdAndUpdate(teamId, { name }, { returnDocument: 'after' });
}

export function updateTeamClickhouseSettings(
  teamId: ObjectId,
  settings: TeamClickHouseSettings,
) {
  return Team.findByIdAndUpdate(teamId, settings, { returnDocument: 'after' });
}

export async function getTags(teamId: ObjectId) {
  const [dashboards, savedSearches] = await Promise.all([
    Dashboard.find({ team: teamId }, { tags: 1 }).lean(),
    SavedSearch.find({ team: teamId }, { tags: 1 }).lean(),
  ]);

  const tagSet = new Set<string>();
  for (const d of dashboards) {
    for (const tag of d.tags ?? []) tagSet.add(tag);
  }
  for (const s of savedSearches) {
    for (const tag of s.tags ?? []) tagSet.add(tag);
  }
  return [...tagSet];
}
