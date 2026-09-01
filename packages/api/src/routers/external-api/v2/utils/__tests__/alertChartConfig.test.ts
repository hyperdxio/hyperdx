import { DisplayType, MetricsDataType } from '@hyperdx/common-utils/dist/types';

import {
  convertAlertChartConfigToExternal,
  convertExternalAlertChartConfigToInternal,
} from '@/routers/external-api/v2/utils/alertChartConfig';
import { ExternalAlertChartConfig } from '@/utils/zod';

describe('alertChartConfig converters', () => {
  describe('builder configs', () => {
    const externalLineConfig: ExternalAlertChartConfig = {
      displayType: 'line',
      sourceId: '65f5e4a3b9e77c001a123456',
      select: [
        {
          aggFn: 'count',
          where: 'level:error',
          whereLanguage: 'lucene',
          alias: 'Errors',
        },
        {
          aggFn: 'avg',
          valueExpression: 'Value',
          where: '',
          whereLanguage: 'lucene',
          metricType: MetricsDataType.Gauge,
          metricName: 'system.cpu.utilization',
          periodAggFn: 'delta',
        },
      ],
      groupBy: 'ServiceName',
      asRatio: true,
      fillNulls: false,
      seriesLimit: 5,
      numberFormat: { output: 'number', mantissa: 2 },
    };

    it('maps the external dialect onto the internal AlertChartConfig', () => {
      const internal =
        convertExternalAlertChartConfigToInternal(externalLineConfig);

      expect(internal).toMatchObject({
        displayType: DisplayType.Line,
        source: '65f5e4a3b9e77c001a123456',
        groupBy: 'ServiceName',
        seriesReturnType: 'ratio',
        fillNulls: false,
        seriesLimit: 5,
        select: [
          {
            aggFn: 'count',
            aggCondition: 'level:error',
            aggConditionLanguage: 'lucene',
            alias: 'Errors',
            isDelta: false,
          },
          {
            aggFn: 'avg',
            valueExpression: 'Value',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            metricType: MetricsDataType.Gauge,
            metricName: 'system.cpu.utilization',
            isDelta: true,
          },
        ],
      });
    });

    it('never persists the synthetic tile name or an embedded alert', () => {
      const internal =
        convertExternalAlertChartConfigToInternal(externalLineConfig);

      // The tile converter writes the synthetic tile's name ('') into the
      // config; persisting it would attach junk to every alert document.
      expect(internal).not.toHaveProperty('name');
      expect(internal).not.toHaveProperty('alert');
    });

    it('round-trips external -> internal -> external without losing fields', () => {
      const internal =
        convertExternalAlertChartConfigToInternal(externalLineConfig);
      const roundTripped = convertAlertChartConfigToExternal(internal);

      expect(roundTripped).toMatchObject({
        displayType: 'line',
        sourceId: '65f5e4a3b9e77c001a123456',
        groupBy: 'ServiceName',
        asRatio: true,
        fillNulls: false,
        seriesLimit: 5,
        numberFormat: { output: 'number', mantissa: 2 },
        select: [
          {
            aggFn: 'count',
            where: 'level:error',
            whereLanguage: 'lucene',
            alias: 'Errors',
          },
          {
            aggFn: 'avg',
            valueExpression: 'Value',
            where: '',
            whereLanguage: 'lucene',
            metricType: MetricsDataType.Gauge,
            metricName: 'system.cpu.utilization',
            periodAggFn: 'delta',
          },
        ],
      });
    });

    it('converts internal stacked_bar and number configs to the external dialect', () => {
      const stackedBar = convertAlertChartConfigToExternal({
        displayType: DisplayType.StackedBar,
        source: '65f5e4a3b9e77c001a123456',
        select: [
          {
            aggFn: 'count',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: '',
          },
        ],
        where: '',
      });
      expect(stackedBar).toMatchObject({
        displayType: 'stacked_bar',
        sourceId: '65f5e4a3b9e77c001a123456',
      });

      const number = convertAlertChartConfigToExternal({
        displayType: DisplayType.Number,
        source: '65f5e4a3b9e77c001a123456',
        select: [
          {
            aggFn: 'count',
            aggCondition: 'level:error',
            aggConditionLanguage: 'lucene',
            valueExpression: '',
          },
        ],
        where: '',
        numberFormat: { output: 'percent' },
      });
      expect(number).toMatchObject({
        displayType: 'number',
        sourceId: '65f5e4a3b9e77c001a123456',
        numberFormat: { output: 'percent' },
        select: [{ aggFn: 'count', where: 'level:error' }],
      });
    });
  });

  describe('raw SQL configs', () => {
    const externalRawSqlConfig: ExternalAlertChartConfig = {
      configType: 'sql',
      displayType: 'line',
      connectionId: '65f5e4a3b9e77c001a789012',
      sqlTemplate:
        'SELECT $__timeInterval(Timestamp) AS ts, count() FROM t WHERE $__timeFilter(Timestamp) GROUP BY ts',
      sourceId: '65f5e4a3b9e77c001a123456',
      fillNulls: false,
      seriesLimit: 3,
    };

    it('maps external field names onto the internal ones', () => {
      const internal =
        convertExternalAlertChartConfigToInternal(externalRawSqlConfig);

      expect(internal).toMatchObject({
        configType: 'sql',
        displayType: DisplayType.Line,
        connection: '65f5e4a3b9e77c001a789012',
        source: '65f5e4a3b9e77c001a123456',
        fillNulls: false,
        seriesLimit: 3,
      });
      expect(internal).not.toHaveProperty('connectionId');
      expect(internal).not.toHaveProperty('sourceId');
      expect(internal).not.toHaveProperty('name');
    });

    it('round-trips external -> internal -> external', () => {
      const internal =
        convertExternalAlertChartConfigToInternal(externalRawSqlConfig);
      const roundTripped = convertAlertChartConfigToExternal(internal);

      expect(roundTripped).toMatchObject({
        configType: 'sql',
        displayType: 'line',
        connectionId: '65f5e4a3b9e77c001a789012',
        sqlTemplate: externalRawSqlConfig.sqlTemplate,
        sourceId: '65f5e4a3b9e77c001a123456',
        fillNulls: false,
        seriesLimit: 3,
      });
    });
  });

  describe('configs without an external representation', () => {
    it('returns undefined for a corrupt config with an unsupported display type', () => {
      // Reachable only via a direct DB write: both write paths reject
      // non-alertable display types, but a Mixed Mongo field enforces
      // nothing. The translate layer omits the field rather than emitting
      // a shape the external contract cannot express.
      const external = convertAlertChartConfigToExternal({
        displayType: DisplayType.Table,
        source: '65f5e4a3b9e77c001a123456',
        select: [
          {
            aggFn: 'count',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: '',
          },
        ],
        where: '',
      });

      expect(external).toBeUndefined();
    });
  });
});
