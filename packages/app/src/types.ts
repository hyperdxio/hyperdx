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

export type AlertChannel = {
  channelId?: string;
  recipients?: string[];
  severity?: 'critical' | 'error' | 'warning' | 'info';
  type: AlertChannelType;
  webhookId?: string;
};

export type Alert = {
  _id: string;
  channel: AlertChannel;
  cron: string;
  groupBy?: string;
  interval: AlertInterval;
  logView: string;
  message?: string;
  state: 'ALERT' | 'OK';
  threshold: number;
  timezone: string;
  type: 'presence' | 'absence';
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
