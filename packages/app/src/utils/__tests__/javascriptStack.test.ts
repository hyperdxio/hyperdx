import {
  isJavaScriptRuntime,
  parseJavaScriptException,
} from '@/utils/javascriptStack';

const APP = 'https://app.example.com/assets/app.js';

const framesOf = (stack: string) => parseJavaScriptException(stack)?.frames;

describe('parseJavaScriptException', () => {
  it('parses a Chrome stack oldest first, keeping URLs and 1-based columns', () => {
    const stack = [
      "TypeError: Cannot read properties of undefined (reading 'id')",
      '    at c (https://app.example.com/_next/static/chunks/pages/checkout-3f2a.js:1:2817)',
      '    at Object.Ub (https://app.example.com/_next/static/chunks/framework-2c79e2a64abdb08b.js:9:16994)',
      `    at ${APP}:5:10`,
    ].join('\n');

    expect(parseJavaScriptException(stack)).toEqual({
      frames: [
        { filename: APP, function: '?', lineno: 5, colno: 10, in_app: true },
        {
          filename:
            'https://app.example.com/_next/static/chunks/framework-2c79e2a64abdb08b.js',
          function: 'Object.Ub',
          lineno: 9,
          colno: 16994,
          in_app: false,
        },
        {
          filename:
            'https://app.example.com/_next/static/chunks/pages/checkout-3f2a.js',
          function: 'c',
          lineno: 1,
          colno: 2817,
          in_app: true,
        },
      ],
      causes: [],
    });
  });

  it('parses Chrome eval and async frames', () => {
    const stack = [
      'Error: bad',
      '    at eval (eval at aha (http://localhost:5000/app.js:37:5), <anonymous>:1:1)',
      `    at async submit (${APP}:130:5)`,
      '    at Object.callback (async http://localhost:5000/app.js:25:7)',
    ].join('\n');

    expect(framesOf(stack)).toEqual([
      {
        filename: 'http://localhost:5000/app.js',
        function: 'Object.callback',
        lineno: 25,
        colno: 7,
        in_app: true,
      },
      {
        filename: APP,
        function: 'async submit',
        lineno: 130,
        colno: 5,
        in_app: true,
      },
      {
        filename: 'http://localhost:5000/app.js',
        function: 'eval',
        lineno: 37,
        colno: 5,
        in_app: true,
      },
    ]);
  });

  it('parses a Node stack and marks library and runtime frames', () => {
    const stack = [
      'Error: boom',
      '    at handler (/srv/app/dist/server.js:12:9)',
      '    at Layer.handle (/srv/app/node_modules/express/lib/router/layer.js:95:5)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
      '    at async Promise.all (index 0)',
    ].join('\n');

    expect(framesOf(stack)).toEqual([
      {
        filename: 'index 0',
        function: 'async Promise.all',
        in_app: false,
      },
      {
        filename: 'node:internal/process/task_queues',
        function: 'process.processTicksAndRejections',
        lineno: 95,
        colno: 5,
        in_app: false,
      },
      {
        filename: '/srv/app/node_modules/express/lib/router/layer.js',
        function: 'Layer.handle',
        lineno: 95,
        colno: 5,
        in_app: false,
      },
      {
        filename: '/srv/app/dist/server.js',
        function: 'handler',
        lineno: 12,
        colno: 9,
        in_app: true,
      },
    ]);
  });

  it('parses a Firefox stack, including async and eval frames', () => {
    const stack = [
      'aha@http://localhost:5000/app.js line 37 > eval:1:1',
      `checkout@${APP}:120:11`,
      `async*submit@${APP}:130:5`,
      `@${APP}:150:1`,
    ].join('\n');

    expect(framesOf(stack)).toEqual([
      { filename: APP, function: '?', lineno: 150, colno: 1, in_app: true },
      {
        filename: APP,
        function: 'async*submit',
        lineno: 130,
        colno: 5,
        in_app: true,
      },
      {
        filename: APP,
        function: 'checkout',
        lineno: 120,
        colno: 11,
        in_app: true,
      },
      {
        filename: 'http://localhost:5000/app.js',
        function: 'aha',
        lineno: 37,
        in_app: true,
      },
    ]);
  });

  it('parses a Safari stack, dropping eval code frames', () => {
    const stack = [
      'forEach@[native code]',
      `checkout@${APP}:120:11`,
      'eval code@',
      `global code@${APP}:150:1`,
    ].join('\n');

    expect(framesOf(stack)).toEqual([
      {
        filename: APP,
        function: 'global code',
        lineno: 150,
        colno: 1,
        in_app: true,
      },
      {
        filename: APP,
        function: 'checkout',
        lineno: 120,
        colno: 11,
        in_app: true,
      },
      { filename: '[native code]', function: 'forEach', in_app: false },
    ]);
  });

  it('splits Chrome Caused by sections into causes with their own frames', () => {
    const stack = [
      'Error: Checkout failed',
      `    at checkout (${APP}:120:11)`,
      'Caused by: TypeError: Failed to fetch',
      `    at fetchCart (${APP}:42:9)`,
      'Caused by: Error',
      `    at request (${APP}:10:3)`,
    ].join('\n');

    expect(parseJavaScriptException(stack)).toEqual({
      frames: [
        {
          filename: APP,
          function: 'checkout',
          lineno: 120,
          colno: 11,
          in_app: true,
        },
      ],
      causes: [
        {
          type: 'TypeError',
          value: 'Failed to fetch',
          frames: [
            {
              filename: APP,
              function: 'fetchCart',
              lineno: 42,
              colno: 9,
              in_app: true,
            },
          ],
        },
        {
          type: 'Error',
          value: '',
          frames: [
            {
              filename: APP,
              function: 'request',
              lineno: 10,
              colno: 3,
              in_app: true,
            },
          ],
        },
      ],
    });
  });

  it('splits a Firefox stack whose cause has a Name: message line', () => {
    const stack = [
      `checkout@${APP}:120:11`,
      'Caused by: TypeError: NetworkError when attempting to fetch resource.',
      `fetchCart@${APP}:42:9`,
    ].join('\n');

    expect(parseJavaScriptException(stack)).toEqual({
      frames: [
        {
          filename: APP,
          function: 'checkout',
          lineno: 120,
          colno: 11,
          in_app: true,
        },
      ],
      causes: [
        {
          type: 'TypeError',
          value: 'NetworkError when attempting to fetch resource.',
          frames: [
            {
              filename: APP,
              function: 'fetchCart',
              lineno: 42,
              colno: 9,
              in_app: true,
            },
          ],
        },
      ],
    });
  });

  it('titles a cause without a Name: prefix by its whole line', () => {
    const stack = [
      `    at checkout (${APP}:120:11)`,
      'Caused by: request timed out after 30s',
    ].join('\n');

    expect(parseJavaScriptException(stack)?.causes).toEqual([
      { type: '', value: 'request timed out after 30s', frames: [] },
    ]);
  });

  it('does not read URLs in a multi-line message as frames', () => {
    const stack = [
      'Error: Checkout failed',
      'https://api.example.com/cart returned 500',
      `    at checkout (${APP}:120:11)`,
      'Caused by: Error: Request failed',
      'https://api.example.com/cart/items returned 503',
      `    at fetchCart (${APP}:42:9)`,
    ].join('\n');

    const parsed = parseJavaScriptException(stack);

    expect(parsed?.frames.map(frame => frame.function)).toEqual(['checkout']);
    expect(parsed?.causes).toEqual([
      expect.objectContaining({
        type: 'Error',
        value:
          'Request failed\nhttps://api.example.com/cart/items returned 503',
        frames: [expect.objectContaining({ function: 'fetchCart' })],
      }),
    ]);
  });

  it('does not read URLs in a multi-line Firefox cause message as frames', () => {
    const stack = [
      `checkout@${APP}:120:11`,
      'Caused by: GraphQLError: Validation failed:',
      '  - field "email" is required',
      '  - see https://docs.example.com/errors#validation',
      `fetchCart@${APP}:42:9`,
    ].join('\n');

    expect(parseJavaScriptException(stack)?.causes).toEqual([
      {
        type: 'GraphQLError',
        value: [
          'Validation failed:',
          '  - field "email" is required',
          '  - see https://docs.example.com/errors#validation',
        ].join('\n'),
        frames: [expect.objectContaining({ function: 'fetchCart' })],
      },
    ]);
  });

  // V8 prints `new Error('\nRow 12 is invalid:')` as a line of `Error: `
  // followed by the message's lines.
  it.each([
    [
      'a message that starts with a line break',
      ['Caused by: Error: ', 'Row 12 is invalid:', '  sku is required'],
      { type: 'Error', value: 'Row 12 is invalid:\n  sku is required' },
    ],
    [
      'a whitespace-only message',
      ['Caused by: Error: ', ''],
      { type: 'Error', value: '' },
    ],
    [
      'an empty Caused by line',
      ['Caused by: ', 'TypeError: Failed to fetch'],
      { type: 'TypeError', value: 'Failed to fetch' },
    ],
    [
      'a message without a Name: prefix',
      ['Caused by: request timed out after 30s', ''],
      { type: '', value: 'request timed out after 30s' },
    ],
  ])('trims the blank lines around %s', (_, causeLines, title) => {
    const stack = [
      `    at checkout (${APP}:120:11)`,
      ...causeLines,
      `    at fetchCart (${APP}:42:9)`,
    ].join('\n');

    expect(parseJavaScriptException(stack)?.causes).toEqual([
      {
        ...title,
        frames: [expect.objectContaining({ function: 'fetchCart' })],
      },
    ]);
  });

  it('keeps a URL line of a frameless Firefox cause in its title', () => {
    const stack = [
      `checkout@${APP}:1:2`,
      'Caused by: TypeError: bad',
      'see https://docs.example.com/x',
    ].join('\n');

    expect(parseJavaScriptException(stack)?.causes).toEqual([
      {
        type: 'TypeError',
        value: 'bad\nsee https://docs.example.com/x',
        frames: [],
      },
    ]);
  });

  it('skips lines with more than 32 parentheses', () => {
    const stack = [
      `checkout@${APP}:120:11`,
      `submit${'()'.repeat(17)}@${APP}:130:5`,
    ].join('\n');

    expect(framesOf(stack)).toEqual([
      expect.objectContaining({ function: 'checkout' }),
    ]);
  });

  it.each([
    ['an error line alone', 'Error: x'],
    [
      'frameless toString() text with a URL',
      'HttpException: GET https://api.example.com/x failed\nCaused by: {"code":1}',
    ],
    [
      'a stack over 64 KB',
      `Error: x\n${`    at fn (${APP}:1:2)\n`.repeat(2000)}`,
    ],
    ['empty text', ''],
    ['a Caused by without frames', 'Error: x\nCaused by: Error: y'],
  ])('returns undefined for %s', (_, stack) => {
    expect(parseJavaScriptException(stack)).toBeUndefined();
  });

  it.each([
    ['/srv/app/node_modules/react-dom/cjs/react-dom.js', false],
    ['http://localhost:5173/node_modules/.vite/deps/react-dom.js', false],
    ['node:internal/process/task_queues', false],
    ['internal/modules/cjs/loader.js', false],
    [
      'https://app.example.com/_next/static/chunks/framework-2c79e2a64abdb08b.js',
      false,
    ],
    [
      'https://app.example.com/_next/static/chunks/webpack-59c5c889f52620d6.js',
      false,
    ],
    ['https://app.example.com/_next/static/chunks/main-app-5f1c09ab.js', false],
    ['webpack:///webpack/bootstrap', false],
    ['https://app.example.com/static/js/runtime-main.4c1f2b9d.js', false],
    ['https://app.example.com/webpack-runtime-8a2b3c.js', false],
    [
      'https://app.example.com/_next/static/chunks/pages/checkout-3f2a.js',
      true,
    ],
    ['https://app.example.com/_next/static/chunks/main-feature.js', true],
  ])('sets in_app for %s to %s', (filename, inApp) => {
    expect(framesOf(`Error: x\n    at fn (${filename}:1:2)`)).toEqual([
      expect.objectContaining({ filename, in_app: inApp }),
    ]);
  });
});

describe('isJavaScriptRuntime', () => {
  it.each([
    ['webjs', true],
    ['nodejs', true],
    ['java', false],
    ['python', false],
    [undefined, false],
  ])('treats telemetry.sdk.language %s as %s', (language, expected) => {
    expect(
      isJavaScriptRuntime(
        language == null ? {} : { 'telemetry.sdk.language': language },
      ),
    ).toBe(expected);
  });
});
