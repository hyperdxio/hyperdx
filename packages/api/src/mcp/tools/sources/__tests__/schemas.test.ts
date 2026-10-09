import { SourceKind, SourceSchemaNoId } from '@hyperdx/common-utils/dist/types';

import {
  buildSourceInput,
  extractSourceConfig,
  mcpSaveSourceSchema,
} from '@/mcp/tools/sources/schemas';

const mappings = {
  bytesExpression: 'Bytes',
  packetsExpression: 'Packets',
  srcAddrExpression: 'SrcAddr',
  dstAddrExpression: 'DstAddr',
  srcPortExpression: 'SrcPort',
  dstPortExpression: 'DstPort',
  protocolExpression: 'Proto',
  samplingRateExpression: 'SamplingRate',
  exporterExpression: 'ExporterName',
  inIfExpression: 'InIfName',
  outIfExpression: 'OutIfName',
};
const input = {
  kind: 'netflow',
  name: 'Network traffic',
  connection: 'connection-id',
  databaseName: 'akvorado',
  tableName: 'flows',
  timestampValueExpression: 'TimeReceived',
  defaultTableSelectExpression: 'TimeReceived, SrcAddr, DstAddr, Bytes',
  ...mappings,
};

describe('MCP source schema', () => {
  it('exposes every canonical source kind to the MCP SDK', () => {
    expect(new Set(mcpSaveSourceSchema.shape.kind.options)).toEqual(
      new Set(Object.values(SourceKind)),
    );
  });

  it('preserves all NetFlow mappings when assembling the canonical input', () => {
    const assembled = buildSourceInput(mcpSaveSourceSchema.parse(input));
    expect(SourceSchemaNoId.parse(assembled)).toMatchObject({
      kind: SourceKind.Netflow,
      ...mappings,
      from: { databaseName: 'akvorado', tableName: 'flows' },
    });
  });

  it('round-trips all NetFlow mappings through describe and update input', () => {
    const stored = {
      ...buildSourceInput(mcpSaveSourceSchema.parse(input)),
      _id: 'source-id',
    };
    const described = extractSourceConfig(stored);
    expect(described).toEqual({ ...input, id: 'source-id' });
    const updated = mcpSaveSourceSchema.parse({
      ...described,
      name: 'Renamed',
    });
    expect(SourceSchemaNoId.parse(buildSourceInput(updated))).toMatchObject({
      name: 'Renamed',
      ...mappings,
    });
  });

  it.each([
    'bytesExpression',
    'packetsExpression',
    'srcAddrExpression',
    'dstAddrExpression',
    'srcPortExpression',
    'dstPortExpression',
    'protocolExpression',
  ])('keeps canonical NetFlow validation for missing %s', field => {
    const parsed = mcpSaveSourceSchema.parse({ ...input, [field]: undefined });
    expect(SourceSchemaNoId.safeParse(buildSourceInput(parsed)).success).toBe(
      false,
    );
  });
});
