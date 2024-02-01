import React, { useMemo } from 'react';
import { Select } from '@mantine/core';

import api from './api';
import { legacyMetricNameToNameAndDataType } from './utils';

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
  const { name: mName, dataType: mDataType } =
    legacyMetricNameToNameAndDataType(metricName);
  const { data: metricTagsData, isLoading: isMetricTagsLoading } =
    api.useMetricsTags([
      {
        name: mName,
        dataType: mDataType,
      },
    ]);

  const options = useMemo(() => {
    const tags =
      metricTagsData?.data?.filter(metric => metric.name === metricName)?.[0]
        ?.tags ?? [];
    const tagNameValueSet = new Set<string>();
    tags.forEach(tag => {
      Object.entries(tag).forEach(([name, value]) =>
        tagNameValueSet.add(`${name}:"${value}"`),
      );
    });
    return Array.from(tagNameValueSet).map(tagName => ({
      value: tagName,
      label: tagName,
    }));
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
