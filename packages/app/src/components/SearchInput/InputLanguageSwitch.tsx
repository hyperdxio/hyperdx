import type { WhereLanguage } from '@hyperdx/common-utils/dist/types';
import { Select } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';

export const LANGUAGE_LABELS: Record<WhereLanguage, string> = {
  sql: 'SQL',
  lucene: 'Lucene',
};

const DATA: { value: WhereLanguage; label: string }[] = [
  { value: 'sql', label: LANGUAGE_LABELS.sql },
  { value: 'lucene', label: LANGUAGE_LABELS.lucene },
];

export default function InputLanguageSwitch({
  language,
  onLanguageChange,
}: {
  language: WhereLanguage;
  onLanguageChange: (language: WhereLanguage) => void;
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
        dropdown: {
          minWidth: 96,
        },
      }}
      aria-label="Query language"
    />
  );
}
