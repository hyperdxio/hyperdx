const { v4: uuidv4 } = require('uuid');

module.exports = {
  async up(db, client) {
    await db
      .collection('users')
      .updateMany({}, { $set: { accessKey: uuidv4() } });
  },
  async down(db, client) {
    await db.collection('users').updateMany({}, { $unset: { accessKey: '' } });
  },
};
