import { createTeam } from '@/controllers/team';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import Team from '@/models/team';

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

  it('does not query for non-existent properties', async () => {
    const team = await createTeam({ name: 'My Team' });

    expect(await Team.find({ name: 'My Team' })).toHaveLength(1);
    expect(await Team.find({ fakeProperty: 'please' })).toHaveLength(0);
  });
});
