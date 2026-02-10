import { Flex, Text } from '@mantine/core';

export default function InputLanguageSwitch({
  language,
  onLanguageChange,
}: {
  language: 'sql' | 'lucene';
  onLanguageChange: (language: 'sql' | 'lucene') => void;
}) {
  return (
    <Flex wrap="nowrap" gap="xxxs" px="sm">
      <Text
        c={language === 'sql' ? 'var(--color-text-brand)' : 'gray'}
        onClick={() => onLanguageChange('sql')}
        size="xxs"
        role="button"
      >
        SQL
      </Text>
      <Text size="xs">|</Text>
      <Text
        size="xxs"
        role="button"
        fw={500}
        c={language === 'lucene' ? 'var(--color-text-brand)' : 'gray'}
        onClick={() => onLanguageChange('lucene')}
      >
        Lucene
      </Text>
    </Flex>
  );
}
