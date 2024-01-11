import _ from 'lodash';

import type { Json, JSONBlob } from './common';
import { tryJSONStringify } from './common';
export type KeyPath = string[];

export enum AggregationTemporality {
  Delta = 1,
  Cumulative = 2,
}

export enum LogType {
  Log = 'log',
  Metric = 'metric',
  Span = 'span',
}

export enum LogPlatform {
  Docker = 'docker',
  Heroku = 'heroku',
  HyperDX = 'hyperdx',
  NodeJS = 'nodejs',
  OtelLogs = 'otel-logs',
  OtelTraces = 'otel-traces',
  OtelMetrics = 'otel-metrics',
  Rrweb = 'rrweb',
}

export type KeyValuePairs = {
  'bool.names': string[];
  'bool.values': number[];
  'number.names': string[];
  'number.values': number[];
  'string.names': string[];
  'string.values': string[];
};

export type SpanFields = {
  end_timestamp?: number;
  span_name?: string;
  parent_span_id?: string;
};

export type LogFields = {
  _host?: string;
  severity_number?: number;
  severity_text?: string;
};

export type RrwebEventModel = KeyValuePairs & {
  _service?: string;
  _source: string;
  timestamp: number;
};

export type LogStreamModel = KeyValuePairs &
  LogFields &
  SpanFields & {
    _namespace?: string;
    _platform: LogPlatform;
    _service?: string;
    _source: string; // raw log
    observed_timestamp: number;
    span_id?: string;
    timestamp: number;
    trace_id?: string;
    type: LogType;
  };

export type MetricModel = {
  _string_attributes: Record<string, string>;
  data_type: string;
  is_delta: boolean;
  is_monotonic: boolean;
  name: string;
  timestamp: number;
  unit: string;
  value: number;
};

const MAX_DEPTH = 6;
export function* traverseJson(
  currentNode: JSONBlob,
  depth = 1,
  keyPathArray?: KeyPath,
): IterableIterator<[KeyPath, Json]> {
  for (const [key, value] of Object.entries(currentNode)) {
    const keyPath = keyPathArray ? [...keyPathArray, key] : [key];

    yield [keyPath, value];

    if (_.isObject(value) && Object.keys(value).length && depth < MAX_DEPTH) {
      // TODO: limit array length ??
      if (_.isArray(value)) {
        yield [keyPath, tryJSONStringify(value)];
      } else {
        yield* traverseJson(value, depth + 1, keyPath);
      }
    }
    // TODO: alert if MAX_DEPTH is reached
  }
}

const MAX_KEY_VALUE_PAIRS_LENGTH = 1024;
export const mapObjectToKeyValuePairs = (
  blob: JSONBlob,
  maxArrayLength = MAX_KEY_VALUE_PAIRS_LENGTH,
): KeyValuePairs => {
  const output: KeyValuePairs = {
    'bool.names': [],
    'bool.values': [],
    'number.names': [],
    'number.values': [],
    'string.names': [],
    'string.values': [],
  };
  const pushArray = (
    type: 'bool' | 'number' | 'string',
    keyPath: string,
    value: number | string, // Note that booleans are converted to 0 or 1
  ) => {
    const keyNames = `${type}.names`;
    const keyValues = `${type}.values`;
    if (output[keyNames].length < maxArrayLength) {
      output[keyNames].push(keyPath);
      output[keyValues].push(value);
      return true;
    }
    return false;
  };

  let reachedBoolMaxLength = false;
  let reachedNumberMaxLength = false;
  let reachedStringMaxLength = false;

  if (_.isPlainObject(blob)) {
    const jsonIt = traverseJson(blob);
    let pushed = true;
    for (const [key, value] of jsonIt) {
      const compoundKeyPath = key.join('.');
      if (!reachedNumberMaxLength && _.isNumber(value)) {
        pushed = pushArray('number', compoundKeyPath, value);
        if (!pushed) {
          reachedNumberMaxLength = true;
        }
      } else if (!reachedBoolMaxLength && _.isBoolean(value)) {
        pushed = pushArray('bool', compoundKeyPath, value ? 1 : 0);
        if (!pushed) {
          reachedBoolMaxLength = true;
        }
      } else if (!reachedStringMaxLength && _.isString(value)) {
        pushed = pushArray('string', compoundKeyPath, value);
        if (!pushed) {
          reachedStringMaxLength = true;
        }
      }

      if (
        reachedBoolMaxLength &&
        reachedNumberMaxLength &&
        reachedStringMaxLength
      ) {
        console.warn(
          `Max array length reached for ${compoundKeyPath} with value ${value}`,
        );
        break;
      }
    }
  }

  return output;
};

type _VectorLogFields = {
  h?: string; // host
  sn?: number; // severity number
  st?: string; // severity text
};

type _VectorSpanFileds = {
  et?: number; // end timestamp
  p_id?: string; // parent id
  s_n?: string; // span name
};

export type VectorLog = _VectorLogFields &
  _VectorSpanFileds & {
    authorization: string | null;
    b: JSONBlob;
    hdx_platform: LogPlatform;
    hdx_token: string | null;
    r: string; // raw
    s_id?: string; // span id
    sv: string; // service
    t_id?: string; // trace id
    ts: number; // timestamp
    tso: number; // observed timestamp
  };

export type VectorSpan = {
  atrs: JSONBlob; // attributes
  authorization?: string | null;
  et: number; // end timestamp
  hdx_platform: string;
  hdx_token: string | null;
  n: string; // name
  p_id: string; // parent id
  r: string; // raw
  s_id: string; // span id
  st: number; // start timestamp
  t_id: string; // trace id
  tso: number; // observed timestamp
};

export type VectorMetric = {
  at: number; // aggregation temporality
  authorization?: string;
  b: JSONBlob; // tags
  dt: string; // data type
  hdx_platform: string;
  hdx_token: string;
  im: boolean; // is monotonic
  n: string; // name
  ts: number; // timestamp
  tso: number; // observed timestamp
  u: string; // unit
  v: number; // value
};

abstract class ParsingInterface<T, S> {
  abstract _parse(log: T, ...args: any[]): S;

  parse(logs: T[], ...args: any[]) {
    const parsedLogs: S[] = [];
    for (const log of logs) {
      try {
        parsedLogs.push(this._parse(log, ...args));
      } catch (e) {
        // continue if parser fails to parse single log
        console.warn(e);
      }
    }
    return parsedLogs;
  }
}

class VectorLogParser extends ParsingInterface<VectorLog, LogStreamModel> {
  getType(log: VectorLog): LogType {
    if (log.hdx_platform === LogPlatform.OtelTraces) {
      return LogType.Span;
    } else if (log.hdx_platform === LogPlatform.OtelMetrics) {
      return LogType.Metric;
    }
    return LogType.Log;
  }

  _parse(log: VectorLog): LogStreamModel {
    return {
      ...mapObjectToKeyValuePairs(log.b),
      _platform: log.hdx_platform,
      _service: log.sv,
      _source: log.r,
      observed_timestamp: log.tso,
      timestamp: log.ts,
      type: this.getType(log),
      // Log
      _host: log.h,
      severity_text: log.st,
      severity_number: log.sn,
      // Span
      end_timestamp: log.et,
      span_name: log.s_n,
      parent_span_id: log.p_id,
      span_id: log.s_id,
      trace_id: log.t_id,
    };
  }
}

class VectorMetricParser extends ParsingInterface<VectorMetric, MetricModel> {
  _parse(metric: VectorMetric): MetricModel {
    return {
      _string_attributes: metric.b as any,
      data_type: metric.dt,
      is_delta: metric.at === AggregationTemporality.Delta,
      is_monotonic: metric.im,
      name: metric.n,
      timestamp: metric.ts,
      unit: metric.u,
      value: metric.v,
    };
  }
}

class VectorRrwebParser extends ParsingInterface<VectorLog, RrwebEventModel> {
  _parse(log: VectorLog): RrwebEventModel {
    return {
      ...mapObjectToKeyValuePairs(log.b),
      _service: log.sv,
      _source: log.r,
      timestamp: log.ts,
    };
  }
}

// TODO: do this on the ingestor side ?
export const extractApiKey = (log: VectorLog | VectorSpan | VectorMetric) => {
  if (log.authorization?.includes('Bearer')) {
    return log.authorization.split('Bearer ')[1];
  }
  return log.hdx_token;
};

export const vectorLogParser = new VectorLogParser();
export const vectorMetricParser = new VectorMetricParser();
export const vectorRrwebParser = new VectorRrwebParser();
