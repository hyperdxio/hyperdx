import React, { useMemo } from 'react';
import { Select } from '@mantine/core';

import api from './api';

export default function MetricTagValueSelect({
  metricName,
  metricAttribute,
  value,
  onChange,
  dropdownOpenWidth,
  dropdownClosedWidth,
  ...selectProps
}: {
  metricName: string;
  metricAttribute: string;
  value: string;
  dropdownOpenWidth?: number;
  dropdownClosedWidth?: number;
  onChange: (value: string) => void;
} & Partial<React.ComponentProps<typeof Select>>) {
  const { data: metricTagsData, isLoading: isMetricTagsLoading } =
    api.useMetricsNames();

  const options = useMemo(() => {
    const tags =
      metricTagsData?.data?.filter(metric => metric.name === metricName)?.[0]
        ?.tags ?? [];

    const valueSet = new Set<string>();

    tags.forEach(tag => {
      Object.entries(tag).forEach(([name, value]) => {
        if (name === metricAttribute) {
          valueSet.add(value);
        }
      });
    });

    return Array.from(valueSet);
  }, [metricTagsData, metricName]);

  const [dropdownOpen, setDropdownOpen] = React.useState(false);

  return (
    <Select
      searchable
      clearable
      allowDeselect
      maxDropdownHeight={280}
      disabled={isMetricTagsLoading}
      radius="md"
      variant="filled"
      value={value}
      onChange={onChange}
      w={dropdownOpen ? dropdownOpenWidth ?? 200 : dropdownClosedWidth ?? 200}
      limit={20}
      data={options}
      onDropdownOpen={() => setDropdownOpen(true)}
      onDropdownClose={() => setDropdownOpen(false)}
      {...selectProps}
    />
  );
}
