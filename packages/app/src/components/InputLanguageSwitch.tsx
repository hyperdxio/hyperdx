import { Flex, Text } from '@mantine/core';

export default function InputLanguageSwitch({
  language,
  onLanguageChange,
  showHotkey,
}: {
  language: 'sql' | 'lucene';
  onLanguageChange: (language: 'sql' | 'lucene') => void;
  showHotkey?: boolean;
}) {
  return (
    <Flex wrap="nowrap" gap="xxxs" px="sm">
      {showHotkey && (
        <Text c="gray.3" size="xxs" bg="gray.8" px={4} py={0} mr={4} lh={1.4}>
          /
        </Text>
      )}
      <Text
        c={language === 'sql' ? 'green' : 'dark.0'}
        onClick={() => onLanguageChange('sql')}
        size="xs"
        role="button"
      >
        SQL
      </Text>
      <Text c="dark.2" size="xs">
        |
      </Text>
      <Text
        size="xs"
        role="button"
        c={language === 'lucene' ? 'green' : 'dark.0'}
        onClick={() => onLanguageChange('lucene')}
      >
        Lucene
      </Text>
    </Flex>
  );
}
