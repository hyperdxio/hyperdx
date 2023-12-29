import * as clickhouse from '@/clickhouse';
import {
  LogsPropertyTypeMappingsModel,
  MetricsPropertyTypeMappingsModel,
} from '@/clickhouse/propertyTypeMappingsModel';

import { LogPlatform, LogStreamModel, LogType, MetricModel } from './logParser';

export function buildEvent({
  level,
  source = 'test',
  timestamp,
  platform = LogPlatform.NodeJS,
  type = LogType.Log,
  end_timestamp = 0,
  span_name,
  ...properties
}: {
  level?: string;
  source?: string;
  timestamp?: number; // ms timestamp
  platform?: LogPlatform;
  type?: LogType;
  end_timestamp?: number; //ms timestamp
  span_name?: string;
} & {
  [key: string]: number | string | boolean;
}): LogStreamModel {
  const ts = timestamp ?? Date.now();

  const boolNames: string[] = [];
  const boolValues: number[] = [];
  const numberNames: string[] = [];
  const numberValues: number[] = [];
  const stringNames: string[] = [];
  const stringValues: string[] = [];

  Object.entries(properties).forEach(([key, value]) => {
    if (typeof value === 'boolean') {
      boolNames.push(key);
      boolValues.push(value ? 1 : 0);
    } else if (typeof value === 'number') {
      numberNames.push(key);
      numberValues.push(value);
    } else if (typeof value === 'string') {
      stringNames.push(key);
      stringValues.push(value);
    }
  });

  return {
    // TODO: Fix Timestamp Types
    // @ts-ignore
    timestamp: `${ts}000000`,
    // @ts-ignore
    observed_timestamp: `${ts}000000`,
    _source: source,
    _platform: platform,
    severity_text: level,
    // @ts-ignore
    end_timestamp: `${end_timestamp}000000`,
    type,
    span_name,
    'bool.names': boolNames,
    'bool.values': boolValues,
    'number.names': numberNames,
    'number.values': numberValues,
    'string.names': stringNames,
    'string.values': stringValues,
  };
}

export function buildMetricSeries({
  tags,
  name,
  points,
  data_type,
  is_delta,
  is_monotonic,
  unit,
}: {
  tags: Record<string, string>;
  name: string;
  points: { value: number; timestamp: number }[];
  data_type: clickhouse.MetricsDataType;
  is_monotonic: boolean;
  is_delta: boolean;
  unit: string;
}): MetricModel[] {
  // @ts-ignore TODO: Fix Timestamp types
  return points.map(({ value, timestamp }) => ({
    _string_attributes: tags,
    name,
    value,
    timestamp: `${timestamp}000000`,
    data_type,
    is_monotonic,
    is_delta,
    unit,
  }));
}

export function mockLogsPropertyTypeMappingsModel(propertyMap: {
  [property: string]: 'bool' | 'number' | 'string';
}) {
  const propertyTypesMappingsModel = new LogsPropertyTypeMappingsModel(
    1,
    'fake team id',
    () => Promise.resolve({}),
  );
  jest
    .spyOn(propertyTypesMappingsModel, 'get')
    .mockImplementation((property: string) => {
      // eslint-disable-next-line security/detect-object-injection
      return propertyMap[property];
    });

  jest
    .spyOn(clickhouse, 'buildLogsPropertyTypeMappingsModel')
    .mockImplementation(() => Promise.resolve(propertyTypesMappingsModel));

  return propertyTypesMappingsModel;
}

export function mockSpyMetricPropertyTypeMappingsModel(propertyMap: {
  [property: string]: 'bool' | 'number' | 'string';
}) {
  const model = new MetricsPropertyTypeMappingsModel(1, 'fake', () =>
    Promise.resolve({}),
  );

  jest.spyOn(model, 'get').mockImplementation((property: string) => {
    // eslint-disable-next-line security/detect-object-injection
    return propertyMap[property];
  });

  jest
    .spyOn(clickhouse, 'buildMetricsPropertyTypeMappingsModel')
    .mockImplementation(() => Promise.resolve(model));

  return model;
}
