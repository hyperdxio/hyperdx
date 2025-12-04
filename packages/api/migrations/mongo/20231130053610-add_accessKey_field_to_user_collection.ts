import { Db, MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';

module.exports = {
  async up(db: Db, _client: MongoClient) {
    await db
      .collection('users')
      .updateMany({}, { $set: { accessKey: uuidv4() } });
  },
  async down(db: Db, _client: MongoClient) {
    await db.collection('users').updateMany({}, { $unset: { accessKey: '' } });
  },
};
