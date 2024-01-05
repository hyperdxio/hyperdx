import { useEffect, useState } from 'react';
import Link from 'next/link';
import Router, { useRouter } from 'next/router';
import cx from 'classnames';
import { Button } from 'react-bootstrap';
import { useQueryClient } from 'react-query';
import {
  NumberParam,
  StringParam,
  useQueryParam,
  useQueryParams,
  withDefault,
} from 'use-query-params';
import HyperDX from '@hyperdx/browser';

import { version } from '../package.json';

import api from './api';
import AuthLoadingBlocker from './AuthLoadingBlocker';
import { API_SERVER_URL, SERVICE_DASHBOARD_ENABLED } from './config';
import Icon from './Icon';
import Logo from './Logo';
import { useWindowSize } from './utils';

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
        },
      ],
    },
  ],
};

function PresetDashboardLink({
  query,
  config,
  name,
}: {
  query: any;
  config: any;
  name: string;
}) {
  return (
    <Link
      href={`/dashboards?config=${encodeURIComponent(JSON.stringify(config))}`}
    >
      <a
        className={cx(
          'd-block ms-3 mt-2 cursor-pointer text-decoration-none text-muted-hover',
          {
            'text-success fw-bold':
              query.config === JSON.stringify(config) &&
              query.dashboardId == null,
            'text-muted-hover': query.config !== JSON.stringify(config),
          },
        )}
      >
        {name}
      </a>
    </Link>
  );
}

function PresetSearchLink({ query, name }: { query: string; name: string }) {
  const { query: routerQuery } = useRouter();
  const [searchedQuery] = useQueryParam('q', withDefault(StringParam, ''));
  const [timeRangeQuery] = useQueryParams({
    from: withDefault(NumberParam, -1),
    to: withDefault(NumberParam, -1),
  });
  const [inputTimeQuery] = useQueryParam('tq', withDefault(StringParam, ''), {
    updateType: 'pushIn',
    enableBatching: true,
  });

  return (
    <Link
      href={`/search?${new URLSearchParams(
        timeRangeQuery.from != -1 && timeRangeQuery.to != -1
          ? {
              q: query,
              from: timeRangeQuery.from.toString(),
              to: timeRangeQuery.to.toString(),
              tq: inputTimeQuery,
            }
          : {
              q: query,
            },
      ).toString()}`}
    >
      <a
        className={cx('d-block ms-3 mt-2 cursor-pointer text-decoration-none', {
          'text-success fw-bold':
            routerQuery.savedSearchId == null && searchedQuery === query,
          'text-muted-hover':
            routerQuery.savedSearchId != null || searchedQuery !== query,
        })}
      >
        {name}
      </a>
    </Link>
  );
}

export default function AppNav({ fixed = false }: { fixed?: boolean }) {
  // TODO enable this once the alerts page is ready for public consumption
  const showAlertSidebar = false;
  useEffect(() => {
    let redirectUrl;
    try {
      redirectUrl = window.sessionStorage.getItem('hdx-login-redirect-url');
    } catch (e: any) {
      console.error(e);
    }
    // conditional redirect
    if (redirectUrl) {
      // with router.push the page may be added to history
      // the browser on history back will  go back to this page and then forward again to the redirected page
      // you can prevent this behaviour using location.replace
      window.sessionStorage.removeItem('hdx-login-redirect-url');
      Router.push(redirectUrl);
    }
  }, []);

  const {
    data: logViewsData,
    isLoading: isLogViewsLoading,
    refetch: refetchLogViews,
  } = api.useLogViews();
  const logViews = logViewsData?.data ?? [];

  const { data: dashboardsData, isLoading: isDashboardsLoading } =
    api.useDashboards();
  const dashboards = dashboardsData?.data ?? [];

  const { data: alertsData, isLoading: isAlertsLoading } = api.useAlerts();
  const alerts = alertsData?.data?.alerts ?? [];

  const router = useRouter();
  const { pathname, query } = router;

  const [timeRangeQuery] = useQueryParams({
    from: withDefault(NumberParam, -1),
    to: withDefault(NumberParam, -1),
  });
  const [inputTimeQuery] = useQueryParam('tq', withDefault(StringParam, ''), {
    updateType: 'pushIn',
    enableBatching: true,
  });

  const { data: meData } = api.useMe();

  const [isSearchExpanded, setIsSearchExpanded] = useState(true);
  const [isDashboardsExpanded, setIsDashboardExpanded] = useState(true);

  const { width } = useWindowSize();
  const [isPreferCollapsed, setIsPreferCollapsed] = useState<
    undefined | boolean
  >(undefined);

  const isSmallScreen = (width ?? 1000) < 900;
  const isCollapsed = isPreferCollapsed ?? isSmallScreen;

  const navWidth = isCollapsed ? 50 : 220;

  const { data: team, isLoading: teamIsLoading } = api.useTeam();

  useEffect(() => {
    HyperDX.addAction('user navigated', {
      route: pathname,
      query: JSON.stringify(query),
    });
  }, [pathname, query]);

  useEffect(() => {
    if (meData != null) {
      HyperDX.enableAdvancedNetworkCapture();
      HyperDX.setGlobalAttributes({
        userEmail: meData.email,
        userName: meData.name,
        teamName: meData.team.name,
      });
    }
  }, [meData]);
  return (
    <>
      <AuthLoadingBlocker />
      {fixed && <div style={{ width: navWidth, minWidth: navWidth }}></div>}
      <div
        style={{
          minWidth: navWidth,
          width: navWidth,
          maxHeight: '100vh',
          overflowY: 'auto',
          height: '100%',
          ...(fixed
            ? {
                height: '100vh',
                position: 'fixed',
              }
            : {}),
        }}
        className="p-3 border-end border-dark d-flex flex-column justify-content-between"
      >
        <div>
          <div className="d-flex flex-wrap justify-content-between align-items-center">
            <Link href="/search">
              <a className="text-decoration-none">
                {isCollapsed ? (
                  <div style={{ marginLeft: '-0.15rem' }}>
                    <Icon size={22} />
                  </div>
                ) : (
                  <Logo />
                )}
              </a>
            </Link>
            <Button
              variant="dark"
              size="sm"
              className={isCollapsed ? 'mt-4' : ''}
              style={isCollapsed ? { marginLeft: '-0.5rem' } : {}}
              title="Collapse/Expand Navigation"
              onClick={() => setIsPreferCollapsed(v => !v)}
            >
              <i className="bi bi-arrows-angle-expand"></i>
            </Button>
          </div>
          <div className="mt-5">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <Link href="/search">
                <a
                  className={cx(
                    'text-decoration-none d-flex justify-content-between align-items-center fs-6 text-muted-hover',
                    {
                      'text-success fw-bold':
                        pathname.includes('/search') &&
                        query.savedSearchId == null,
                      'fw-bold':
                        pathname.includes('/search') &&
                        query.savedSearchId != null,
                    },
                  )}
                >
                  <span>
                    <i className="bi bi-layout-text-sidebar-reverse" />{' '}
                    {!isCollapsed && <span>Search</span>}
                  </span>
                </a>
              </Link>
              {!isCollapsed && (
                <i
                  role="button"
                  className={`bi bi-chevron-${
                    isSearchExpanded ? 'down' : 'right'
                  } text-muted-hover`}
                  onClick={() => {
                    setIsSearchExpanded(!isSearchExpanded);
                  }}
                />
              )}
            </div>
            {isSearchExpanded && !isCollapsed && (
              <>
                <div className="fw-bold text-light fs-8 ms-3 mt-3">
                  SAVED SEARCHES
                </div>
                {(logViews ?? []).length === 0 ? (
                  <div className="text-muted ms-3 mt-2">No saved searches</div>
                ) : null}
                {(logViews ?? []).map(lv => (
                  <Link
                    href={`/search/${lv._id}?${new URLSearchParams(
                      timeRangeQuery.from != -1 && timeRangeQuery.to != -1
                        ? {
                            from: timeRangeQuery.from.toString(),
                            to: timeRangeQuery.to.toString(),
                            tq: inputTimeQuery,
                          }
                        : {},
                    ).toString()}`}
                    key={lv._id}
                  >
                    <a
                      className={cx(
                        'd-flex justify-content-between ms-3 mt-2 cursor-pointer text-decoration-none',
                        {
                          'text-success fw-bold':
                            lv._id === query.savedSearchId,
                          'text-muted-hover': lv._id !== query.savedSearchId,
                        },
                      )}
                      title={lv.name}
                    >
                      <div className="d-inline-block text-truncate">
                        {lv.name}
                      </div>
                      {Array.isArray(lv.alerts) && lv.alerts.length > 0 ? (
                        lv.alerts.some(a => a.state === 'ALERT') ? (
                          <i
                            className="bi bi-bell float-end text-danger"
                            title="Has Alerts and is in ALERT state"
                          ></i>
                        ) : (
                          <i
                            className="bi bi-bell float-end"
                            title="Has Alerts and is in OK state"
                          ></i>
                        )
                      ) : null}
                    </a>
                  </Link>
                ))}
                <div className="fw-bold text-light fs-8 ms-3 mt-3">PRESETS</div>
                <PresetSearchLink
                  query="level:err OR level:crit OR level:fatal OR level:emerg OR level:alert"
                  name="All Error Events"
                />
                <PresetSearchLink
                  query="http.status_code:>=400"
                  name="HTTP Status >= 400"
                />
              </>
            )}
            {/* <Link href="/search">
          <a
            className={cx(
              'd-inline-block ms-3 mt-2 cursor-pointer text-decoration-none',
              {
                'text-success fw-bold': isLiveTail,
                'text-muted-hover': !isLiveTail,
              },
            )}
          >
            <i className="bi bi-lightning-charge-fill me-2" />
            Live Tail
          </a>
        </Link> */}
            <div className="my-4">
              <Link href="/chart">
                <a
                  className={cx(
                    'text-decoration-none d-flex justify-content-between align-items-center fs-6 text-muted-hover',
                    {
                      'fw-bold text-success': pathname.includes('/chart'),
                    },
                  )}
                >
                  <span>
                    <i className="bi bi-graph-up" />{' '}
                    {!isCollapsed && <span>Chart Explorer</span>}
                  </span>
                </a>
              </Link>
            </div>
            <div className="my-4">
              <Link href="/sessions">
                <a
                  className={cx(
                    'text-decoration-none d-flex justify-content-between align-items-center fs-6 text-muted-hover',
                    {
                      'fw-bold text-success': pathname.includes('/sessions'),
                    },
                  )}
                >
                  <span>
                    <i className="bi bi-laptop" />{' '}
                    {!isCollapsed && <span>Client Sessions</span>}
                  </span>
                </a>
              </Link>
            </div>
            {SERVICE_DASHBOARD_ENABLED ? (
              <div className="my-4">
                <Link href="/services">
                  <a
                    className={cx(
                      'text-decoration-none d-flex justify-content-between align-items-center fs-6 text-muted-hover',
                      {
                        'fw-bold text-success': pathname.includes('/services'),
                      },
                    )}
                  >
                    <span>
                      <i className="bi bi-heart-pulse" />{' '}
                      {!isCollapsed && <span>Service Health</span>}
                    </span>
                  </a>
                </Link>
              </div>
            ) : null}
            <div>
              <div
                className={cx(
                  'text-decoration-none d-flex justify-content-between align-items-center fs-6 text-muted mb-2',
                  {
                    'fw-bold': pathname.includes('/dashboard'),
                  },
                )}
              >
                <Link href="/dashboards">
                  <a className="text-decoration-none d-flex justify-content-between align-items-center fs-6 text-muted-hover">
                    <span>
                      <i className="bi bi-grid-1x2" />{' '}
                      {!isCollapsed && <span>Dashboards</span>}
                    </span>
                  </a>
                </Link>
                {!isCollapsed && (
                  <i
                    role="button"
                    className={`bi bi-chevron-${
                      isDashboardsExpanded ? 'down' : 'right'
                    } text-muted-hover`}
                    onClick={() => {
                      setIsDashboardExpanded(!isDashboardsExpanded);
                    }}
                  />
                )}
              </div>
            </div>
            {isDashboardsExpanded && !isCollapsed && (
              <>
                <Link href="/dashboards">
                  <a
                    className={cx(
                      'd-block ms-3 mt-2 cursor-pointer text-decoration-none',
                      pathname.includes('/dashboard') &&
                        query.dashboardId == null &&
                        query.config !=
                          JSON.stringify(APP_PERFORMANCE_DASHBOARD_CONFIG) &&
                        query.config !=
                          JSON.stringify(HTTP_SERVER_DASHBOARD_CONFIG) &&
                        query.config !=
                          JSON.stringify(REDIS_DASHBOARD_CONFIG) &&
                        query.config != JSON.stringify(MONGO_DASHBOARD_CONFIG)
                        ? 'text-success fw-bold'
                        : 'text-muted-hover',
                    )}
                  >
                    <i className="bi bi-plus me-2" />
                    New Dashboard
                  </a>
                </Link>
                <div className="fw-bold text-light fs-8 ms-3 mt-3">
                  SAVED DASHBOARDS
                </div>
                {(dashboards ?? []).length === 0 ? (
                  <div className="text-muted ms-3 mt-2">0 saved dashboards</div>
                ) : null}
                {(dashboards ?? []).map((dashboard: any) => (
                  <Link
                    href={`/dashboards/${dashboard._id}`}
                    key={dashboard._id}
                  >
                    <a
                      className={cx(
                        'd-block ms-3 mt-2 cursor-pointer text-decoration-none',
                        {
                          'text-success fw-bold':
                            dashboard._id === query.dashboardId,
                          'text-muted-hover':
                            dashboard._id !== query.dashboardId,
                        },
                      )}
                    >
                      {dashboard.name}
                    </a>
                  </Link>
                ))}
                <div className="fw-bold text-light fs-8 ms-3 mt-3">PRESETS</div>
                <PresetDashboardLink
                  query={query}
                  config={HYPERDX_USAGE_DASHBOARD_CONFIG}
                  name="HyperDX Usage"
                />
                <PresetDashboardLink
                  query={query}
                  config={APP_PERFORMANCE_DASHBOARD_CONFIG}
                  name="App Performance"
                />
                <PresetDashboardLink
                  query={query}
                  config={HTTP_SERVER_DASHBOARD_CONFIG}
                  name="HTTP Server"
                />
                <PresetDashboardLink
                  query={query}
                  config={REDIS_DASHBOARD_CONFIG}
                  name="Redis"
                />
                <PresetDashboardLink
                  query={query}
                  config={MONGO_DASHBOARD_CONFIG}
                  name="Mongo"
                />
              </>
            )}
            {showAlertSidebar ? (
              <div className="my-4">
                <Link href="/alerts">
                  <a
                    className={cx(
                      'text-decoration-none d-flex justify-content-between align-items-center fs-6 text-muted-hover',
                      {
                        'fw-bold text-success': pathname.includes('/alerts'),
                      },
                    )}
                  >
                    <div>
                      <i className="bi bi-exclamation-triangle" />{' '}
                      {!isCollapsed && (
                        <>
                          <span>Alerts</span>
                          {/* 
                      This should float at the end and display a count of alerts? 
                      or perhaps be tucked underneath with a breakdown of count in each state?
                    */}
                          <span className="text-end">
                            {' '}
                            {Array.isArray(alerts) ? alerts.length : null}
                          </span>
                          {Array.isArray(alerts) && alerts.length > 0 ? (
                            alerts.some(a => a.state === 'ALERT') ? (
                              <i
                                className="bi bi-bell float-end text-danger"
                                title="Has Alerts and is in ALERT state"
                              ></i>
                            ) : (
                              <i
                                className="bi bi-bell float-end"
                                title="Has Alerts and is in OK state"
                              ></i>
                            )
                          ) : null}
                        </>
                      )}
                    </div>
                  </a>
                </Link>
              </div>
            ) : null}
          </div>
        </div>
        {!isCollapsed && (
          <>
            <div className="mb-4 mt-4">
              <div className="my-3 bg-hdx-dark rounded p-2 text-center">
                <span className="">Ready to use HyperDX Cloud?</span>
                <div className="mt-3 mb-2">
                  <Link href="https://www.hyperdx.io/register" passHref>
                    <Button
                      variant="outline-success"
                      className="inter"
                      size="sm"
                    >
                      Get Started for Free
                    </Button>
                  </Link>
                </div>
              </div>
              <div className="my-3">
                <Link href="/team">
                  <a
                    className={cx(
                      'text-decoration-none d-flex justify-content-between align-items-center text-muted-hover',
                      {
                        'fw-bold text-success': pathname.includes('/team'),
                      },
                    )}
                  >
                    <span>
                      <i className="bi bi-gear" />{' '}
                      {!isCollapsed && <span>Team Settings</span>}
                    </span>
                  </a>
                </Link>
              </div>
              <div className="my-3">
                <Link href="https://hyperdx.io/docs">
                  <a
                    className={cx(
                      'text-decoration-none d-flex justify-content-between align-items-center text-muted-hover',
                    )}
                    target="_blank"
                  >
                    <span>
                      <i className="bi bi-book" />{' '}
                      {!isCollapsed && <span>Documentation</span>}
                    </span>
                  </a>
                </Link>
              </div>
              <div className="my-4">
                <Link href={`${API_SERVER_URL}/logout`}>
                  <span role="button" className="text-muted-hover">
                    <i className="bi bi-box-arrow-left" />{' '}
                    {!isCollapsed && <span>Logout</span>}
                  </span>
                </Link>
              </div>
            </div>
            <div className="d-flex justify-content-end align-items-end">
              <span className="text-muted-hover fs-7">v{version}</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
