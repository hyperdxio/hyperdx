import { SegmentedControl } from '@mantine/core';

type Language = 'sql' | 'lucene';

export default function InputLanguageSwitch({
  language,
  onLanguageChange,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  return (
    <SegmentedControl
      size="xs"
      color="gray"
      value={language}
      onChange={value => {
        if (value === 'sql' || value === 'lucene') {
          onLanguageChange(value);
        }
      }}
      data={[
        { label: 'SQL', value: 'sql' as const },
        { label: 'Lucene', value: 'lucene' as const },
      ]}
    />
  );
}
