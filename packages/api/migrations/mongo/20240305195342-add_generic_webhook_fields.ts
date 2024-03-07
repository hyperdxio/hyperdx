import { Db, MongoClient } from 'mongodb';

module.exports = {
  async up(db: Db, client: MongoClient) {
    await db
      .collection('webhooks')
      .updateMany({}, { $set: { description: '' } });

    await db
      .collection('webhooks')
      .updateMany({}, { $set: { queryParams: null } });
    await db.collection('webhooks').updateMany({}, { $set: { headers: null } });
    await db.collection('webhooks').updateMany({}, { $set: { body: null } });
  },
  async down(db: Db, client: MongoClient) {
    await db
      .collection('webhooks')
      .updateMany({}, { $unset: { description: '' } });
    await db
      .collection('webhooks')
      .updateMany({}, { $unset: { queryParams: null } });
    await db
      .collection('webhooks')
      .updateMany({}, { $unset: { headers: null } });
    await db.collection('webhooks').updateMany({}, { $unset: { body: null } });
  },
};
