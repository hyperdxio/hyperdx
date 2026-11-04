import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchScopeControl } from '@/components/DBSearchPageFilters';
import {
  getScopeIndicatorLabel,
  getTraceZeroEmptyDescription,
} from '@/DBSearchPage';

const traceSource = {
  id: 'trace-src',
  kind: SourceKind.Trace,
  name: 'Traces',
  connection: 'conn',
  from: { databaseName: 'db', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  traceIdExpression: 'TraceId',
} as unknown as TSource;

const logSource = {
  id: 'log-src',
  kind: SourceKind.Log,
  name: 'Logs',
  connection: 'conn',
  from: { databaseName: 'db', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
} as unknown as TSource;

const getScope = () => screen.getByRole('radiogroup', { name: 'Search scope' });

describe('SearchScopeControl accessibility', () => {
  it('@AC-FR002-05 exposes the control as a labelled radiogroup reachable by role', () => {
    renderWithMantine(
      <SearchScopeControl
        source={traceSource}
        value="span"
        onChange={jest.fn()}
      />,
    );

    const scope = getScope();
    expect(scope).toBeInTheDocument();
    expect(within(scope).getAllByRole('radio')).toHaveLength(2);
  });

  it('@AC-FR002-05 conveys the active option through ARIA checked state, not color alone', () => {
    renderWithMantine(
      <SearchScopeControl
        source={traceSource}
        value="span"
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByRole('radio', { name: /span/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /trace/i })).not.toBeChecked();
  });

  it('@AC-FR002-05 conveys the disabled option through the disabled attribute, not color alone', () => {
    renderWithMantine(
      <SearchScopeControl
        source={logSource}
        value="span"
        onChange={jest.fn()}
      />,
    );

    const traceRadio = screen.getByRole('radio', { name: /trace/i });
    expect(traceRadio).toBeDisabled();
    expect(traceRadio).not.toBeChecked();
  });

  it('@AC-FR002-05 ties the disabled reason to the group via aria-describedby', () => {
    renderWithMantine(
      <SearchScopeControl
        source={logSource}
        value="span"
        onChange={jest.fn()}
      />,
    );

    const describedBy = getScope().getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const reason = document.getElementById(describedBy as string);
    expect(reason).toHaveTextContent(/isn't available for this source/i);
  });

  it('@AC-FR002-05 does not describe the group when trace is available', () => {
    renderWithMantine(
      <SearchScopeControl
        source={traceSource}
        value="span"
        onChange={jest.fn()}
      />,
    );

    expect(getScope()).not.toHaveAttribute('aria-describedby');
  });

  it('@AC-FR002-05 accepts keyboard focus on the active option', async () => {
    renderWithMantine(
      <SearchScopeControl
        source={traceSource}
        value="span"
        onChange={jest.fn()}
      />,
    );

    await userEvent.tab();
    expect(screen.getByRole('radio', { name: /span/i })).toHaveFocus();
  });

  it('@AC-FR002-05 switches scope via arrow-key navigation without a pointer', async () => {
    const onChange = jest.fn();
    renderWithMantine(
      <SearchScopeControl
        source={traceSource}
        value="span"
        onChange={onChange}
      />,
    );

    screen.getByRole('radio', { name: /span/i }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('trace');
  });
});

describe('result-scope surface states', () => {
  it('@AC-FR004-01 labels a trace-scoped result header with the trace scope', () => {
    renderWithMantine(
      <span aria-label={getScopeIndicatorLabel('trace')}>
        {getScopeIndicatorLabel('trace')}
      </span>,
    );

    expect(screen.getByLabelText('Scope: Trace')).toHaveTextContent(
      'Scope: Trace',
    );
  });

  it('@AC-FR004-02 renders the trace-zero empty as labelled copy, not a blank', () => {
    const description = getTraceZeroEmptyDescription();
    renderWithMantine(<div>{description}</div>);

    expect(screen.getByText(description)).toBeInTheDocument();
    expect(description.toLowerCase()).toContain('trace');
  });
});
