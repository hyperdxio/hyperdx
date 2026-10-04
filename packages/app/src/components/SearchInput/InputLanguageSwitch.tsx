import { Select } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';

type Language = 'sql' | 'lucene';

const DATA: { value: Language; label: string }[] = [
  { value: 'sql', label: 'SQL' },
  { value: 'lucene', label: 'Lucene' },
];

const DEFAULT_ALLOWED_LANGUAGES: Language[] = ['sql', 'lucene'];

export default function InputLanguageSwitch({
  language,
  onLanguageChange,
  allowedLanguages = DEFAULT_ALLOWED_LANGUAGES,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
  allowedLanguages?: Language[];
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
