import {
  DEFAULT_QUERY_LANGUAGES,
  formatQueryLanguageLabel,
  type QueryLanguage,
} from '@hyperdx/common-utils/dist/types';
import { Select } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';

const DATA: { value: QueryLanguage; label: string }[] =
  DEFAULT_QUERY_LANGUAGES.map(lang => ({
    value: lang,
    label: formatQueryLanguageLabel(lang),
  }));

export default function InputLanguageSwitch({
  language,
  onLanguageChange,
  allowedLanguages = DEFAULT_QUERY_LANGUAGES,
}: {
  language: QueryLanguage;
  onLanguageChange: (language: QueryLanguage) => void;
  allowedLanguages?: QueryLanguage[];
}) {
  const options = DATA.filter(d => allowedLanguages.includes(d.value));

  return (
    <Select
      size="xs"
      value={language}
      onChange={value => {
        if (value === 'sql' || value === 'lucene') {
          onLanguageChange(value);
        }
      }}
      data={options}
      disabled={options.length <= 1}
      w={80}
      rightSection={options.length > 1 ? <IconChevronDown size={14} /> : null}
      styles={{
        input: {
          border: 'none',
          background: 'transparent',
          minHeight: 28,
          fontWeight: 500,
        },
        dropdown: {
          minWidth: 96,
        },
      }}
      aria-label="Query language"
    />
  );
}
