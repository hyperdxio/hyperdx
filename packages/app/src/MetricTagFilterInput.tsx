import { useEffect, useMemo, useRef, useState } from 'react';

import api from './api';
import AutocompleteInput from './AutocompleteInput';

export default function MetricTagFilterInput({
  inputRef,
  value,
  onChange,
  placeholder = 'Filter metric by tag...',
  showHotkey = true,
  size = 'lg',
  metricName,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  showHotkey?: boolean;
  size?: 'sm' | 'lg';
  metricName?: string;
}) {
  const { data: metricTagsData } = api.useMetricsNames();

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

  return (
    <AutocompleteInput
      inputRef={inputRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autocompleteOptions={options}
      showHotkey={showHotkey}
      size={size}
      showSuggestionsOnEmpty
      suggestionsHeader="Tags"
    />
  );
}
