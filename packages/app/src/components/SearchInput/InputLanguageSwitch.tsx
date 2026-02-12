import { Select } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';

type Language = 'sql' | 'lucene';

const DATA: { value: Language; label: string }[] = [
  { value: 'sql', label: 'SQL' },
  { value: 'lucene', label: 'Lucene' },
];

export default function InputLanguageSwitch({
  language,
  onLanguageChange,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  return (
    <Select
      size="xs"
      value={language}
      onChange={value => {
        if (value === 'sql' || value === 'lucene') {
          onLanguageChange(value);
        }
      }}
      data={DATA}
      w={80}
      rightSection={<IconChevronDown size={14} />}
      styles={{
        input: {
          border: 'none',
          background: 'transparent',
          minHeight: 28,
          fontWeight: 500,
        },
      }}
      aria-label="Query language"
    />
  );
}
