import { useCallback, useMemo } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { Select } from '@mantine/core';

import { AGG_FNS } from '@/ChartUtils';

type AggFnValues = (typeof AGG_FNS)[number]['value'];

type OnChangeValue =
  | { aggFn?: AggFnValues }
  | { aggFn: 'quantile'; level: number };
export default function AggFnSelect({
  value,
  defaultValue,
  onChange,
}: {
  value: string;
  defaultValue: string;
  onChange: (value: OnChangeValue) => void;
}) {
  const _onChange = useCallback(
    (value: string | null) => {
      if (value == null) {
        onChange({});
      } else if (['p50', 'p90', 'p95', 'p99'].includes(value)) {
        onChange({
          aggFn: 'quantile',
          level: Number.parseFloat(value.replace('p', '0.')),
        });
      } else {
        // @ts-ignore
        onChange({ aggFn: value });
      }
    },
    [onChange],
  );

  return (
    <Select
      withScrollArea={false}
      searchable
      value={value}
      defaultValue={defaultValue}
      onChange={_onChange}
      data={AGG_FNS}
      data-testid="agg-fn-select"
    />
  );
}

export function AggFnSelectControlled({
  aggFnName,
  quantileLevelName,
  defaultValue,
  ...props
}: {
  defaultValue: string;
  aggFnName: string;
  quantileLevelName: string;
} & Omit<UseControllerProps<any>, 'name'>) {
  const {
    field: { onChange: onAggFnChange, value: aggFnValue },
  } = useController({
    ...props,
    name: aggFnName,
  });

  const {
    field: { onChange: onQuantileLevelChange, value: quantileLevelValue },
  } = useController({
    ...props,
    name: quantileLevelName,
  });

  const onChange = useCallback(
    (value: OnChangeValue) => {
      if (value.aggFn === 'quantile') {
        onQuantileLevelChange(value.level);
        onAggFnChange(value.aggFn);
      } else {
        onAggFnChange(value.aggFn);
      }
    },
    [onAggFnChange, onQuantileLevelChange],
  );

  const value = useMemo(() => {
    if (aggFnValue === 'quantile') {
      return `p${Math.round(quantileLevelValue * 100)}`;
    }
    return aggFnValue;
  }, [aggFnValue, quantileLevelValue]);

  return (
    <AggFnSelect
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
    />
  );
}
