import { useState } from 'react';
import { Group, SegmentedControl, Stack } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import {
  MOCK_PROMQL_VALUES,
  MOCK_SQL_VALUES,
  useMockValues,
} from '@/mocks/filterValues';

import {
  FilterCondition,
  FilterConditionEditor,
} from './FilterConditionEditor';
import {
  FilterLanguage,
  FilterOperator,
  getFilterOperators,
} from './filterOperators';
import { FilterPill } from './FilterPill';
import { FilterValueEditor } from './FilterValueEditor';

const meta = {
  title: 'Components/FilterPill',
  component: FilterPill,
  args: {
    field: 'ServiceName',
    operator: '=',
    value: 'checkout',
    onRemove: () => {},
  },
} satisfies Meta<typeof FilterPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Included: Story = {};

export const Excluded: Story = {
  args: {
    operator: '!=',
    value: 'debug',
    field: 'SeverityText',
    isExcluded: true,
  },
};

export const DisplayValue: Story = {
  args: {
    field: 'Timestamp',
    value: '2026-06-16T15:35:16.731000000Z',
    displayValue: 'Jun 16 11:35:16.731 AM',
  },
};

export const Invalid: Story = {
  args: {
    isInvalid: true,
    invalidReason:
      'Filter not applied: "ServiceName" isn\'t a column on the current source.',
  },
};

export const RangeRemoveOnly: Story = {
  args: { field: 'Duration', operator: ':', value: '100 – 500' },
};

export const LongValues: Story = {
  args: {
    field: "ResourceAttributes['k8s.deployment.name']",
    value: 'a-very-long-deployment-name-that-should-be-truncated-in-the-pill',
  },
};

export const Row: Story = {
  render: () => (
    <Group gap={4} maw={500}>
      <FilterPill
        field="ServiceName"
        operator="="
        value="checkout"
        onRemove={() => {}}
      />
      <FilterPill
        field="SeverityText"
        operator="!="
        value="debug"
        isExcluded
        onRemove={() => {}}
      />
      <FilterPill
        field="Duration"
        operator=":"
        value="100 – 500"
        onRemove={() => {}}
      />
      <FilterPill
        field="StatusCode"
        operator="="
        value="500"
        isInvalid
        onRemove={() => {}}
      />
    </Group>
  ),
};

function ValueEditorDemo() {
  const [value, setValue] = useState('checkout');
  const [isExcluded, setIsExcluded] = useState(false);
  const [opened, setOpened] = useState(false);
  const values = useMockValues(MOCK_SQL_VALUES, opened ? 'ServiceName' : '');
  return (
    <FilterPill
      field="ServiceName"
      operator={isExcluded ? '!=' : '='}
      value={value}
      isExcluded={isExcluded}
      onRemove={() => {}}
      onOpenedChange={setOpened}
      renderPopover={close => (
        <FilterValueEditor
          value={value}
          valueOptions={values.data}
          isLoadingValues={values.isLoading}
          isExcluded={isExcluded}
          onReplaceValue={setValue}
          onTogglePolarity={() => setIsExcluded(e => !e)}
          onDone={close}
        />
      )}
    />
  );
}

export const WithValueEditor: Story = {
  render: () => <ValueEditorDemo />,
};

function ConditionEditorDemo() {
  const [language, setLanguage] = useState<FilterLanguage>('sql');
  const [condition, setCondition] = useState<FilterCondition<FilterOperator>>({
    key: 'ServiceName',
    operator: '=',
    value: 'checkout',
  });
  const [key, setKey] = useState('');
  const mockValues =
    language === 'promql' ? MOCK_PROMQL_VALUES : MOCK_SQL_VALUES;
  const values = useMockValues(mockValues, key);
  const operators = getFilterOperators(language);
  const operator = operators.find(op => op.value === condition.operator);

  return (
    <Stack align="flex-start">
      <SegmentedControl<FilterLanguage>
        size="xs"
        value={language}
        onChange={next => {
          setLanguage(next);
          setCondition(
            next === 'promql'
              ? { key: 'job', operator: '=', value: 'api' }
              : { key: 'ServiceName', operator: '=', value: 'checkout' },
          );
        }}
        data={[
          { value: 'sql', label: 'SQL' },
          { value: 'promql', label: 'PromQL' },
        ]}
      />
      <FilterPill
        field={condition.key}
        operator={operator?.label ?? condition.operator}
        value={condition.value}
        isExcluded={operator?.negated}
        onRemove={() => {}}
        renderPopover={close => (
          <FilterConditionEditor
            operators={operators}
            initial={condition}
            keyOptions={Object.keys(mockValues)}
            valueOptions={values.data}
            isLoadingValues={values.isLoading}
            onKeyChange={setKey}
            keyLabel={language === 'promql' ? 'Label' : 'Key'}
            onSubmit={next => {
              setCondition(next);
              close();
            }}
          />
        )}
      />
    </Stack>
  );
}

export const WithConditionEditor: Story = {
  render: () => <ConditionEditorDemo />,
};
