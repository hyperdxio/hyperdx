export type TimelineEvent = {
  ts: number; // unix seconds
  label: string;
  group?: string;
  severity?: string;
  series?: string; // from __series column in UNION ALL queries
};

export type TimelineLane = {
  key: string; // series name or group value
  displayName: string;
  events: TimelineEvent[];
  color: string;
};
