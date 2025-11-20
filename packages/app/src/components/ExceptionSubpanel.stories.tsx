import React from 'react';

import { ExceptionSubpanel } from './ExceptionSubpanel';

export default {
  title: 'Components/ExceptionSubpanel',
  component: ExceptionSubpanel,
};

const mockExceptionValues = [
  {
    type: 'TypeError',
    value: 'Cannot read property "foo" of undefined',
    mechanism: {
      type: 'generic',
      handled: false,
      data: {
        function: 'myFunction',
        handler: 'errorHandler',
        target: 'window',
      },
    },
    stacktrace: {
      frames: [
        {
          filename: 'App.js',
          function: 'myFunction',
          lineno: 42,
          colno: 13,
          in_app: true,
          context_line: 'const foo = bar.foo;',
          pre_context: ['function myFunction() {'],
          post_context: ['return foo;'],
        },
        {
          filename: 'index.js',
          function: 'main',
          lineno: 10,
          colno: 5,
          in_app: false,
          context_line: 'main();',
          pre_context: ['import App from "./App";'],
          post_context: ['console.log("done");'],
        },
      ],
    },
  },
];

const mockBreadcrumbs = [
  {
    category: 'ui.click',
    message: 'Button clicked',
    timestamp: 1700000000,
  },
  {
    category: 'fetch',
    message: 'GET /api/data',
    data: { method: 'GET', url: '/api/data', status_code: 200 },
    timestamp: 1700000001,
  },
  {
    category: 'console',
    message: 'Error: Something went wrong',
    level: 'error',
    timestamp: 1700000002,
  },
];

const mockLogData = {
  timestamp: 1700000000000,
};

export const Default = () => (
  <ExceptionSubpanel
    logData={mockLogData}
    breadcrumbs={mockBreadcrumbs}
    exceptionValues={mockExceptionValues}
  />
);
