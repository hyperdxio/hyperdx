import { screen } from '@testing-library/react';

import { ExpressionValidationStatus } from '@/components/Sources/SourceForm/ExpressionValidationStatus';
import { useExpressionValidation } from '@/hooks/useExpressionValidation';

jest.mock('@/hooks/useExpressionValidation', () => ({
  useExpressionValidation: jest.fn(),
}));

const mockUseExpressionValidation = jest.mocked(useExpressionValidation);

const tableConnection = {
  databaseName: 'default',
  tableName: 'otel_logs',
  connectionId: 'conn-1',
};

function mockValidation(
  overrides: Partial<ReturnType<typeof useExpressionValidation>> = {},
) {
  mockUseExpressionValidation.mockReturnValue({
    isValid: true,
    isInvalid: false,
    isLoading: false,
    error: null,
    shouldShowResult: true,
    validateNow: jest.fn(),
    ...overrides,
  });
}

function renderStatus(expression: string, warnOnLiteral = true) {
  return renderWithMantine(
    <ExpressionValidationStatus
      expression={expression}
      tableConnection={tableConnection}
      warnOnLiteral={warnOnLiteral}
    />,
  );
}

const LITERAL_WARNING = /fixed value, not a column reference/;

describe('ExpressionValidationStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidation();
  });

  it('warns instead of reporting valid when the expression is a quoted trace ID', () => {
    renderStatus("'4bf92f3577b34da6a3ce929d0e0e4736'");

    expect(screen.getByText(LITERAL_WARNING)).toBeInTheDocument();
    expect(screen.queryByText('Expression is valid.')).not.toBeInTheDocument();
  });

  it('warns on a value ClickHouse accepts as a constant plus an alias', () => {
    renderStatus('2643 cca9640b1639cb111d28216dd09');

    expect(screen.getByText(LITERAL_WARNING)).toBeInTheDocument();
  });

  it('reports a column reference as valid', () => {
    renderStatus('TraceId');

    expect(screen.getByText('Expression is valid.')).toBeInTheDocument();
    expect(screen.queryByText(LITERAL_WARNING)).not.toBeInTheDocument();
  });

  it('stays quiet for fields where a constant is legitimate', () => {
    renderStatus("'checkout-service'", false);

    expect(screen.queryByText(LITERAL_WARNING)).not.toBeInTheDocument();
    expect(screen.getByText('Expression is valid.')).toBeInTheDocument();
  });

  it('shows the ClickHouse error ahead of the literal warning', () => {
    mockValidation({
      isValid: false,
      isInvalid: true,
      error: new Error('Unknown identifier'),
    });

    renderStatus("'4bf92f3577b34da6a3ce929d0e0e4736'");

    expect(screen.getByText('Expression is invalid')).toBeInTheDocument();
    expect(screen.queryByText(LITERAL_WARNING)).not.toBeInTheDocument();
  });

  it('warns before ClickHouse has returned a verdict', () => {
    mockValidation({ isValid: false, shouldShowResult: false });

    renderStatus("'4bf92f3577b34da6a3ce929d0e0e4736'");

    expect(screen.getByText(LITERAL_WARNING)).toBeInTheDocument();
  });
});
