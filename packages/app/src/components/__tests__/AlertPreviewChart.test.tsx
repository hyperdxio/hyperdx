import { ALERT_COUNT_DEFAULT_SELECT } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  AlertThresholdType,
  SourceKind,
  TNetflowSource,
} from '@hyperdx/common-utils/dist/types';

import { AlertPreviewChart } from '@/components/AlertPreviewChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import { useAliasMapFromChartConfig } from '@/hooks/useChartConfig';

jest.mock('@/components/DBTimeChart', () => ({
  DBTimeChart: jest.fn(() => null),
}));
jest.mock('@/hooks/useChartConfig', () => ({
  useAliasMapFromChartConfig: jest.fn(() => ({
    data: { exporter: 'toString(ExporterName)' },
  })),
}));

const source: TNetflowSource = {
  id: 'flows',
  name: 'Flows',
  kind: SourceKind.Netflow,
  connection: 'local',
  from: { databaseName: 'default', tableName: 'flows' },
  timestampValueExpression: 'TimeReceived',
  defaultTableSelectExpression:
    'TimeReceived, toString(ExporterName) AS exporter',
  bytesExpression: 'Bytes',
  packetsExpression: 'Packets',
  srcAddrExpression: 'SrcAddr',
  dstAddrExpression: 'DstAddr',
  srcPortExpression: 'SrcPort',
  dstPortExpression: 'DstPort',
  protocolExpression: 'Proto',
};

describe('NetFlow alert preview aliases', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([undefined, '   '])(
    'resolves source aliases when the saved search has no select (%s)',
    select => {
      renderWithMantine(
        <AlertPreviewChart
          source={source}
          select={select}
          where="exporter = 'edge-a'"
          whereLanguage="sql"
          interval="5m"
          thresholdType={AlertThresholdType.ABOVE}
          threshold={10}
        />,
      );
      expect(useAliasMapFromChartConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          select: source.defaultTableSelectExpression,
          where: "exporter = 'edge-a'",
          from: source.from,
        }),
      );
      expect(DBTimeChart).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            select: ALERT_COUNT_DEFAULT_SELECT,
            where: "exporter = 'edge-a'",
            timestampValueExpression: 'TimeReceived',
            with: [
              {
                name: 'exporter',
                sql: { sql: 'toString(ExporterName)', params: {} },
                isSubquery: false,
              },
            ],
          }),
        }),
        undefined,
      );
    },
  );

  it('honors an explicit saved search select over source defaults', () => {
    renderWithMantine(
      <AlertPreviewChart
        source={source}
        select="SrcAddr AS address"
        interval="5m"
        thresholdType={AlertThresholdType.ABOVE}
        threshold={10}
      />,
    );
    expect(useAliasMapFromChartConfig).toHaveBeenCalledWith(
      expect.objectContaining({ select: 'SrcAddr AS address' }),
    );
  });
});
