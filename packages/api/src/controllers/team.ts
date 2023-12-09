import { v4 as uuidv4 } from 'uuid';

import * as config from '@/config';
import Team from '@/models/team';

import type { ObjectId } from '@/models';

const LOCAL_APP_TEAM = {
  _id: '_local_team_',
  name: 'Local App Team',
  // Placeholder keys
  hookId: uuidv4(),
  apiKey: uuidv4(),
  logStreamTableVersion: 1,
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

export function getTeam(id: string | ObjectId) {
  if (config.IS_LOCAL_APP_MODE) {
    return LOCAL_APP_TEAM;
  }

  return Team.findById(id);
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
