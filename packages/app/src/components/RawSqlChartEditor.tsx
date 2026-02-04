import { useCallback, useEffect, useState } from 'react';
import { Control, useController } from 'react-hook-form';
import { validateSelectOnlySql } from '@hyperdx/common-utils/dist/core/sqlValidator';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Alert, Stack, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';

import SQLEditor from './SQLEditor';

interface RawSqlChartEditorProps {
  control: Control<any>;
  name: string;
  displayType?: DisplayType;
  onSubmit: () => void;
}

const HELP_TEXT: Record<DisplayType, string> = {
  [DisplayType.Line]:
    'Write a SQL query that returns a DateTime/Date column for the time axis and numeric columns for values. Use toStartOfInterval() for time bucketing.',
  [DisplayType.StackedBar]:
    'Write a SQL query that returns a DateTime/Date column for the time axis and numeric columns for values. Use toStartOfInterval() for time bucketing.',
  [DisplayType.Table]:
    'Write a SQL query that returns the columns you want to display in the table.',
  [DisplayType.Number]:
    'Write a SQL query that returns a single numeric value (first row, first numeric column will be displayed).',
  [DisplayType.Search]: '',
  [DisplayType.Heatmap]: '',
  [DisplayType.Markdown]: '',
};

// Ensure the value is always a string (handle case where it might be an array from builder mode)
function ensureString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

export default function RawSqlChartEditor({
  control,
  name,
  displayType,
  onSubmit,
}: RawSqlChartEditorProps) {
  const { field } = useController({ control, name });
  const [validationError, setValidationError] = useState<string | undefined>();

  // Ensure value is always a string
  const stringValue = ensureString(field.value);

  const validateSql = useCallback((sql: string) => {
    if (!sql || sql.trim() === '') {
      setValidationError(undefined);
      return;
    }

    const result = validateSelectOnlySql(sql);
    setValidationError(result.isValid ? undefined : result.error);
  }, []);

  // Validate on initial load and when value changes
  useEffect(() => {
    validateSql(stringValue);
  }, [stringValue, validateSql]);

  const handleChange = useCallback(
    (value: string) => {
      field.onChange(value);
      validateSql(value);
    },
    [field, validateSql],
  );

  const helpText = displayType ? HELP_TEXT[displayType] : '';

  return (
    <Stack gap="xs">
      {helpText && (
        <Text size="xs" c="dimmed">
          {helpText}
        </Text>
      )}
      <SQLEditor
        value={stringValue}
        onChange={handleChange}
        placeholder="SELECT * FROM my_table WHERE timestamp > now() - INTERVAL 1 HOUR"
      />
      {validationError && (
        <Alert
          variant="light"
          color="red"
          icon={<IconAlertCircle size={16} />}
          p="xs"
        >
          <Text size="xs">{validationError}</Text>
        </Alert>
      )}
    </Stack>
  );
}
