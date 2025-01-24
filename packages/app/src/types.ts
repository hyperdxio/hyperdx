import { z } from 'zod';
import {
  DashboardSchema,
  NumberFormat as _NumberFormat,
  SavedSearchSchema,
} from '@hyperdx/common-utils/dist/types';

export type NumberFormat = _NumberFormat;

export type Team = {
  allowedAuthMethods: any[];
  apiKey?: string;
  name: string;
  users: {
    email: string;
    hasPasswordAuth: boolean;
    isCurrentUser: boolean;
    name: string;
  }[];
  _id: string;
};

export type KeyValuePairs = {
  'bool.names': string[];
  'bool.values': number[];
  'number.names': string[];
  'number.values': number[];
  'string.names': string[];
  'string.values': string[];
};

export type LogStreamModel = KeyValuePairs & {
  _host?: string;
  _namespace?: string;
  _platform: string;
  _service?: string;
  _source: string; // raw log
  body: string;
  id: string;
  observed_timestamp: number;
  severity_number: number;
  severity_text: string;
  span_id?: string;
  timestamp: string;
  trace_id?: string;
};

// TODO: Migrate
export type LogView = z.infer<typeof SavedSearchSchema>;

// {
//   _id: string;
//   name: string;
//   query: string;
//   alerts?: Alert[];
//   tags?: string[];
// };

export type ServerDashboard = z.infer<typeof DashboardSchema>;

// {
//   _id: string;
//   createdAt: string;
//   updatedAt: string;
//   name: string;
//   charts: Chart[];
//   alerts?: Alert[];
//   query?: string;
//   tags: string[];
// };

export type AlertType = 'presence' | 'absence';

export type AlertInterval =
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '6h'
  | '12h'
  | '1d';

export type AlertChannelType = 'webhook';

export type AlertSource = 'LOG' | 'CHART';

export type AlertChannel = {
  channelId?: string;
  recipients?: string[];
  severity?: 'critical' | 'error' | 'warning' | 'info';
  type: AlertChannelType;
  webhookId?: string;
};

export enum AlertState {
  ALERT = 'ALERT',
  DISABLED = 'DISABLED',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  OK = 'OK',
}

export type Alert = {
  _id?: string;
  channel: AlertChannel;
  cron?: string;
  interval: AlertInterval;
  state?: AlertState;
  threshold: number;
  timezone?: string;
  type: AlertType;
  source: AlertSource;
  silenced?: {
    by?: string;
    at: string;
    until: string;
  };
  // Log alerts
  logView?: string;
  message?: string;
  groupBy?: string;

  // Chart alerts
  dashboardId?: string;
  chartId?: string;
};

export type AlertHistory = {
  counts: number;
  createdAt: Date;
  lastValues: { startTime: Date; count: number }[];
  state: AlertState;
};

export type Session = {
  errorCount: string;
  maxTimestamp: string;
  minTimestamp: string;
  rrwebEventCount: string;
  sessionCount: string;
  sessionId: string;
  teamId: string;
  teamName: string;
  userEmail: string;
  userName: string;
};

export type Dictionary<T> = {
  [key: string]: T;
};

export type StacktraceFrame = {
  filename: string;
  function: string;
  module?: string;
  lineno: number;
  colno: number;
  in_app: boolean;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
};

export type StacktraceBreadcrumbCategory =
  | 'ui.click'
  | 'fetch'
  | 'xhr'
  | 'console'
  | 'navigation'
  | string;

export type StacktraceBreadcrumb = {
  type?: string;
  level?: string;
  event_id?: string;
  category?: StacktraceBreadcrumbCategory;
  message?: string;
  data?: { [key: string]: any };
  timestamp: number;
};

export type AggFn =
  | 'avg_rate'
  | 'avg'
  | 'count_distinct'
  | 'count'
  | 'count_per_sec'
  | 'count_per_min'
  | 'count_per_hour'
  | 'last_value'
  | 'max_rate'
  | 'max'
  | 'min_rate'
  | 'min'
  | 'p50_rate'
  | 'p50'
  | 'p90_rate'
  | 'p90'
  | 'p95_rate'
  | 'p95'
  | 'p99_rate'
  | 'p99'
  | 'sum_rate'
  | 'sum';

export type SourceTable = 'logs' | 'rrweb' | 'metrics';

export enum MetricsDataType {
  Gauge = 'Gauge',
  Histogram = 'Histogram',
  Sum = 'Sum',
  Summary = 'Summary',
}

type SeriesDBDataSource = {
  databaseName?: string;
  tableName?: string;
  timestampColumn?: string;
};

export type TimeChartSeries = {
  displayName?: string;
  table: SourceTable;
  type: 'time';
  aggFn: AggFn; // TODO: Type
  field?: string | undefined;
  where: string;
  groupBy: string[];
  numberFormat?: NumberFormat;
  color?: string;
  displayType?: 'stacked_bar' | 'line';
  implicitColumn?: string;
  whereSql?: string;
  groupBySql?: string;
  fieldSql?: string;
} & SeriesDBDataSource;

export type TableChartSeries = {
  visible?: boolean;
  columnWidthPercent?: number;
  displayName?: string;
  type: 'table';
  table: SourceTable;
  aggFn: AggFn;
  field?: string | undefined;
  where: string;
  groupBy: string[];
  sortOrder?: 'desc' | 'asc';
  numberFormat?: NumberFormat;
  color?: string;
} & SeriesDBDataSource;

export type ChartSeries =
  | TimeChartSeries
  | TableChartSeries
  | ({
      table: SourceTable;
      type: 'histogram';
      field: string | undefined;
      where: string;
    } & SeriesDBDataSource)
  | ({
      type: 'search';
      fields: string[];
      where: string;
    } & SeriesDBDataSource)
  | ({
      type: 'number';
      table: SourceTable;
      aggFn: AggFn;
      field: string | undefined;
      where: string;
      numberFormat?: NumberFormat;
      color?: string;
    } & SeriesDBDataSource)
  | {
      type: 'markdown';
      content: string;
    };

export type Chart = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  series: ChartSeries[];
  seriesReturnType: 'ratio' | 'column';
};

// https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/receiver/k8sclusterreceiver/documentation.md#k8spodphase
export enum KubePhase {
  Pending = 1,
  Running = 2,
  Succeeded = 3,
  Failed = 4,
  Unknown = 5,
}

export enum WebhookService {
  Slack = 'slack',
  Generic = 'generic',
}

export type NextApiConfigResponseData = {
  apiKey: string;
  collectorUrl: string;
  serviceName: string;
};
