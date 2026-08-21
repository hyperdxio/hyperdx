import { useMemo } from 'react';
import { SearchConditionLanguage } from '@hyperdx/common-utils/dist/types';
import {
  validateVariableReferencesInTemplate,
  VariableReferenceIssues,
} from '@hyperdx/common-utils/dist/variables';
import { List, Text, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconAlertTriangle } from '@tabler/icons-react';

import {
  useChartVariables,
  VariableSupportOptions,
} from './variableCompletions';

import styles from './variableValidation.module.scss';

const NO_ISSUES: VariableReferenceIssues = Object.freeze({
  errors: [],
  warnings: [],
});

const VALIDATION_DEBOUNCE_MS = 500;

export const hasVariableIssues = (issues: VariableReferenceIssues) =>
  issues.errors.length > 0 || issues.warnings.length > 0;

/**
 * Returns variable-reference issues in the given template. Returns nothing when no variables are in scope.
 */
export function useVariableValidation(
  template: string,
  {
    enabled = true,
    language = 'sql',
  }: VariableSupportOptions & {
    language?: SearchConditionLanguage;
  } = {},
): VariableReferenceIssues {
  const variables = useChartVariables({ enabled });
  const [debouncedValue] = useDebouncedValue(template, VALIDATION_DEBOUNCE_MS);

  return useMemo(() => {
    if (variables == null) return NO_ISSUES;
    return validateVariableReferencesInTemplate(debouncedValue, variables, {
      subject: 'This expression',
      language,
    });
  }, [debouncedValue, language, variables]);
}

/**
 * The alert icon an input shows when its expression misuses a variable.
 */
export function VariableIssueIndicator({
  issues,
}: {
  issues: VariableReferenceIssues;
}) {
  const { errors, warnings } = issues;
  if (!hasVariableIssues(issues)) return null;

  const isError = errors.length > 0;
  const messages = [...errors, ...warnings];

  return (
    <Tooltip
      multiline
      maw={400}
      label={
        messages.length === 1 ? (
          messages[0]
        ) : (
          <List size="xs" spacing={2}>
            {messages.map(message => (
              <List.Item key={message}>{message}</List.Item>
            ))}
          </List>
        )
      }
    >
      <Text
        component="span"
        className={styles.indicator}
        data-testid="variable-validation"
        role="img"
        aria-label={messages.join(' ')}
        c={isError ? 'var(--color-text-danger)' : 'var(--color-text-warning)'}
      >
        <IconAlertTriangle size={14} />
      </Text>
    </Tooltip>
  );
}
