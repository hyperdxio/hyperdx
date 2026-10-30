import React from 'react';
import { screen } from '@testing-library/react';
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
  it('renders each exception and cause with its own frames, newest first', () => {
    renderWithMantine(
      <ExceptionSubpanel
        exceptionValues={PARSED_EXCEPTION_VALUES}
        logData={{ timestamp: 0 }}
      />,
    );

    expect(rowTexts()).toEqual([
      `${APP}:120:11 in checkout`,
      `${FRAMEWORK}:9:16994 in Object.Ub`,
      `${APP}:42:9 in fetchCart`,
    ]);
    expect(
      screen
        .getAllByLabelText('in_app: false')
        .map(icon => icon.closest('tr')?.textContent?.trim()),
    ).toEqual([`${FRAMEWORK}:9:16994 in Object.Ub`]);
    expect(screen.getByText('TypeError').closest('div')?.textContent).toBe(
      'Caused by: TypeError: Failed to fetch',
    );
    expect(screen.getByText('Error').closest('div')?.textContent).toBe(
      'Error: Checkout failed',
    );
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
