import { SourceKind } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import { createSource, getSource, updateSource } from '@/controllers/sources';
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

  it('creates and updates native NetFlow mappings without losing fields', async () => {
    const team = new mongoose.Types.ObjectId().toString();
    const input = {
      team,
      kind: SourceKind.Netflow as const,
      name: 'Flows',
      connection: new mongoose.Types.ObjectId().toString(),
      from: { databaseName: 'default', tableName: 'flows' },
      timestampValueExpression: 'TimeReceived',
      defaultTableSelectExpression: 'SrcAddr, DstAddr',
      bytesExpression: 'Bytes',
      packetsExpression: 'Packets',
      samplingRateExpression: 'SamplingRate',
      srcAddrExpression: 'SrcAddr',
      dstAddrExpression: 'DstAddr',
      srcPortExpression: 'SrcPort',
      dstPortExpression: 'DstPort',
      protocolExpression: 'Proto',
      exporterExpression: 'ExporterName',
      inIfExpression: 'InIfName',
      outIfExpression: 'OutIfName',
    };
    const created = await createSource(team, input);
    expect(created).toBeTruthy();
    const updated = await updateSource(team, String(created!._id), {
      ...input,
      bytesExpression: 'octets',
    });
    expect(updated?.get('bytesExpression')).toBe('octets');
    expect(updated?.get('samplingRateExpression')).toBe('SamplingRate');
    expect(updated?.get('outIfExpression')).toBe('OutIfName');
    expect(
      await getSource(
        new mongoose.Types.ObjectId().toString(),
        String(created!._id),
      ),
    ).toBeNull();
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
