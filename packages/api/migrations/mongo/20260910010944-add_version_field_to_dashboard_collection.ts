import { Db, MongoClient } from 'mongodb';

module.exports = {
  async up(db: Db, _client: MongoClient) {
    await db
      .collection('dashboards')
      .updateMany({ version: { $exists: false } }, { $set: { version: 0 } });
  },
  async down(db: Db, _client: MongoClient) {
    await db
      .collection('dashboards')
      .updateMany({}, { $unset: { version: '' } });
  },
};
