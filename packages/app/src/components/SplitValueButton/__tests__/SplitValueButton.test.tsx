import { screen } from '@testing-library/react';

import { SplitValueButton } from '@/components/SplitValueButton/SplitValueButton';

describe('SplitValueButton', () => {
  it('shows a field count as words on a wide screen', () => {
    renderWithMantine(
      <SplitValueButton
        name="Columns"
        summary="3 fields"
        count={3}
        compact={false}
        onClick={() => {}}
        data-testid="columns"
      />,
    );
    expect(screen.getByTestId('columns')).toHaveTextContent('3 fields');
    expect(screen.getByTestId('columns')).toHaveAccessibleName(
      'Columns 3 fields',
    );
  });

  it('shows only the number on a narrow screen', () => {
    renderWithMantine(
      <SplitValueButton
        name="Columns"
        summary="3 fields"
        count={3}
        compact
        onClick={() => {}}
        data-testid="columns"
      />,
    );
    expect(screen.getByTestId('columns')).toHaveTextContent(/^3$/);
    expect(screen.getByTestId('columns')).toHaveAccessibleName(
      'Columns 3 fields',
    );
  });

  it('keeps a single field name on a narrow screen', () => {
    renderWithMantine(
      <SplitValueButton
        name="Group by"
        summary="SeverityText"
        count={1}
        compact
        onClick={() => {}}
        data-testid="group-by"
      />,
    );
    expect(screen.getByTestId('group-by')).toHaveTextContent('SeverityText');
  });
});
