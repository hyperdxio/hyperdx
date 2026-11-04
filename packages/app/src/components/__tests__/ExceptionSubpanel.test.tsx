import React from 'react';
import { screen } from '@testing-library/react';

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
