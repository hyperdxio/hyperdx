import { JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PatternColumnSelector } from '@/components/Patterns/PatternColumnSelector';
import { useMultipleAllFields } from '@/hooks/useMetadata';

jest.mock('@/hooks/useMetadata', () => ({
  useMultipleAllFields: jest.fn(() => ({ data: [] })),
}));

const mockedUseMultipleAllFields = useMultipleAllFields as jest.Mock;

describe('PatternColumnSelector', () => {
  beforeEach(() => {
    mockedUseMultipleAllFields.mockReturnValue({
      data: [
        { path: ['Body'], type: 'String', jsType: JSDataType.String },
        { path: ['ServiceName'], type: 'String', jsType: JSDataType.String },
      ],
    });
  });

  it('names the source default on the trigger so clustering is not a blank box', () => {
    renderWithMantine(
      <PatternColumnSelector
        value=""
        onApply={jest.fn()}
        defaultField="Body"
      />,
    );

    expect(screen.getByTestId('explore-pattern-field')).toHaveTextContent(
      'on Body',
    );
  });

  it('names a field the reader picked', () => {
    renderWithMantine(
      <PatternColumnSelector
        value="ServiceName"
        onApply={jest.fn()}
        defaultField="Body"
      />,
    );

    expect(screen.getByTestId('explore-pattern-field')).toHaveTextContent(
      'on ServiceName',
    );
  });

  it('applies a field on click, without a SQL editor', async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    renderWithMantine(
      <PatternColumnSelector value="" onApply={onApply} defaultField="Body" />,
    );

    await user.click(screen.getByTestId('explore-pattern-field'));
    await user.click(await screen.findByRole('radio', { name: 'ServiceName' }));

    expect(onApply).toHaveBeenCalledWith('ServiceName');
  });

  it('stores the default as empty so a later source body change is tracked', async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    renderWithMantine(
      <PatternColumnSelector
        value="ServiceName"
        onApply={onApply}
        defaultField="Body"
      />,
    );

    await user.click(screen.getByTestId('explore-pattern-field'));
    await user.click(
      await screen.findByRole('button', { name: 'Use default' }),
    );

    expect(onApply).toHaveBeenCalledWith('');
  });
});
