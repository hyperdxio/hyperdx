import type { StacktraceBreadcrumb } from '../types';

export const MOCK_BREADCRUMBS: StacktraceBreadcrumb[] = [
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/log-views',
    },
    timestamp: 1700614385.475,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/dashboards',
    },
    timestamp: 1700614385.475,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: '/api/config',
    },
    timestamp: 1700614385.484,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/team',
    },
    timestamp: 1700614385.552,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs/propertyTypeMappings',
    },
    timestamp: 1700614385.554,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: '/_next/static/development/_devPagesManifest.json',
    },
    timestamp: 1700614385.554,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 500,
      url: 'http://localhost:8000/logs/histogram?q=&startTime=1700613485000&endTime=1700614385000',
    },
    timestamp: 1700614385.747,
    type: 'http',
  },
  {
    category: 'ui.click',
    message:
      'tr.LogTable_tableRow__Sil_V > td.align-top.overflow-hidden.text-truncate',
    timestamp: 1700614386.846,
  },
  {
    category: 'navigation',
    data: {
      from: '/search',
      to: '/search?lid=6363eefd-c2e0-4b34-9498-728bdfb8f8fb&sk=1700614377713000000&from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05',
    },
    timestamp: 1700614386.898,
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 301,
      url: 'http://localhost:8080/api/config',
    },
    timestamp: 1700614387.052,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 404,
      url: 'http://localhost:8000/logs/6363eefd-c2e0-4b34-9498-728bdfb8f8fb?sortKey=1700614377713000000',
    },
    timestamp: 1700614387.098,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 500,
      url: 'http://localhost:8000/logs?endTime=1700614377713&offset=0&q=trace_id%3A%22d543c1bb39a54d939e1eb2e4188a105c%22+&startTime=1700599977713&order=desc&limit=1500&extraFields%5B%5D=end_timestamp&extraFields%5B%5D=parent_span_id&extraFields%5B%5D=rum_session_id&extraFields%5B%5D=span_id&extraFields%5B%5D=teamName&extraFields%5B%5D=trace_id&extraFields%5B%5D=userEmail&extraFields%5B%5D=userName',
    },
    timestamp: 1700614387.156,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 403,
      url: 'http://localhost:8000/logs?endTime=1700628777713&offset=0&q=trace_id%3A%22d543c1bb39a54d939e1eb2e4188a105c%22+&startTime=1700614377713&order=asc&limit=1500&extraFields%5B%5D=end_timestamp&extraFields%5B%5D=parent_span_id&extraFields%5B%5D=rum_session_id&extraFields%5B%5D=span_id&extraFields%5B%5D=teamName&extraFields%5B%5D=trace_id&extraFields%5B%5D=userEmail&extraFields%5B%5D=userName',
    },
    timestamp: 1700614387.156,
    type: 'http',
  },
  {
    category: 'console',
    data: {
      arguments: [
        'Root nodes did not cover all events',
        0,
        '\n    at TraceChart (webpack-internal:///./src/LogSidePanel.tsx:260:25)\n    at TraceSubpanel (webpack-internal:///./src/LogSidePanel.tsx:488:25)\n    at div\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at div\n    at nav\n    at div\n    at EZDrawer (webpack-internal:///./node_modules/react-modern-drawer/dist/index.modern.js:70:20)\n    at LogSidePanel (webpack-internal:///./src/LogSidePanel.tsx:2333:23)\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at LogViewerContainer (webpack-internal:///./src/SearchPage.tsx:334:39)\n    at div\n    at div\n    at div\n    at SearchPage (webpack-internal:///./src/SearchPage.tsx:448:72)\n    at UserPreferencesProvider (webpack-internal:///./src/useUserPreferences.tsx:26:26)\n    at QueryClientProvider (webpack-internal:///./node_modules/react-query/es/react/QueryClientProvider.js:39:21)\n    at QueryParamProviderInner (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:28:3)\n    at NextAdapter (webpack-internal:///./node_modules/next-query-params/dist/next-query-params.esm.js:15:23)\n    at QueryParamProvider (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:47:3)\n    at QueryParamProvider (webpack-internal:///./src/useQueryParam.tsx:29:26)\n    at $704cf1d3b684cc5c$export$9f8ac96af4b1b2ae (webpack-internal:///./node_modules/@react-aria/ssr/dist/import.mjs:45:65)\n    at MyApp (webpack-internal:///./pages/_app.tsx:62:27)\n    at ErrorBoundary (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:20742)\n    at ReactDevOverlay (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:23635)\n    at Container (webpack-internal:///./node_modules/next/dist/client/index.js:70:9)\n    at AppContainer (webpack-internal:///./node_modules/next/dist/client/index.js:216:26)\n    at Root (webpack-internal:///./node_modules/next/dist/client/index.js:403:27)',
      ],
      logger: 'console',
    },
    level: 'warn',
    message:
      'Root nodes did not cover all events 0 \n    at TraceChart (webpack-internal:///./src/LogSidePanel.tsx:260:25)\n    at TraceSubpanel (webpack-internal:///./src/LogSidePanel.tsx:488:25)\n    at div\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at div\n    at nav\n    at div\n    at EZDrawer (webpack-internal:///./node_modules/react-modern-drawer/dist/index.modern.js:70:20)\n    at LogSidePanel (webpack-internal:///./src/LogSidePanel.tsx:2333:23)\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at LogViewerContainer (webpack-internal:///./src/SearchPage.tsx:334:39)\n    at div\n    at div\n    at div\n    at SearchPage (webpack-internal:///./src/SearchPage.tsx:448:72)\n    at UserPreferencesProvider (webpack-internal:///./src/useUserPreferences.tsx:26:26)\n    at QueryClientProvider (webpack-internal:///./node_modules/react-query/es/react/QueryClientProvider.js:39:21)\n    at QueryParamProviderInner (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:28:3)\n    at NextAdapter (webpack-internal:///./node_modules/next-query-params/dist/next-query-params.esm.js:15:23)\n    at QueryParamProvider (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:47:3)\n    at QueryParamProvider (webpack-internal:///./src/useQueryParam.tsx:29:26)\n    at $704cf1d3b684cc5c$export$9f8ac96af4b1b2ae (webpack-internal:///./node_modules/@react-aria/ssr/dist/import.mjs:45:65)\n    at MyApp (webpack-internal:///./pages/_app.tsx:62:27)\n    at ErrorBoundary (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:20742)\n    at ReactDevOverlay (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:23635)\n    at Container (webpack-internal:///./node_modules/next/dist/client/index.js:70:9)\n    at AppContainer (webpack-internal:///./node_modules/next/dist/client/index.js:216:26)\n    at Root (webpack-internal:///./node_modules/next/dist/client/index.js:403:27)',
    timestamp: 1700614387.166,
  },
  {
    category: 'xhr',
    data: {
      method: 'POST',
      status_code: 200,
      url: 'http://localhost:4318/v1/traces',
    },
    timestamp: 1700614389.525,
    type: 'http',
  },
  {
    category: 'ui.click',
    message:
      'label#EZDrawer__overlaylog-side-panel-6363eefd-c2e0-4b34-9498-728bdfb8f8fb.EZDrawer__overlay',
    timestamp: 1700614389.988,
  },
  {
    category: 'ui.click',
    message:
      'input#EZDrawer__checkboxlog-side-panel-6363eefd-c2e0-4b34-9498-728bdfb8f8fb.EZDrawer__checkbox[type="checkbox"]',
    timestamp: 1700614389.988,
  },
  {
    category: 'navigation',
    data: {
      from: '/search?lid=6363eefd-c2e0-4b34-9498-728bdfb8f8fb&sk=1700614377713000000&from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05',
      to: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05',
    },
    timestamp: 1700614389.991,
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8080/api/config',
    },
    timestamp: 1700614390.083,
    type: 'http',
  },
  {
    category: 'ui.click',
    message:
      'tr.LogTable_tableRow__Sil_V > td.align-top.overflow-hidden.text-truncate > span',
    timestamp: 1700614390.643,
  },
  {
    category: 'navigation',
    data: {
      from: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05',
      to: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05&lid=e18cc0b9-a883-491c-921a-2589e36ac838&sk=1700614380046000000',
    },
    timestamp: 1700614390.644,
  },
  {
    category: 'fetch',
    data: {
      method: 'POST',
      status_code: 200,
      url: 'http://localhost:4318/v1/logs',
    },
    timestamp: 1700614390.76,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8080/api/config',
    },
    timestamp: 1700614390.763,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs/e18cc0b9-a883-491c-921a-2589e36ac838?sortKey=1700614380046000000',
    },
    timestamp: 1700614390.794,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs?endTime=1700628780046&offset=0&q=trace_id%3A%22%22+&startTime=1700614380046&order=asc&limit=1500&extraFields%5B%5D=end_timestamp&extraFields%5B%5D=parent_span_id&extraFields%5B%5D=rum_session_id&extraFields%5B%5D=span_id&extraFields%5B%5D=teamName&extraFields%5B%5D=trace_id&extraFields%5B%5D=userEmail&extraFields%5B%5D=userName',
    },
    timestamp: 1700614390.839,
    type: 'http',
  },
  {
    category: 'ui.click',
    message:
      'label#EZDrawer__overlaylog-side-panel-e18cc0b9-a883-491c-921a-2589e36ac838.EZDrawer__overlay',
    timestamp: 1700614390.884,
  },
  {
    category: 'ui.click',
    message:
      'input#EZDrawer__checkboxlog-side-panel-e18cc0b9-a883-491c-921a-2589e36ac838.EZDrawer__checkbox[type="checkbox"]',
    timestamp: 1700614390.884,
  },
  {
    category: 'navigation',
    data: {
      from: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05&lid=e18cc0b9-a883-491c-921a-2589e36ac838&sk=1700614380046000000',
      to: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05',
    },
    timestamp: 1700614390.885,
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8080/api/config',
    },
    timestamp: 1700614390.968,
    type: 'http',
  },
  {
    category: 'ui.click',
    message:
      'tr.LogTable_tableRow__Sil_V > td.align-top.overflow-hidden.text-truncate',
    timestamp: 1700614391.177,
  },
  {
    category: 'navigation',
    data: {
      from: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05',
      to: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05&lid=d52ca7d5-d849-476c-a05c-73c2a3adfe83&sk=1700614380392000000',
    },
    timestamp: 1700614391.178,
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8080/api/config',
    },
    timestamp: 1700614391.272,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs/d52ca7d5-d849-476c-a05c-73c2a3adfe83?sortKey=1700614380392000000',
    },
    timestamp: 1700614391.297,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs?endTime=1700614380392&offset=0&q=trace_id%3A%22afb1ff12ec8b4d9a90d9c7b9d5eda600%22+&startTime=1700599980392&order=desc&limit=1500&extraFields%5B%5D=end_timestamp&extraFields%5B%5D=parent_span_id&extraFields%5B%5D=rum_session_id&extraFields%5B%5D=span_id&extraFields%5B%5D=teamName&extraFields%5B%5D=trace_id&extraFields%5B%5D=userEmail&extraFields%5B%5D=userName',
    },
    timestamp: 1700614391.34,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs?endTime=1700628780392&offset=0&q=trace_id%3A%22afb1ff12ec8b4d9a90d9c7b9d5eda600%22+&startTime=1700614380392&order=asc&limit=1500&extraFields%5B%5D=end_timestamp&extraFields%5B%5D=parent_span_id&extraFields%5B%5D=rum_session_id&extraFields%5B%5D=span_id&extraFields%5B%5D=teamName&extraFields%5B%5D=trace_id&extraFields%5B%5D=userEmail&extraFields%5B%5D=userName',
    },
    timestamp: 1700614391.346,
    type: 'http',
  },
  {
    category: 'console',
    data: {
      arguments: [
        'Root nodes did not cover all events',
        0,
        '\n    at TraceChart (webpack-internal:///./src/LogSidePanel.tsx:260:25)\n    at TraceSubpanel (webpack-internal:///./src/LogSidePanel.tsx:488:25)\n    at div\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at div\n    at nav\n    at div\n    at EZDrawer (webpack-internal:///./node_modules/react-modern-drawer/dist/index.modern.js:70:20)\n    at LogSidePanel (webpack-internal:///./src/LogSidePanel.tsx:2333:23)\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at LogViewerContainer (webpack-internal:///./src/SearchPage.tsx:334:39)\n    at div\n    at div\n    at div\n    at SearchPage (webpack-internal:///./src/SearchPage.tsx:448:72)\n    at UserPreferencesProvider (webpack-internal:///./src/useUserPreferences.tsx:26:26)\n    at QueryClientProvider (webpack-internal:///./node_modules/react-query/es/react/QueryClientProvider.js:39:21)\n    at QueryParamProviderInner (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:28:3)\n    at NextAdapter (webpack-internal:///./node_modules/next-query-params/dist/next-query-params.esm.js:15:23)\n    at QueryParamProvider (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:47:3)\n    at QueryParamProvider (webpack-internal:///./src/useQueryParam.tsx:29:26)\n    at $704cf1d3b684cc5c$export$9f8ac96af4b1b2ae (webpack-internal:///./node_modules/@react-aria/ssr/dist/import.mjs:45:65)\n    at MyApp (webpack-internal:///./pages/_app.tsx:62:27)\n    at ErrorBoundary (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:20742)\n    at ReactDevOverlay (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:23635)\n    at Container (webpack-internal:///./node_modules/next/dist/client/index.js:70:9)\n    at AppContainer (webpack-internal:///./node_modules/next/dist/client/index.js:216:26)\n    at Root (webpack-internal:///./node_modules/next/dist/client/index.js:403:27)',
      ],
      logger: 'console',
    },
    level: 'error',
    message:
      'Root nodes did not cover all events 0 \n    at TraceChart (webpack-internal:///./src/LogSidePanel.tsx:260:25)\n    at TraceSubpanel (webpack-internal:///./src/LogSidePanel.tsx:488:25)\n    at div\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at div\n    at nav\n    at div\n    at EZDrawer (webpack-internal:///./node_modules/react-modern-drawer/dist/index.modern.js:70:20)\n    at LogSidePanel (webpack-internal:///./src/LogSidePanel.tsx:2333:23)\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at LogViewerContainer (webpack-internal:///./src/SearchPage.tsx:334:39)\n    at div\n    at div\n    at div\n    at SearchPage (webpack-internal:///./src/SearchPage.tsx:448:72)\n    at UserPreferencesProvider (webpack-internal:///./src/useUserPreferences.tsx:26:26)\n    at QueryClientProvider (webpack-internal:///./node_modules/react-query/es/react/QueryClientProvider.js:39:21)\n    at QueryParamProviderInner (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:28:3)\n    at NextAdapter (webpack-internal:///./node_modules/next-query-params/dist/next-query-params.esm.js:15:23)\n    at QueryParamProvider (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:47:3)\n    at QueryParamProvider (webpack-internal:///./src/useQueryParam.tsx:29:26)\n    at $704cf1d3b684cc5c$export$9f8ac96af4b1b2ae (webpack-internal:///./node_modules/@react-aria/ssr/dist/import.mjs:45:65)\n    at MyApp (webpack-internal:///./pages/_app.tsx:62:27)\n    at ErrorBoundary (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:20742)\n    at ReactDevOverlay (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:23635)\n    at Container (webpack-internal:///./node_modules/next/dist/client/index.js:70:9)\n    at AppContainer (webpack-internal:///./node_modules/next/dist/client/index.js:216:26)\n    at Root (webpack-internal:///./node_modules/next/dist/client/index.js:403:27)',
    timestamp: 1700614391.348,
  },
  {
    category: 'xhr',
    data: {
      method: 'POST',
      status_code: 200,
      url: 'http://localhost:4318/v1/traces',
    },
    timestamp: 1700614393.928,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'POST',
      status_code: 200,
      url: 'http://localhost:4318/v1/logs',
    },
    timestamp: 1700614395.713,
    type: 'http',
  },
  {
    category: 'xhr',
    data: {
      method: 'POST',
      status_code: 200,
      url: 'http://localhost:4318/v1/traces',
    },
    timestamp: 1700614399.726,
    type: 'http',
  },
  {
    category: 'console',
    data: {
      arguments: [
        'Root nodes did not cover all events',
        0,
        '\n    at TraceChart (webpack-internal:///./src/LogSidePanel.tsx:260:25)\n    at TraceSubpanel (webpack-internal:///./src/LogSidePanel.tsx:488:25)\n    at div\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at div\n    at nav\n    at div\n    at EZDrawer (webpack-internal:///./node_modules/react-modern-drawer/dist/index.modern.js:70:20)\n    at LogSidePanel (webpack-internal:///./src/LogSidePanel.tsx:2333:23)\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at LogViewerContainer (webpack-internal:///./src/SearchPage.tsx:334:39)\n    at div\n    at div\n    at div\n    at SearchPage (webpack-internal:///./src/SearchPage.tsx:448:72)\n    at UserPreferencesProvider (webpack-internal:///./src/useUserPreferences.tsx:26:26)\n    at QueryClientProvider (webpack-internal:///./node_modules/react-query/es/react/QueryClientProvider.js:39:21)\n    at QueryParamProviderInner (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:28:3)\n    at NextAdapter (webpack-internal:///./node_modules/next-query-params/dist/next-query-params.esm.js:15:23)\n    at QueryParamProvider (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:47:3)\n    at QueryParamProvider (webpack-internal:///./src/useQueryParam.tsx:29:26)\n    at $704cf1d3b684cc5c$export$9f8ac96af4b1b2ae (webpack-internal:///./node_modules/@react-aria/ssr/dist/import.mjs:45:65)\n    at MyApp (webpack-internal:///./pages/_app.tsx:62:27)\n    at ErrorBoundary (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:20742)\n    at ReactDevOverlay (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:23635)\n    at Container (webpack-internal:///./node_modules/next/dist/client/index.js:70:9)\n    at AppContainer (webpack-internal:///./node_modules/next/dist/client/index.js:216:26)\n    at Root (webpack-internal:///./node_modules/next/dist/client/index.js:403:27)',
      ],
      logger: 'console',
    },
    level: 'error',
    message:
      'Root nodes did not cover all events 0 \n    at TraceChart (webpack-internal:///./src/LogSidePanel.tsx:260:25)\n    at TraceSubpanel (webpack-internal:///./src/LogSidePanel.tsx:488:25)\n    at div\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at div\n    at nav\n    at div\n    at EZDrawer (webpack-internal:///./node_modules/react-modern-drawer/dist/index.modern.js:70:20)\n    at LogSidePanel (webpack-internal:///./src/LogSidePanel.tsx:2333:23)\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at LogViewerContainer (webpack-internal:///./src/SearchPage.tsx:334:39)\n    at div\n    at div\n    at div\n    at SearchPage (webpack-internal:///./src/SearchPage.tsx:448:72)\n    at UserPreferencesProvider (webpack-internal:///./src/useUserPreferences.tsx:26:26)\n    at QueryClientProvider (webpack-internal:///./node_modules/react-query/es/react/QueryClientProvider.js:39:21)\n    at QueryParamProviderInner (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:28:3)\n    at NextAdapter (webpack-internal:///./node_modules/next-query-params/dist/next-query-params.esm.js:15:23)\n    at QueryParamProvider (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:47:3)\n    at QueryParamProvider (webpack-internal:///./src/useQueryParam.tsx:29:26)\n    at $704cf1d3b684cc5c$export$9f8ac96af4b1b2ae (webpack-internal:///./node_modules/@react-aria/ssr/dist/import.mjs:45:65)\n    at MyApp (webpack-internal:///./pages/_app.tsx:62:27)\n    at ErrorBoundary (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:20742)\n    at ReactDevOverlay (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:23635)\n    at Container (webpack-internal:///./node_modules/next/dist/client/index.js:70:9)\n    at AppContainer (webpack-internal:///./node_modules/next/dist/client/index.js:216:26)\n    at Root (webpack-internal:///./node_modules/next/dist/client/index.js:403:27)',
    timestamp: 1700614401.026,
  },
  {
    category: 'console',
    data: {
      arguments: [
        'Root nodes did not cover all events',
        0,
        '\n    at TraceChart (webpack-internal:///./src/LogSidePanel.tsx:260:25)\n    at TraceSubpanel (webpack-internal:///./src/LogSidePanel.tsx:488:25)\n    at div\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at div\n    at nav\n    at div\n    at EZDrawer (webpack-internal:///./node_modules/react-modern-drawer/dist/index.modern.js:70:20)\n    at LogSidePanel (webpack-internal:///./src/LogSidePanel.tsx:2333:23)\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at LogViewerContainer (webpack-internal:///./src/SearchPage.tsx:334:39)\n    at div\n    at div\n    at div\n    at SearchPage (webpack-internal:///./src/SearchPage.tsx:448:72)\n    at UserPreferencesProvider (webpack-internal:///./src/useUserPreferences.tsx:26:26)\n    at QueryClientProvider (webpack-internal:///./node_modules/react-query/es/react/QueryClientProvider.js:39:21)\n    at QueryParamProviderInner (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:28:3)\n    at NextAdapter (webpack-internal:///./node_modules/next-query-params/dist/next-query-params.esm.js:15:23)\n    at QueryParamProvider (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:47:3)\n    at QueryParamProvider (webpack-internal:///./src/useQueryParam.tsx:29:26)\n    at $704cf1d3b684cc5c$export$9f8ac96af4b1b2ae (webpack-internal:///./node_modules/@react-aria/ssr/dist/import.mjs:45:65)\n    at MyApp (webpack-internal:///./pages/_app.tsx:62:27)\n    at ErrorBoundary (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:20742)\n    at ReactDevOverlay (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:23635)\n    at Container (webpack-internal:///./node_modules/next/dist/client/index.js:70:9)\n    at AppContainer (webpack-internal:///./node_modules/next/dist/client/index.js:216:26)\n    at Root (webpack-internal:///./node_modules/next/dist/client/index.js:403:27)',
      ],
      logger: 'console',
    },
    level: 'error',
    message:
      'Root nodes did not cover all events 0 \n    at TraceChart (webpack-internal:///./src/LogSidePanel.tsx:260:25)\n    at TraceSubpanel (webpack-internal:///./src/LogSidePanel.tsx:488:25)\n    at div\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at div\n    at nav\n    at div\n    at EZDrawer (webpack-internal:///./node_modules/react-modern-drawer/dist/index.modern.js:70:20)\n    at LogSidePanel (webpack-internal:///./src/LogSidePanel.tsx:2333:23)\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at LogViewerContainer (webpack-internal:///./src/SearchPage.tsx:334:39)\n    at div\n    at div\n    at div\n    at SearchPage (webpack-internal:///./src/SearchPage.tsx:448:72)\n    at UserPreferencesProvider (webpack-internal:///./src/useUserPreferences.tsx:26:26)\n    at QueryClientProvider (webpack-internal:///./node_modules/react-query/es/react/QueryClientProvider.js:39:21)\n    at QueryParamProviderInner (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:28:3)\n    at NextAdapter (webpack-internal:///./node_modules/next-query-params/dist/next-query-params.esm.js:15:23)\n    at QueryParamProvider (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:47:3)\n    at QueryParamProvider (webpack-internal:///./src/useQueryParam.tsx:29:26)\n    at $704cf1d3b684cc5c$export$9f8ac96af4b1b2ae (webpack-internal:///./node_modules/@react-aria/ssr/dist/import.mjs:45:65)\n    at MyApp (webpack-internal:///./pages/_app.tsx:62:27)\n    at ErrorBoundary (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:20742)\n    at ReactDevOverlay (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:23635)\n    at Container (webpack-internal:///./node_modules/next/dist/client/index.js:70:9)\n    at AppContainer (webpack-internal:///./node_modules/next/dist/client/index.js:216:26)\n    at Root (webpack-internal:///./node_modules/next/dist/client/index.js:403:27)',
    timestamp: 1700614403.177,
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/log-views',
    },
    timestamp: 1700614403.221,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/dashboards',
    },
    timestamp: 1700614403.225,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/me',
    },
    timestamp: 1700614403.226,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/team',
    },
    timestamp: 1700614403.226,
    type: 'http',
  },
  {
    category: 'console',
    data: {
      arguments: [
        'Root nodes did not cover all events',
        0,
        '\n    at TraceChart (webpack-internal:///./src/LogSidePanel.tsx:260:25)\n    at TraceSubpanel (webpack-internal:///./src/LogSidePanel.tsx:488:25)\n    at div\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at div\n    at nav\n    at div\n    at EZDrawer (webpack-internal:///./node_modules/react-modern-drawer/dist/index.modern.js:70:20)\n    at LogSidePanel (webpack-internal:///./src/LogSidePanel.tsx:2333:23)\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at LogViewerContainer (webpack-internal:///./src/SearchPage.tsx:334:39)\n    at div\n    at div\n    at div\n    at SearchPage (webpack-internal:///./src/SearchPage.tsx:448:72)\n    at UserPreferencesProvider (webpack-internal:///./src/useUserPreferences.tsx:26:26)\n    at QueryClientProvider (webpack-internal:///./node_modules/react-query/es/react/QueryClientProvider.js:39:21)\n    at QueryParamProviderInner (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:28:3)\n    at NextAdapter (webpack-internal:///./node_modules/next-query-params/dist/next-query-params.esm.js:15:23)\n    at QueryParamProvider (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:47:3)\n    at QueryParamProvider (webpack-internal:///./src/useQueryParam.tsx:29:26)\n    at $704cf1d3b684cc5c$export$9f8ac96af4b1b2ae (webpack-internal:///./node_modules/@react-aria/ssr/dist/import.mjs:45:65)\n    at MyApp (webpack-internal:///./pages/_app.tsx:62:27)\n    at ErrorBoundary (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:20742)\n    at ReactDevOverlay (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:23635)\n    at Container (webpack-internal:///./node_modules/next/dist/client/index.js:70:9)\n    at AppContainer (webpack-internal:///./node_modules/next/dist/client/index.js:216:26)\n    at Root (webpack-internal:///./node_modules/next/dist/client/index.js:403:27)',
      ],
      logger: 'console',
    },
    level: 'error',
    message:
      'Root nodes did not cover all events 0 \n    at TraceChart (webpack-internal:///./src/LogSidePanel.tsx:260:25)\n    at TraceSubpanel (webpack-internal:///./src/LogSidePanel.tsx:488:25)\n    at div\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at div\n    at nav\n    at div\n    at EZDrawer (webpack-internal:///./node_modules/react-modern-drawer/dist/index.modern.js:70:20)\n    at LogSidePanel (webpack-internal:///./src/LogSidePanel.tsx:2333:23)\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at LogViewerContainer (webpack-internal:///./src/SearchPage.tsx:334:39)\n    at div\n    at div\n    at div\n    at SearchPage (webpack-internal:///./src/SearchPage.tsx:448:72)\n    at UserPreferencesProvider (webpack-internal:///./src/useUserPreferences.tsx:26:26)\n    at QueryClientProvider (webpack-internal:///./node_modules/react-query/es/react/QueryClientProvider.js:39:21)\n    at QueryParamProviderInner (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:28:3)\n    at NextAdapter (webpack-internal:///./node_modules/next-query-params/dist/next-query-params.esm.js:15:23)\n    at QueryParamProvider (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:47:3)\n    at QueryParamProvider (webpack-internal:///./src/useQueryParam.tsx:29:26)\n    at $704cf1d3b684cc5c$export$9f8ac96af4b1b2ae (webpack-internal:///./node_modules/@react-aria/ssr/dist/import.mjs:45:65)\n    at MyApp (webpack-internal:///./pages/_app.tsx:62:27)\n    at ErrorBoundary (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:20742)\n    at ReactDevOverlay (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:23635)\n    at Container (webpack-internal:///./node_modules/next/dist/client/index.js:70:9)\n    at AppContainer (webpack-internal:///./node_modules/next/dist/client/index.js:216:26)\n    at Root (webpack-internal:///./node_modules/next/dist/client/index.js:403:27)',
    timestamp: 1700614403.246,
  },
  {
    category: 'ui.click',
    message:
      'div.d-flex.align-items-center.mb-1.text-white-hover > div.fs-7.text-slate-200',
    timestamp: 1700614403.289,
  },
  {
    category: 'ui.click',
    message:
      'label#EZDrawer__overlaylog-side-panel-d52ca7d5-d849-476c-a05c-73c2a3adfe83.EZDrawer__overlay',
    timestamp: 1700614404.577,
  },
  {
    category: 'ui.click',
    message:
      'input#EZDrawer__checkboxlog-side-panel-d52ca7d5-d849-476c-a05c-73c2a3adfe83.EZDrawer__checkbox[type="checkbox"]',
    timestamp: 1700614404.578,
  },
  {
    category: 'navigation',
    data: {
      from: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05&lid=d52ca7d5-d849-476c-a05c-73c2a3adfe83&sk=1700614380392000000',
      to: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05',
    },
    timestamp: 1700614404.58,
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8080/api/config',
    },
    timestamp: 1700614404.646,
    type: 'http',
  },
  {
    category: 'xhr',
    data: {
      method: 'POST',
      status_code: 200,
      url: 'http://localhost:4318/v1/traces',
    },
    timestamp: 1700614405.048,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'POST',
      status_code: 200,
      url: 'http://localhost:4318/v1/logs',
    },
    timestamp: 1700614406.081,
    type: 'http',
  },
  {
    category: 'xhr',
    data: {
      method: 'POST',
      status_code: 200,
      url: 'http://localhost:4318/v1/traces',
    },
    timestamp: 1700614410.095,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/log-views',
    },
    timestamp: 1700614429.716,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/dashboards',
    },
    timestamp: 1700614429.718,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/me',
    },
    timestamp: 1700614429.718,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/team',
    },
    timestamp: 1700614429.718,
    type: 'http',
  },
  {
    category: 'xhr',
    data: {
      method: 'POST',
      status_code: 200,
      url: 'http://localhost:4318/v1/traces',
    },
    timestamp: 1700614433.734,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'POST',
      status_code: 200,
      url: 'http://localhost:4318/v1/logs',
    },
    timestamp: 1700614434.196,
    type: 'http',
  },
  {
    category: 'console',
    data: {
      arguments: ['[Fast Refresh] rebuilding'],
      logger: 'console',
    },
    level: 'log',
    message: '[Fast Refresh] rebuilding',
    timestamp: 1700614457.825,
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8080/_next/static/webpack/ab04658d24484bcd.webpack.hot-update.json',
    },
    timestamp: 1700614458.993,
    type: 'http',
  },
  {
    category: 'console',
    data: {
      arguments: ['[Fast Refresh] done in 1196ms'],
      logger: 'console',
    },
    level: 'log',
    message: '[Fast Refresh] done in 1196ms',
    timestamp: 1700614459.02,
  },
  {
    category: 'xhr',
    data: {
      method: 'POST',
      status_code: 200,
      url: 'http://localhost:4318/v1/traces',
    },
    timestamp: 1700614461.837,
    type: 'http',
  },
  {
    category: 'console',
    data: {
      arguments: ['[Fast Refresh] rebuilding'],
      logger: 'console',
    },
    level: 'log',
    message: '[Fast Refresh] rebuilding',
    timestamp: 1700614462.73,
  },
  {
    category: 'fetch',
    data: {
      method: 'POST',
      status_code: 200,
      url: 'http://localhost:4318/v1/logs',
    },
    timestamp: 1700614462.832,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8080/_next/static/webpack/df34ac0440b36ae9.webpack.hot-update.json',
    },
    timestamp: 1700614463.063,
    type: 'http',
  },
  {
    category: 'console',
    data: {
      arguments: ['[Fast Refresh] done in 360ms'],
      logger: 'console',
    },
    level: 'log',
    message: '[Fast Refresh] done in 360ms',
    timestamp: 1700614463.09,
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/log-views',
    },
    timestamp: 1700614463.486,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/dashboards',
    },
    timestamp: 1700614463.488,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/me',
    },
    timestamp: 1700614463.488,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/team',
    },
    timestamp: 1700614463.488,
    type: 'http',
  },
  {
    category: 'ui.click',
    message:
      'tr.LogTable_tableRow__Sil_V > td.align-top.overflow-hidden.text-truncate',
    timestamp: 1700614463.712,
  },
  {
    category: 'navigation',
    data: {
      from: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05',
      to: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05&lid=f8ded9a7-9b1c-402c-a34d-64c36ea89bc3&sk=1700614372868000000',
    },
    timestamp: 1700614463.713,
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs/f8ded9a7-9b1c-402c-a34d-64c36ea89bc3?sortKey=1700614372868000000',
    },
    timestamp: 1700614463.828,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8080/api/config',
    },
    timestamp: 1700614463.868,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs?endTime=1700628772868&offset=0&q=trace_id%3A%225487f9962524b736d1cf582e7e7bf47b%22+&startTime=1700614372868&order=asc&limit=1500&extraFields%5B%5D=end_timestamp&extraFields%5B%5D=parent_span_id&extraFields%5B%5D=rum_session_id&extraFields%5B%5D=span_id&extraFields%5B%5D=teamName&extraFields%5B%5D=trace_id&extraFields%5B%5D=userEmail&extraFields%5B%5D=userName',
    },
    timestamp: 1700614463.911,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs?endTime=1700614372868&offset=0&q=trace_id%3A%225487f9962524b736d1cf582e7e7bf47b%22+&startTime=1700599972868&order=desc&limit=1500&extraFields%5B%5D=end_timestamp&extraFields%5B%5D=parent_span_id&extraFields%5B%5D=rum_session_id&extraFields%5B%5D=span_id&extraFields%5B%5D=teamName&extraFields%5B%5D=trace_id&extraFields%5B%5D=userEmail&extraFields%5B%5D=userName',
    },
    timestamp: 1700614463.929,
    type: 'http',
  },
  {
    category: 'ui.click',
    message:
      'label#EZDrawer__overlaylog-side-panel-f8ded9a7-9b1c-402c-a34d-64c36ea89bc3.EZDrawer__overlay',
    timestamp: 1700614464.587,
  },
  {
    category: 'ui.click',
    message:
      'input#EZDrawer__checkboxlog-side-panel-f8ded9a7-9b1c-402c-a34d-64c36ea89bc3.EZDrawer__checkbox[type="checkbox"]',
    timestamp: 1700614464.587,
  },
  {
    category: 'navigation',
    data: {
      from: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05&lid=f8ded9a7-9b1c-402c-a34d-64c36ea89bc3&sk=1700614372868000000',
      to: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05',
    },
    timestamp: 1700614464.591,
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8080/api/config',
    },
    timestamp: 1700614464.673,
    type: 'http',
  },
  {
    category: 'ui.click',
    message:
      'tr.LogTable_tableRow__Sil_V > td.align-top.overflow-hidden.text-truncate',
    timestamp: 1700614464.998,
  },
  {
    category: 'navigation',
    data: {
      from: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05',
      to: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05&lid=8f15b86b-5a16-4f4f-9fc5-175d758ac015&sk=1700614373937000000',
    },
    timestamp: 1700614465,
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8080/api/config',
    },
    timestamp: 1700614465.077,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs/8f15b86b-5a16-4f4f-9fc5-175d758ac015?sortKey=1700614373937000000',
    },
    timestamp: 1700614465.101,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs?endTime=1700614373937&offset=0&q=trace_id%3A%224879cd4c130096dcb5338f29a323f517%22+&startTime=1700599973937&order=desc&limit=1500&extraFields%5B%5D=end_timestamp&extraFields%5B%5D=parent_span_id&extraFields%5B%5D=rum_session_id&extraFields%5B%5D=span_id&extraFields%5B%5D=teamName&extraFields%5B%5D=trace_id&extraFields%5B%5D=userEmail&extraFields%5B%5D=userName',
    },
    timestamp: 1700614465.151,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs?endTime=1700628773937&offset=0&q=trace_id%3A%224879cd4c130096dcb5338f29a323f517%22+&startTime=1700614373937&order=asc&limit=1500&extraFields%5B%5D=end_timestamp&extraFields%5B%5D=parent_span_id&extraFields%5B%5D=rum_session_id&extraFields%5B%5D=span_id&extraFields%5B%5D=teamName&extraFields%5B%5D=trace_id&extraFields%5B%5D=userEmail&extraFields%5B%5D=userName',
    },
    timestamp: 1700614465.161,
    type: 'http',
  },
  {
    category: 'ui.click',
    message:
      'label#EZDrawer__overlaylog-side-panel-8f15b86b-5a16-4f4f-9fc5-175d758ac015.EZDrawer__overlay',
    timestamp: 1700614465.404,
  },
  {
    category: 'ui.click',
    message:
      'input#EZDrawer__checkboxlog-side-panel-8f15b86b-5a16-4f4f-9fc5-175d758ac015.EZDrawer__checkbox[type="checkbox"]',
    timestamp: 1700614465.405,
  },
  {
    category: 'navigation',
    data: {
      from: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05&lid=8f15b86b-5a16-4f4f-9fc5-175d758ac015&sk=1700614373937000000',
      to: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05',
    },
    timestamp: 1700614465.406,
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8080/api/config',
    },
    timestamp: 1700614465.483,
    type: 'http',
  },
  {
    category: 'ui.click',
    message:
      'tr.LogTable_tableRow__Sil_V > td.align-top.overflow-hidden.text-truncate',
    timestamp: 1700614465.639,
  },
  {
    category: 'navigation',
    data: {
      from: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05',
      to: '/search?from=1700613485000&to=1700614385000&tq=Nov+21+17%3A38%3A05+-+Nov+21+17%3A53%3A05&lid=ac72e41d-d841-49a6-ae43-c47e52ae2c94&sk=1700614374831000000',
    },
    timestamp: 1700614465.64,
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8080/api/config',
    },
    timestamp: 1700614465.721,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs/ac72e41d-d841-49a6-ae43-c47e52ae2c94?sortKey=1700614374831000000',
    },
    timestamp: 1700614465.735,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs?endTime=1700628774831&offset=0&q=trace_id%3A%223c8646b2b3c34db5971a729185d1a3c0%22+&startTime=1700614374831&order=asc&limit=1500&extraFields%5B%5D=end_timestamp&extraFields%5B%5D=parent_span_id&extraFields%5B%5D=rum_session_id&extraFields%5B%5D=span_id&extraFields%5B%5D=teamName&extraFields%5B%5D=trace_id&extraFields%5B%5D=userEmail&extraFields%5B%5D=userName',
    },
    timestamp: 1700614465.77,
    type: 'http',
  },
  {
    category: 'fetch',
    data: {
      method: 'GET',
      status_code: 200,
      url: 'http://localhost:8000/logs?endTime=1700614374831&offset=0&q=trace_id%3A%223c8646b2b3c34db5971a729185d1a3c0%22+&startTime=1700599974831&order=desc&limit=1500&extraFields%5B%5D=end_timestamp&extraFields%5B%5D=parent_span_id&extraFields%5B%5D=rum_session_id&extraFields%5B%5D=span_id&extraFields%5B%5D=teamName&extraFields%5B%5D=trace_id&extraFields%5B%5D=userEmail&extraFields%5B%5D=userName',
    },
    timestamp: 1700614465.775,
    type: 'http',
  },
  {
    category: 'console',
    data: {
      arguments: [
        'Root nodes did not cover all events',
        0,
        '\n    at TraceChart (webpack-internal:///./src/LogSidePanel.tsx:260:25)\n    at TraceSubpanel (webpack-internal:///./src/LogSidePanel.tsx:488:25)\n    at div\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at div\n    at nav\n    at div\n    at EZDrawer (webpack-internal:///./node_modules/react-modern-drawer/dist/index.modern.js:70:20)\n    at LogSidePanel (webpack-internal:///./src/LogSidePanel.tsx:2333:23)\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at LogViewerContainer (webpack-internal:///./src/SearchPage.tsx:334:39)\n    at div\n    at div\n    at div\n    at SearchPage (webpack-internal:///./src/SearchPage.tsx:448:72)\n    at UserPreferencesProvider (webpack-internal:///./src/useUserPreferences.tsx:26:26)\n    at QueryClientProvider (webpack-internal:///./node_modules/react-query/es/react/QueryClientProvider.js:39:21)\n    at QueryParamProviderInner (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:28:3)\n    at NextAdapter (webpack-internal:///./node_modules/next-query-params/dist/next-query-params.esm.js:15:23)\n    at QueryParamProvider (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:47:3)\n    at QueryParamProvider (webpack-internal:///./src/useQueryParam.tsx:29:26)\n    at $704cf1d3b684cc5c$export$9f8ac96af4b1b2ae (webpack-internal:///./node_modules/@react-aria/ssr/dist/import.mjs:45:65)\n    at MyApp (webpack-internal:///./pages/_app.tsx:62:27)\n    at ErrorBoundary (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:20742)\n    at ReactDevOverlay (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:23635)\n    at Container (webpack-internal:///./node_modules/next/dist/client/index.js:70:9)\n    at AppContainer (webpack-internal:///./node_modules/next/dist/client/index.js:216:26)\n    at Root (webpack-internal:///./node_modules/next/dist/client/index.js:403:27)',
      ],
      logger: 'console',
    },
    level: 'error',
    message:
      'Root nodes did not cover all events 0 \n    at TraceChart (webpack-internal:///./src/LogSidePanel.tsx:260:25)\n    at TraceSubpanel (webpack-internal:///./src/LogSidePanel.tsx:488:25)\n    at div\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at div\n    at nav\n    at div\n    at EZDrawer (webpack-internal:///./node_modules/react-modern-drawer/dist/index.modern.js:70:20)\n    at LogSidePanel (webpack-internal:///./src/LogSidePanel.tsx:2333:23)\n    at ErrorBoundary (webpack-internal:///./node_modules/react-error-boundary/dist/react-error-boundary.umd.js:69:37)\n    at LogViewerContainer (webpack-internal:///./src/SearchPage.tsx:334:39)\n    at div\n    at div\n    at div\n    at SearchPage (webpack-internal:///./src/SearchPage.tsx:448:72)\n    at UserPreferencesProvider (webpack-internal:///./src/useUserPreferences.tsx:26:26)\n    at QueryClientProvider (webpack-internal:///./node_modules/react-query/es/react/QueryClientProvider.js:39:21)\n    at QueryParamProviderInner (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:28:3)\n    at NextAdapter (webpack-internal:///./node_modules/next-query-params/dist/next-query-params.esm.js:15:23)\n    at QueryParamProvider (webpack-internal:///./node_modules/use-query-params/dist/QueryParamProvider.js:47:3)\n    at QueryParamProvider (webpack-internal:///./src/useQueryParam.tsx:29:26)\n    at $704cf1d3b684cc5c$export$9f8ac96af4b1b2ae (webpack-internal:///./node_modules/@react-aria/ssr/dist/import.mjs:45:65)\n    at MyApp (webpack-internal:///./pages/_app.tsx:62:27)\n    at ErrorBoundary (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:20742)\n    at ReactDevOverlay (webpack-internal:///./node_modules/next/dist/compiled/@next/react-dev-overlay/dist/client.js:8:23635)\n    at Container (webpack-internal:///./node_modules/next/dist/client/index.js:70:9)\n    at AppContainer (webpack-internal:///./node_modules/next/dist/client/index.js:216:26)\n    at Root (webpack-internal:///./node_modules/next/dist/client/index.js:403:27)',
    timestamp: 1700614465.779,
  },
  {
    category: 'ui.click',
    message:
      'div.text-center.cursor-pointer.text-muted-hover > span > span.mx-4.text-nowrap',
    timestamp: 1700614466.654,
  },
];
