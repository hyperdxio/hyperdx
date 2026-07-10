import React from 'react';
import { useFieldArray, useWatch } from 'react-hook-form';
import { ActionIcon, Button, Flex, Grid, Text, Tooltip } from '@mantine/core';
import {
  IconCheck,
  IconCirclePlus,
  IconHelpCircle,
  IconTrash,
} from '@tabler/icons-react';

import { ErrorCollapse } from '@/components/Error/ErrorCollapse';
import { InputControlled } from '@/components/InputControlled';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { useExpressionValidation } from '@/hooks/useExpressionValidation';

import { DEFAULT_DATABASE } from './constants';
import { FormRow } from './FormRow';
import { TableModelProps } from './types';

type HighlightedAttributeRowProps = Omit<TableModelProps, 'setValue'> & {
  id: string;
  index: number;
  databaseName: string;
  name:
    | 'highlightedTraceAttributeExpressions'
    | 'highlightedRowAttributeExpressions';
  tableName: string;
  connectionId: string;
  removeHighlightedAttribute: (index: number) => void;
};

function HighlightedAttributeRow({
  id,
  index,
  control,
  databaseName,
  name,
  tableName,
  connectionId,
  removeHighlightedAttribute,
}: HighlightedAttributeRowProps) {
  const expressionInput = useWatch({
    control,
    name: `${name}.${index}.sqlExpression`,
  });

  const aliasInput = useWatch({
    control,
    name: `${name}.${index}.alias`,
  });

  const {
    isLoading: isExplainLoading,
    validateNow,
    shouldShowResult,
    isValid,
    isInvalid,
    error,
  } = useExpressionValidation({
    expression: expressionInput,
    alias: aliasInput,
    tableConnection: { databaseName, tableName, connectionId },
  });

  return (
    <React.Fragment key={id}>
      <Grid.Col span={3} pe={0}>
        <div
          style={{ display: 'contents' }}
          data-name={`${name}.${index}.sqlExpression`}
        >
          <SQLInlineEditorControlled
            tableConnection={{
              databaseName,
              tableName,
              connectionId,
            }}
            control={control}
            name={`${name}.${index}.sqlExpression`}
            disableKeywordAutocomplete
            placeholder="ResourceAttributes['http.host']"
          />
        </div>
      </Grid.Col>
      <Grid.Col span={2} ps="xs">
        <Flex align="center" gap="sm">
          <Text c="gray">AS</Text>
          <SQLInlineEditorControlled
            control={control}
            name={`${name}.${index}.alias`}
            placeholder="Optional Alias"
            disableKeywordAutocomplete
          />
          <Tooltip label="Validate expression">
            <ActionIcon
              size="xs"
              variant="subtle"
              color="gray"
              loading={isExplainLoading}
              disabled={!expressionInput || isExplainLoading}
              onClick={validateNow}
            >
              <IconCheck size={16} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon
            size="xs"
            variant="subtle"
            color="gray"
            onClick={() => removeHighlightedAttribute(index)}
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Flex>
      </Grid.Col>

      {shouldShowResult && (
        <Grid.Col span={5} pe={0} pt={0}>
          {isValid && (
            <Text c="green" size="xs">
              Expression is valid.
            </Text>
          )}
          {isInvalid && (
            <ErrorCollapse
              summary="Expression is invalid"
              details={error?.message}
            />
          )}
        </Grid.Col>
      )}

      <Grid.Col span={3} pe={0}>
        <InputControlled
          control={control}
          name={`${name}.${index}.luceneExpression`}
          placeholder="ResourceAttributes.http.host (Optional) "
        />
      </Grid.Col>
      <Grid.Col span={1} pe={0}>
        <Text me="sm" mt={6}>
          <Tooltip
            label={
              'An optional, Lucene version of the above expression. If provided, it is used when searching for this attribute value.'
            }
            color="dark"
            c="white"
            multiline
            maw={600}
          >
            <IconHelpCircle size={14} className="cursor-pointer" />
          </Tooltip>
        </Text>
      </Grid.Col>
    </React.Fragment>
  );
}

export function HighlightedAttributeExpressionsFormRow({
  control,
  name,
  label,
  helpText,
}: Omit<TableModelProps, 'setValue'> & {
  name:
    | 'highlightedTraceAttributeExpressions'
    | 'highlightedRowAttributeExpressions';
  label: string;
  helpText?: string;
}) {
  const databaseName = useWatch({
    control,
    name: 'from.databaseName',
    defaultValue: DEFAULT_DATABASE,
  });
  const tableName = useWatch({ control, name: 'from.tableName' });
  const connectionId = useWatch({ control, name: 'connection' });

  const {
    fields: highlightedAttributes,
    append: appendHighlightedAttribute,
    remove: removeHighlightedAttribute,
  } = useFieldArray({
    control,
    name,
  });

  return (
    <FormRow label={label} helpText={helpText}>
      <Grid columns={5}>
        {highlightedAttributes.map(({ id }, index) => (
          <HighlightedAttributeRow
            key={id}
            {...{
              id,
              index,
              name,
              control,
              databaseName,
              tableName,
              connectionId,
              removeHighlightedAttribute,
            }}
          />
        ))}
      </Grid>
      <Button
        variant="secondary"
        size="sm"
        className="align-self-start"
        mt={highlightedAttributes.length ? 'sm' : 'md'}
        onClick={() => {
          appendHighlightedAttribute(
            {
              sqlExpression: '',
              luceneExpression: '',
              alias: '',
            },
            { shouldFocus: false },
          );
        }}
      >
        <IconCirclePlus size={14} className="me-2" />
        Add expression
      </Button>
    </FormRow>
  );
}
