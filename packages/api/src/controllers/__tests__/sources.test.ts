import mongoose from 'mongoose';

import { getSource } from '@/controllers/sources';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';

describe('sources controller', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await closeDB();
  });

  describe('getSource', () => {
    it('returns null when sourceId is not a valid ObjectId', async () => {
      // Non-ObjectId strings used to bubble a Mongoose CastError up
      // through MCP tools as "Cast to ObjectId failed for value ...".
      // The wrapper now short-circuits before hitting MongoDB so the
      // caller's not-found branch fires cleanly.
      const team = new mongoose.Types.ObjectId().toString();

      expect(await getSource(team, 'not-an-objectid')).toBeNull();
      expect(await getSource(team, '')).toBeNull();
      expect(await getSource(team, '   ')).toBeNull();
    });

    it('returns null for a well-formed but missing ObjectId', async () => {
      const team = new mongoose.Types.ObjectId().toString();
      const missingSourceId = new mongoose.Types.ObjectId().toString();

      expect(await getSource(team, missingSourceId)).toBeNull();
    });
  });
});
