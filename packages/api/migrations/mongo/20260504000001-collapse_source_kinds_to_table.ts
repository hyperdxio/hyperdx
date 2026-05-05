import { Db, MongoClient } from 'mongodb';

/**
 * Collapse the four legacy Source kinds (Log/Trace/Session/Metric) into the
 * single Berg `Table` kind. Drops the `connections` collection that backed
 * the now-deleted Connection model.
 *
 * For fresh installs this is a no-op; for upgrades it best-effort maps the
 * old `from.databaseName`/`from.tableName` fields onto the new
 * `database`/`table` columns and synthesises `catalog`/`displayName` defaults.
 */
module.exports = {
  async up(db: Db, _client: MongoClient) {
    await db.collection('sources').updateMany(
      { kind: { $in: ['log', 'trace', 'session', 'metric'] } },
      [
        {
          $set: {
            kind: 'Table',
            catalog: 'AwsDataCatalog',
            database: { $ifNull: ['$from.databaseName', 'default'] },
            table: { $ifNull: ['$from.tableName', 'unknown'] },
            displayName: { $ifNull: ['$name', 'Untitled'] },
          },
        },
      ],
    );

    // Drop legacy fields that are no longer part of the Source schema.
    await db.collection('sources').updateMany(
      {},
      {
        $unset: {
          connection: '',
          from: '',
          timestampValueExpression: '',
          defaultTableSelectExpression: '',
          implicitColumnExpression: '',
          tableFilterExpression: '',
          serviceNameExpression: '',
          severityTextExpression: '',
          bodyExpression: '',
          eventAttributesExpression: '',
          resourceAttributesExpression: '',
          displayedTimestampValueExpression: '',
          metricSourceId: '',
          traceSourceId: '',
          logSourceId: '',
          sessionSourceId: '',
          traceIdExpression: '',
          spanIdExpression: '',
          parentSpanIdExpression: '',
          spanNameExpression: '',
          spanKindExpression: '',
          durationExpression: '',
          durationPrecision: '',
          sampleRateExpression: '',
          statusCodeExpression: '',
          statusMessageExpression: '',
          spanEventsValueExpression: '',
          uniqueRowIdExpression: '',
          orderByExpression: '',
          highlightedTraceAttributeExpressions: '',
          highlightedRowAttributeExpressions: '',
          metricTables: '',
          materializedViews: '',
        },
      },
    );

    // Drop the connections collection — Berg auths to Athena via pod IRSA
    // and pulls all Athena config from environment variables.
    try {
      await db.collection('connections').drop();
    } catch (e) {
      // Collection may not exist on fresh installs; that's fine.
    }
  },

  async down(_db: Db, _client: MongoClient) {
    throw new Error('Down migration not supported.');
  },
};
