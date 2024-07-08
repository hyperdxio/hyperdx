import { useRouter } from 'next/router';

import DashboardPage from '@/DashboardPage';
import { withAppNav } from '@/layout';

const APP_PERFORMANCE_DASHBOARD_CONFIG = {
  id: '',
  name: 'App Performance',
  charts: [
    {
      id: '1624425',
      name: 'P95 Latency by Operation',
      x: 0,
      y: 0,
      w: 8,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'p95',
          field: 'duration',
          where: '',
          groupBy: ['span_name'],
        },
      ],
    },
    {
      id: '401924',
      name: 'Operations with Errors',
      x: 8,
      y: 0,
      w: 4,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'level:err',
          groupBy: ['span_name'],
        },
      ],
    },
    {
      id: '883200',
      name: 'Count of Operations',
      x: 0,
      y: 3,
      w: 8,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: '',
          groupBy: ['span_name'],
        },
      ],
    },
  ],
};
const HTTP_SERVER_DASHBOARD_CONFIG = {
  id: '',
  name: 'HTTP Server',
  charts: [
    {
      id: '312739',
      name: 'P95 Latency by Endpoint',
      x: 0,
      y: 0,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'p95',
          field: 'duration',
          where: 'span.kind:server',
          groupBy: ['http.route'],
        },
      ],
    },
    {
      id: '434437',
      name: 'HTTP Status Codes',
      x: 0,
      y: 2,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'span.kind:server',
          groupBy: ['http.status_code'],
        },
      ],
    },
    {
      id: '69137',
      name: 'HTTP 4xx, 5xx',
      x: 6,
      y: 4,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'http.status_code:>=400 span.kind:server',
          groupBy: ['http.status_code'],
        },
      ],
    },
    {
      id: '34708',
      name: 'HTTP 5xx by Endpoint',
      x: 6,
      y: 2,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'span.kind:server http.status_code:>=500',
          groupBy: ['http.route'],
        },
      ],
    },
    {
      id: '58773',
      name: 'Request Volume by Endpoint',
      x: 6,
      y: 0,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'span.kind:server',
          groupBy: ['http.route'],
        },
      ],
    },
  ],
};
const REDIS_DASHBOARD_CONFIG = {
  id: '',
  name: 'Redis',
  charts: [
    {
      id: '38463',
      name: 'GET Operations',
      x: 0,
      y: 0,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'db.system:"redis" span_name:GET',
          groupBy: [],
        },
      ],
    },
    {
      id: '488836',
      name: 'P95 GET Latency',
      x: 0,
      y: 2,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'p95',
          field: 'duration',
          where: 'db.system:"redis" span_name:GET',
          groupBy: [],
        },
      ],
    },
    {
      id: '8355753',
      name: 'SET Operations',
      x: 6,
      y: 0,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where: 'db.system:"redis" span_name:SET',
          groupBy: [],
        },
      ],
    },
    {
      id: '93278',
      name: 'P95 SET Latency',
      x: 6,
      y: 2,
      w: 6,
      h: 2,
      series: [
        {
          type: 'time',
          aggFn: 'p95',
          field: 'duration',
          where: 'db.system:"redis" span_name:SET',
          groupBy: [],
        },
      ],
    },
  ],
};
const MONGO_DASHBOARD_CONFIG = {
  id: '',
  name: 'MongoDB',
  charts: [
    {
      id: '98180',
      name: 'P95 Read Operation Latency by Collection',
      x: 0,
      y: 0,
      w: 6,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'p95',
          field: 'duration',
          where:
            'db.system:mongo (db.operation:"find" OR db.operation:"findOne" OR db.operation:"aggregate")',
          groupBy: ['db.mongodb.collection'],
        },
      ],
    },
    {
      id: '28877',
      name: 'P95 Write Operation Latency by Collection',
      x: 6,
      y: 0,
      w: 6,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'p95',
          field: 'duration',
          where:
            'db.system:mongo (db.operation:"insert" OR db.operation:"findOneAndUpdate" OR db.operation:"save" OR db.operation:"findAndModify")',
          groupBy: ['db.mongodb.collection'],
        },
      ],
    },
    {
      id: '9901546',
      name: 'Count of Write Operations by Collection',
      x: 6,
      y: 3,
      w: 6,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where:
            'db.system:mongo (db.operation:"insert" OR db.operation:"findOneAndUpdate" OR db.operation:"save" OR db.operation:"findAndModify")',
          groupBy: ['db.mongodb.collection'],
        },
      ],
    },
    {
      id: '6894669',
      name: 'Count of Read Operations by Collection',
      x: 0,
      y: 3,
      w: 6,
      h: 3,
      series: [
        {
          type: 'time',
          aggFn: 'count',
          where:
            'db.system:mongo (db.operation:"find" OR db.operation:"findOne" OR db.operation:"aggregate")',
          groupBy: ['db.mongodb.collection'],
        },
      ],
    },
  ],
};
const HYPERDX_USAGE_DASHBOARD_CONFIG = {
  id: '',
  name: 'HyperDX Usage',
  charts: [
    {
      id: '15gykg',
      name: 'Log/Span Usage in Bytes',
      x: 0,
      y: 0,
      w: 3,
      h: 2,
      series: [
        {
          table: 'logs',
          type: 'number',
          aggFn: 'sum',
          field: 'hyperdx_event_size',
          where: '',
          groupBy: [],
          numberFormat: {
            output: 'byte',
          },
        },
      ],
    },
    {
      id: '1k5pul',
      name: 'Logs/Span Usage over Time',
      x: 3,
      y: 0,
      w: 9,
      h: 3,
      series: [
        {
          table: 'logs',
          type: 'time',
          aggFn: 'sum',
          field: 'hyperdx_event_size',
          where: '',
          groupBy: [],
          numberFormat: {
            output: 'byte',
          },
        },
      ],
    },
  ],
};

const PRESETS: Record<string, any> = {
  'app-performance': APP_PERFORMANCE_DASHBOARD_CONFIG,
  'http-server': HTTP_SERVER_DASHBOARD_CONFIG,
  redis: REDIS_DASHBOARD_CONFIG,
  mongo: MONGO_DASHBOARD_CONFIG,
  'hyperdx-usage': HYPERDX_USAGE_DASHBOARD_CONFIG,
};

export default function DashboardPresetPage() {
  const router = useRouter();

  const presetName = router.query.presetName as string;

  const presetConfig = PRESETS[presetName] as any;

  return <DashboardPage presetConfig={presetConfig} />;
}

DashboardPresetPage.getLayout = withAppNav;
