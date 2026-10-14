import { useState } from 'react';
import { Code, Stack } from '@mantine/core';
import type { Meta } from '@storybook/nextjs';

import {
  MOCK_PROMQL_VALUES,
  MOCK_SQL_VALUES,
  useMockValues,
} from '@/mocks/filterValues';

import {
  FilterCondition,
  FilterConditionEditor,
  FilterConditionEditorProps,
} from './FilterConditionEditor';
import {
  FilterOperator,
  PROMQL_FILTER_OPERATORS,
  SQL_FILTER_OPERATORS,
} from './filterOperators';

const meta = {
  title: 'Components/FilterConditionEditor',
  component: FilterConditionEditor,
  parameters: {
    docs: {
      description: {
        component:
          'Pick a key, operator, and value for an ad hoc filter condition. Data loading is up to the caller; these stories serve mock keys and values.',
      },
    },
  },
} satisfies Meta<typeof FilterConditionEditor>;

export default meta;

function Demo({
  values,
  isLoadingKeys,
  forceLoadingValues,
  ...props
}: Omit<
  FilterConditionEditorProps<FilterOperator>,
  'keyOptions' | 'valueOptions' | 'onSubmit'
> & {
  values: Record<string, string[]>;
  forceLoadingValues?: boolean;
}) {
  const [key, setKey] = useState('');
  const [submitted, setSubmitted] = useState<FilterCondition[]>([]);
  const valueQuery = useMockValues(values, key);
  return (
    <Stack>
      <FilterConditionEditor
        {...props}
        keyOptions={isLoadingKeys ? [] : Object.keys(values)}
        isLoadingKeys={isLoadingKeys}
        valueOptions={valueQuery.data}
        isLoadingValues={forceLoadingValues || valueQuery.isLoading}
        onKeyChange={setKey}
        onSubmit={condition => setSubmitted(s => [...s, condition])}
      />
      {submitted.length > 0 && (
        <Code block>{JSON.stringify(submitted, null, 2)}</Code>
      )}
    </Stack>
  );
}

export const Sql = () => (
  <Demo
    operators={SQL_FILTER_OPERATORS}
    values={MOCK_SQL_VALUES}
    keyPlaceholder="Select a column or map key"
  />
);

export const Promql = () => (
  <Demo
    operators={PROMQL_FILTER_OPERATORS}
    values={MOCK_PROMQL_VALUES}
    keyLabel="Label"
    keyPlaceholder="Select a label"
  />
);

export const EditingExisting = () => (
  <Demo
    operators={SQL_FILTER_OPERATORS}
    values={MOCK_SQL_VALUES}
    initial={{ key: 'SeverityText', operator: '!=', value: 'debug' }}
  />
);

export const LoadingKeys = () => (
  <Demo
    operators={SQL_FILTER_OPERATORS}
    values={MOCK_SQL_VALUES}
    isLoadingKeys
  />
);

export const LoadingValues = () => (
  <Demo
    operators={SQL_FILTER_OPERATORS}
    values={MOCK_SQL_VALUES}
    initial={{ key: 'ServiceName', operator: '=', value: '' }}
    forceLoadingValues
  />
);

export const NoSuggestions = () => (
  <Demo operators={SQL_FILTER_OPERATORS} values={{}} />
);
