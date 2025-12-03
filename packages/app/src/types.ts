import { z } from 'zod';
import {
  Alert,
  AlertHistory,
  ChartConfig,
  DashboardSchema,
  Filter,
  NumberFormat as _NumberFormat,
  SavedSearchSchema,
  WebhookService,
} from '@hyperdx/common-utils/dist/types';

export type NumberFormat = _NumberFormat;

export type Anomaly = {
  _id: string;
  team: string;
  serviceName: string;
  metric: string;
  value: number;
  baseline: number;
  deviation: number;
  startTime: string;
  endTime: string;
  status: 'open' | 'resolved' | 'ignored';
  rcaAnalysis?: string;
  createdAt: string;
  updatedAt: string;
};

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

export type AlertsPageItem = Alert & {
  _id: string;
  history: AlertHistory[];
  dashboard?: ServerDashboard;
  savedSearch?: SavedSearch;
  createdBy?: {
    email: string;
    name?: string;
  };
};

export type AlertWithCreatedBy = Alert & {
  createdBy?: {
    email: string;
    name?: string;
  };
};

export type SavedSearch = z.infer<typeof SavedSearchSchema>;

export type SavedSearchWithEnhancedAlerts = Omit<SavedSearch, 'alerts'> & {
  alerts?: AlertWithCreatedBy[];
};

export type SearchConfig = {
  select?: string | null;
  source?: string | null;
  where?: ChartConfig['where'] | null;
  whereLanguage?: ChartConfig['whereLanguage'] | null;
  filters?: Filter[] | null;
  orderBy?: string | null;
};

export type ServerDashboard = z.infer<typeof DashboardSchema>;

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
  aggFn?: AggFn; // TODO: Type
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
  aggFn?: AggFn;
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

export type Webhook = {
  _id: string;
  name: string;
  service: WebhookService;
  url: string;
  description?: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: string;
  createdAt: string;
  updatedAt: string;
};

export type NextApiConfigResponseData = {
  apiKey: string;
  collectorUrl: string;
  serviceName: string;
};

export enum ServiceTier {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum ServiceReadiness {
  GOLD = 'gold',
  SILVER = 'silver',
  BRONZE = 'bronze',
  FAIL = 'fail',
}

export enum CheckType {
  HAS_OWNER = 'has_owner',
  HAS_RUNBOOK = 'has_runbook',
  HAS_REPO = 'has_repo',
  HAS_SLO = 'has_slo',
  HAS_LOGS = 'has_logs',
  HAS_TRACES = 'has_traces',
}

export enum CheckStatus {
  PASS = 'pass',
  FAIL = 'fail',
}

export interface ServiceCheck {
  _id: string;
  service: string;
  checkType: CheckType;
  status: CheckStatus;
  message?: string;
  updatedAt: string;
}

export interface Service {
  _id: string;
  name: string;
  description?: string;
  team: string;
  
  // Metadata
  owner?: string; // User ID
  tier: ServiceTier;
  runbookUrl?: string;
  repoUrl?: string;
  
  // State
  lastSeenAt: string;
  readiness?: ServiceReadiness;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export enum IncidentStatus {
  OPEN = 'open',
  INVESTIGATING = 'investigating',
  FIXED = 'fixed',
  RESOLVED = 'resolved',
  CANCELLED = 'cancelled',
}

export enum IncidentSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum IncidentSource {
  MANUAL = 'manual',
  ALERT = 'alert',
}

export interface IncidentEvent {
  type: 'status_change' | 'comment' | 'assignment';
  author: {
    _id: string;
    name: string;
    email: string;
  };
  message: string;
  createdAt: string;
}

export interface Incident {
  _id: string;
  title: string;
  description?: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  source: IncidentSource;
  alert?: {
    _id: string;
    name: string;
  };
  owner?: {
    _id: string;
    name: string;
    email: string;
  };
  team: string;
  events: IncidentEvent[];
  resolutionNotes?: string;
  createdAt: string;
  updatedAt: string;
}
