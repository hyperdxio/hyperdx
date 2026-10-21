import React from 'react';
import { screen } from '@testing-library/react';

import { ExceptionSubpanel } from '@/components/ExceptionSubpanel';

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
