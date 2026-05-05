import { Db, MongoClient } from 'mongodb';

/**
 * Add a default `role: 'admin'` field to every existing user. Berg keeps
 * permissions flat (team isolation only) for v1; the role field is a
 * Phase 2 hook so write-classification can be wired in later without
 * another migration round-trip.
 */
module.exports = {
  async up(db: Db, _client: MongoClient) {
    await db
      .collection('users')
      .updateMany({ role: { $exists: false } }, { $set: { role: 'admin' } });
  },

  async down(db: Db, _client: MongoClient) {
    await db.collection('users').updateMany({}, { $unset: { role: '' } });
  },
};
