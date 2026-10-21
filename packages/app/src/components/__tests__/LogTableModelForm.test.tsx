import React from 'react';
import { useForm } from 'react-hook-form';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { LogTableModelForm } from '@/components/Sources/SourceForm/LogTableModelForm';

import '@testing-library/jest-dom';

jest.mock('@/components/Sources/SourceForm/ExpressionValidationStatus', () => ({
  ExpressionValidationStatus: ({ expression }: { expression: string }) => (
    <div data-testid="validated">{expression}</div>
  ),
}));
jest.mock('@/components/SQLEditor/SQLInlineEditor', () => ({
  SQLInlineEditorControlled: () => <div />,
}));
jest.mock('@/components/SourceSelect', () => ({
  SourceSelectControlled: () => <div />,
}));
jest.mock('@/hooks/useMetadata', () => ({
  useColumns: () => ({ data: undefined }),
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useBrandDisplayName: () => 'HyperDX',
}));
jest.mock('@/components/Sources/SourceForm/HighlightedAttributes', () => ({
  HighlightedAttributeExpressionsFormRow: () => <div />,
}));
jest.mock('@/components/Sources/SourceForm/MaterializedViews', () => ({
  MaterializedViewsFormSection: () => <div />,
  MetadataMaterializedViewsFormSection: () => <div />,
}));
jest.mock('@/components/Sources/SourceForm/OrderByFormRow', () => ({
  OrderByFormRow: () => <div />,
}));
jest.mock('@/components/Sources/SourceForm/UseTextIndexFormRow', () => ({
  UseTextIndexFormRow: () => <div />,
}));

function Harness() {
  const { control, setValue } = useForm<TSource>({
    defaultValues: {
      kind: SourceKind.Log,
      connection: 'conn-1',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      severityNumberExpression: "LogAttributes['severity_number']",
    },
  });
  return <LogTableModelForm control={control} setValue={setValue} />;
}

it('validates the Severity Number Expression as a number', () => {
  renderWithMantine(<Harness />);

  expect(screen.getByTestId('validated')).toHaveTextContent(
    "LogAttributes['severity_number'] >= 1",
  );
});
