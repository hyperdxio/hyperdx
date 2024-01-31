import { useMemo } from 'react';

import api from './api';
import AutocompleteInput from './AutocompleteInput';
import { legacyMetricNameToNameAndDataType } from './utils';

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
  const { name: mName, dataType: mDataType } =
    legacyMetricNameToNameAndDataType(metricName);
  const { data: metricTagsData } = api.useMetricsTags([
    {
      name: mName,
      dataType: mDataType,
    },
  ]);

  const options = useMemo(() => {
    const tags = metricTagsData?.data ?? [];
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
  }, [metricTagsData]);

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
      zIndex={9999}
    />
  );
}
