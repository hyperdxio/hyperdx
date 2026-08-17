import * as config from '@/config';
import {
  createTeam,
  getTeam,
  getTeamByApiKey,
  getTeamInviteUrl,
} from '@/controllers/team';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import Team from '@/models/team';

describe('getTeamInviteUrl', () => {
  it('builds the join-team URL for a token', () => {
    expect(getTeamInviteUrl('abc123')).toBe(
      `${config.FRONTEND_URL}/join-team?token=abc123`,
    );
  });
});

describe('team controller', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await closeDB();
  });

  it('createTeam + getTeam', async () => {
    const team = await createTeam({ name: 'My Team' });

    expect(team.name).toBe('My Team');

    team.apiKey = 'apiKey';

    await team.save();

    const otherTeam = await Team.create({ name: 'Other Team' });

    expect(await getTeam(team._id)).toBeTruthy();
    expect((await getTeam(otherTeam._id))?._id.toString()).toBe(
      otherTeam._id.toString(),
    );
    expect(await getTeamByApiKey('apiKey')).toBeTruthy();
  });
});
