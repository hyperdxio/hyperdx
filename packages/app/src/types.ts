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

export type LogView = {
  _id: string;
  name: string;
  query: string;
  alerts?: Alert[];
};

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

export type NumberFormat = {
  output?: 'currency' | 'percent' | 'byte' | 'time' | 'number';
  mantissa?: number;
  thousandSeparated?: boolean;
  average?: boolean;
  decimalBytes?: boolean;
  factor?: number;
  currencySymbol?: string;
  unit?: string;
};

export type AggFn =
  | 'avg_rate'
  | 'avg'
  | 'count_distinct'
  | 'count'
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

export type TimeChartSeries = {
  displayName?: string;
  table: SourceTable;
  type: 'time';
  aggFn: AggFn; // TODO: Type
  field?: string | undefined;
  where: string;
  groupBy: string[];
  numberFormat?: NumberFormat;
};

export type TableChartSeries = {
  displayName?: string;
  type: 'table';
  table: SourceTable;
  aggFn: AggFn;
  field: string | undefined;
  where: string;
  groupBy: string[];
  sortOrder?: 'desc' | 'asc';
  numberFormat?: NumberFormat;
};

export type ChartSeries =
  | TimeChartSeries
  | TableChartSeries
  | {
      table: SourceTable;
      type: 'histogram';
      field: string | undefined;
      where: string;
    }
  | {
      type: 'search';
      fields: string[];
      where: string;
    }
  | {
      type: 'number';
      table: SourceTable;
      aggFn: AggFn;
      field: string | undefined;
      where: string;
      numberFormat?: NumberFormat;
    }
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
