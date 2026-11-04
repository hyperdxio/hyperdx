import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ExceptionSubpanel } from '@/components/ExceptionSubpanel';

// click-ui encodes state only in hashed CSS module class names, so the mock
// exposes the props as attributes to assert on.
jest.mock('@clickhouse/click-ui', () => ({
  ...jest.requireActual('@clickhouse/click-ui'),
  Badge: ({ text, state }: { text: React.ReactNode; state?: string }) => (
    <span data-testid="badge" data-state={state}>
      {text}
    </span>
  ),
}));

describe('ExceptionSubpanel', () => {
  it.each([
    [{ type: '', value: 'bad input' }, 'bad input'],
    [{ type: 'ValueError', value: '' }, 'ValueError'],
  ])('labels %o as "%s" without a dangling colon', (exception, label) => {
    renderWithMantine(
      <ExceptionSubpanel
        exceptionValues={[exception]}
        logData={{ timestamp: 0 }}
      />,
    );

    expect(screen.getByText(label).closest('div')?.textContent).toBe(label);
    expect(screen.queryByText('Breadcrumbs')).not.toBeInTheDocument();
  });
});

const renderBreadcrumbs = (
  breadcrumbs: React.ComponentProps<typeof ExceptionSubpanel>['breadcrumbs'],
) =>
  renderWithMantine(
    <ExceptionSubpanel
      logData={{ timestamp: 1700000000000 }}
      breadcrumbs={breadcrumbs}
      exceptionValues={[
        { type: 'Error', value: 'boom', stacktrace: { frames: [] } },
      ]}
    />,
  );

const badgeStates = () =>
  screen
    .getAllByTestId('badge')
    .map(b => [b.textContent, b.getAttribute('data-state')]);

describe('ExceptionSubpanel breadcrumbs', () => {
  it.each([
    [503, 'danger'],
    [404, 'warning'],
    [200, 'success'],
  ])('renders status %s with the %s state', (status, state) => {
    renderBreadcrumbs([
      {
        category: 'fetch',
        data: { method: 'GET', url: '/api', status_code: status },
        timestamp: 1700000001,
      },
    ]);
    expect(badgeStates()).toEqual([[String(status), state]]);
  });

  it.each([
    ['error', 'danger'],
    ['warning', 'warning'],
    ['info', 'neutral'],
  ])('renders console level %s with the %s state', (level, state) => {
    renderBreadcrumbs([
      { category: 'console', message: 'hi', level, timestamp: 1700000001 },
    ]);
    expect(badgeStates()).toEqual([[level, state]]);
  });
});

const APP = 'https://example.clickhouse.com/assets/app.js';
const FRAMEWORK =
  'https://example.clickhouse.com/_next/static/chunks/framework-2c79e2a64abdb08b.js';
const RAW_STACK = [
  'Error: Checkout failed',
  `    at checkout (${APP}:120:11)`,
  `    at Object.Ub (${FRAMEWORK}:9:16994)`,
  'Caused by: TypeError: Failed to fetch',
  `    at fetchCart (${APP}:42:9)`,
].join('\n');

const PARSED_EXCEPTION_VALUES = [
  {
    type: 'Error',
    value: 'Checkout failed',
    rawStacktrace: RAW_STACK,
    stacktrace: {
      frames: [
        {
          filename: FRAMEWORK,
          function: 'Object.Ub',
          lineno: 9,
          colno: 16994,
          in_app: false,
        },
        {
          filename: APP,
          function: 'checkout',
          lineno: 120,
          colno: 11,
          in_app: true,
        },
      ],
    },
  },
  {
    type: 'TypeError',
    value: 'Failed to fetch',
    stacktrace: {
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
  },
];

const rowTexts = () =>
  screen.getAllByRole('row').map(row => row.textContent?.trim());

describe('ExceptionSubpanel stack frames', () => {
  it('renders the thrown exception with its frames, newest first', () => {
    renderWithMantine(
      <ExceptionSubpanel
        exceptionValues={PARSED_EXCEPTION_VALUES}
        logData={{ timestamp: 0 }}
      />,
    );

    expect(rowTexts()).toEqual([
      `${APP}:120:11 in checkout`,
      `${FRAMEWORK}:9:16994 in Object.Ub`,
    ]);
    expect(
      screen
        .getAllByLabelText('Library or framework code')
        .map(icon => icon.closest('tr')?.textContent?.trim()),
    ).toEqual([`${FRAMEWORK}:9:16994 in Object.Ub`]);
    expect(screen.getByText('Error').closest('div')?.textContent).toBe(
      'Error: Checkout failed',
    );
    expect(screen.getByText('Error').closest('button')).toBeNull();
  });

  it('collapses each cause to its title until expanded', async () => {
    renderWithMantine(
      <ExceptionSubpanel
        exceptionValues={[
          ...PARSED_EXCEPTION_VALUES,
          {
            type: 'Error',
            value: 'Socket closed',
            stacktrace: {
              frames: [
                {
                  filename: APP,
                  function: 'connect',
                  lineno: 7,
                  colno: 3,
                  in_app: true,
                },
              ],
            },
          },
        ]}
        logData={{ timestamp: 0 }}
      />,
    );
    const causes = () =>
      screen
        .getAllByRole('button', { name: /^Caused by: / })
        .map(cause => [cause.textContent, cause.getAttribute('aria-expanded')]);

    expect(causes()).toEqual([
      ['Caused by: TypeError: Failed to fetch', 'false'],
      ['Caused by: Error: Socket closed', 'false'],
    ]);
    expect(rowTexts()).toEqual([
      `${APP}:120:11 in checkout`,
      `${FRAMEWORK}:9:16994 in Object.Ub`,
    ]);

    await userEvent.click(
      screen.getByRole('button', { name: /Failed to fetch/ }),
    );

    expect(causes()).toEqual([
      ['Caused by: TypeError: Failed to fetch', 'true'],
      ['Caused by: Error: Socket closed', 'false'],
    ]);
    expect(rowTexts()).toEqual([
      `${APP}:120:11 in checkout`,
      `${FRAMEWORK}:9:16994 in Object.Ub`,
      `${APP}:42:9 in fetchCart`,
    ]);

    await userEvent.click(
      screen.getByRole('button', { name: /Failed to fetch/ }),
    );

    expect(rowTexts()).not.toContain(`${APP}:42:9 in fetchCart`);
  });

  it('renders a section without frames as its title alone', () => {
    const { container } = renderWithMantine(
      <ExceptionSubpanel
        exceptionValues={[
          {
            type: 'Error',
            value: 'Checkout failed',
            stacktrace: { frames: [] },
            rawStacktrace: RAW_STACK,
          },
          {
            type: 'TypeError',
            value: 'Failed to fetch',
            stacktrace: { frames: [] },
          },
          { type: 'Error', value: 'Socket closed', stacktrace: 'raw cause' },
        ]}
        logData={{ timestamp: 0 }}
      />,
    );

    // A cause's unparsed text is not shown. Causes only come from a parsed
    // stack, whose full text is in "Raw stack trace".
    expect(
      Array.from(container.querySelectorAll('.panelSectionWrapper'), section =>
        Array.from(section.children, child => child.textContent),
      ),
    ).toEqual([
      ['Error: Checkout failed'],
      ['Caused by: TypeError: Failed to fetch'],
      ['Caused by: Error: Socket closed'],
    ]);
    expect(
      screen.queryByRole('button', { name: /Caused by:/ }),
    ).not.toBeInTheDocument();
  });

  it('keeps the mechanism of a section without frames', () => {
    renderWithMantine(
      <ExceptionSubpanel
        exceptionValues={[
          {
            type: 'Error',
            value: 'boom',
            mechanism: { type: 'onerror', handled: false },
          },
        ]}
        logData={{ timestamp: 0 }}
      />,
    );

    expect(screen.getByText('onerror')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
  });

  it('does not render the frames of a collapsed cause', () => {
    renderWithMantine(
      <ExceptionSubpanel
        exceptionValues={[
          { type: 'Error', value: 'Checkout failed' },
          PARSED_EXCEPTION_VALUES[1],
        ]}
        logData={{ timestamp: 0 }}
      />,
    );

    // `hidden` also counts rows mounted but hidden by CSS, which would still
    // run their source map lookups.
    expect(screen.queryAllByRole('row', { hidden: true })).toHaveLength(0);
  });

  it('puts a collapsed cause on one line and its full message on hover', async () => {
    renderWithMantine(
      <ExceptionSubpanel
        exceptionValues={[
          PARSED_EXCEPTION_VALUES[0],
          {
            ...PARSED_EXCEPTION_VALUES[1],
            type: 'Error',
            value: '\nRow 12 is invalid:\r\n  price must be a number\n',
          },
        ]}
        logData={{ timestamp: 0 }}
      />,
    );
    const cause = screen.getByRole('button', { name: /^Caused by: / });
    const title = () => within(cause).getByText('Error').parentElement;

    expect(cause.textContent).toBe(
      'Caused by: Error: Row 12 is invalid: price must be a number',
    );
    expect(title()).toHaveAttribute('data-truncate');
    expect(title()).toHaveAttribute(
      'title',
      'Error: Row 12 is invalid:\r\n  price must be a number',
    );

    await userEvent.click(cause);

    expect(cause.textContent).toBe(
      'Caused by: Error: Row 12 is invalid:\r\n  price must be a number',
    );
    expect(title()).not.toHaveAttribute('data-truncate');
    expect(title()).not.toHaveAttribute('title');
    expect(title()?.style.whiteSpace).toBe('pre-wrap');
  });

  it('shows the message of an open section with its line breaks', () => {
    const longToken = `https://react.dev/errors/418?args[]=${'x'.repeat(400)}`;
    renderWithMantine(
      <ExceptionSubpanel
        exceptionValues={[
          { type: 'Error', value: '\n\nCheckout failed\nfor cart 42\n' },
          { type: 'TypeError', value: `Failed to fetch\n${longToken}` },
        ]}
        logData={{ timestamp: 0 }}
      />,
    );
    const title = (type: string) => screen.getByText(type).parentElement;

    expect(screen.getByText('Error').closest('div')?.textContent).toBe(
      'Error: Checkout failed\nfor cart 42',
    );
    expect(screen.getByText('TypeError').closest('div')?.textContent).toBe(
      `Caused by: TypeError: Failed to fetch\n${longToken}`,
    );
    for (const type of ['Error', 'TypeError']) {
      expect(title(type)?.style.whiteSpace).toBe('pre-wrap');
      expect(title(type)?.style.overflowWrap).toBe('anywhere');
      expect(title(type)).not.toHaveAttribute('data-truncate');
      expect(title(type)).not.toHaveAttribute('data-line-clamp');
    }
  });

  it('keeps the raw stack trace behind a collapsed section', async () => {
    renderWithMantine(
      <ExceptionSubpanel
        exceptionValues={PARSED_EXCEPTION_VALUES}
        logData={{ timestamp: 0 }}
      />,
    );
    const rawText = () => screen.queryByText(/Caused by: TypeError/);

    expect(rawText()).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Raw stack trace'));
    expect(rawText()?.textContent).toBe(RAW_STACK);
  });

  it('omits the line and column of a frame that has none', () => {
    renderWithMantine(
      <ExceptionSubpanel
        exceptionValues={[
          {
            type: 'Error',
            value: 'boom',
            stacktrace: {
              frames: [
                {
                  filename: '[native code]',
                  function: 'forEach',
                  in_app: false,
                },
                {
                  filename: APP,
                  function: 'checkout',
                  lineno: 37,
                  in_app: true,
                },
              ],
            },
          },
        ]}
        logData={{ timestamp: 0 }}
      />,
    );

    expect(rowTexts()).toEqual([
      `${APP}:37 in checkout`,
      '[native code] in forEach',
    ]);
  });

  it.each(['', '?'])(
    'omits "in" for a frame whose function is %p',
    functionName => {
      renderWithMantine(
        <ExceptionSubpanel
          exceptionValues={[
            {
              type: 'Error',
              value: 'boom',
              stacktrace: {
                frames: [
                  {
                    filename: APP,
                    function: functionName,
                    lineno: 5,
                    colno: 10,
                    in_app: true,
                  },
                ],
              },
            },
          ]}
          logData={{ timestamp: 0 }}
        />,
      );

      expect(screen.getByRole('row').textContent).toBe(`${APP}:5:10`);
    },
  );

  it('shows an unparsed stack as text', () => {
    renderWithMantine(
      <ExceptionSubpanel
        exceptionValues={[
          { type: 'Error', value: 'boom', stacktrace: RAW_STACK },
        ]}
        logData={{ timestamp: 0 }}
      />,
    );

    expect(screen.getByText(/Caused by: TypeError/).textContent).toBe(
      RAW_STACK,
    );
    expect(screen.queryByRole('row')).not.toBeInTheDocument();
    expect(screen.queryByText('Raw stack trace')).not.toBeInTheDocument();
  });
});
