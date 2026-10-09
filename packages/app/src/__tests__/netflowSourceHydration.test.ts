import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import {
  DisplayType,
  SourceKind,
  TNetflowSource,
} from '@hyperdx/common-utils/dist/types';

import { buildAlertChartConfig } from '@/components/alerts/AlertDetailChart';
import { convertFormStateToChartConfig } from '@/components/ChartEditor/utils';
import { buildReleaseChartConfig } from '@/hooks/useReleaseAnnotations';
import { pickSourceConfigFields } from '@/ServicesDashboardPage/helpers';

const source: TNetflowSource = {
  id: 'flows',
  name: 'Flows',
  kind: SourceKind.Netflow,
  connection: 'local',
  from: { databaseName: 'default', tableName: 'flows' },
  timestampValueExpression: 'TimeReceived',
  defaultTableSelectExpression: '*',
  bytesExpression: 'Bytes',
  packetsExpression: 'Packets',
  srcAddrExpression: 'ClientIP',
  dstAddrExpression: 'ServerIP',
  srcPortExpression: 'ClientPort',
  dstPortExpression: 'ServerPort',
  protocolExpression: 'ProtocolNumber',
  exporterExpression: 'RouterName',
};
const dateRange: [Date, Date] = [new Date(0), new Date(60000)];
const select = [{ valueExpression: 'sum(Bytes)' }];

describe.each([undefined, 'SearchText'])(
  'NetFlow full-text hydration with override %s',
  implicitColumnExpression => {
    const selectedSource = { ...source, implicitColumnExpression };
    const expected =
      implicitColumnExpression ?? expect.stringContaining('toString(ClientIP)');

    it('carries the search mapping through generic source field projection', () => {
      expect(pickSourceConfigFields(selectedSource)).toMatchObject({
        implicitColumnExpression: expected,
      });
    });

    it.each(['sql', 'builder'] as const)(
      'carries the search mapping into %s chart editor previews',
      configType => {
        const config = convertFormStateToChartConfig(
          {
            configType,
            displayType: DisplayType.Line,
            source: source.id,
            connection: source.connection,
            where: 'edge',
            whereLanguage: 'lucene',
            series: select,
            sqlTemplate: 'SELECT sum(Bytes) FROM flows WHERE $where',
          },
          dateRange,
          selectedSource,
        );
        expect(config).toMatchObject({ implicitColumnExpression: expected });
      },
    );

    it.each(['sql', 'builder'] as const)(
      'carries the search mapping into %s saved alert charts',
      configType => {
        const savedConfig =
          configType === 'sql'
            ? {
                configType: 'sql' as const,
                displayType: DisplayType.Line,
                source: source.id,
                connection: source.connection,
                sqlTemplate: 'SELECT sum(Bytes) FROM flows WHERE $where',
              }
            : {
                displayType: DisplayType.Line,
                source: source.id,
                select,
                where: 'edge',
                whereLanguage: 'lucene' as const,
              };
        const config = buildAlertChartConfig({
          savedConfig,
          source: selectedSource,
          dateRange,
          granularity: Granularity.OneMinute,
          variables: [],
        });
        expect(config).toMatchObject({ implicitColumnExpression: expected });
      },
    );

    it('carries the search mapping into release queries scoped by bare Lucene terms', () => {
      const config = buildReleaseChartConfig(
        selectedSource,
        'Version',
        dateRange,
        { where: 'edge', whereLanguage: 'lucene' },
      );
      expect(config).toMatchObject({
        implicitColumnExpression: expected,
        filters: [{ type: 'lucene', condition: 'edge' }],
      });
    });
  },
);
