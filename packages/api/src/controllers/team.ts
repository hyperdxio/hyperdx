import { v4 as uuidv4 } from 'uuid';

import Team from '../models/team';

import type { ObjectId } from '../models';

export async function isTeamExisting() {
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
  return Team.findById(id);
}

export function getTeamByApiKey(apiKey: string) {
  return Team.findOne({ apiKey });
}

export function rotateTeamApiKey(teamId: ObjectId) {
  return Team.findByIdAndUpdate(teamId, { apiKey: uuidv4() }, { new: true });
}
