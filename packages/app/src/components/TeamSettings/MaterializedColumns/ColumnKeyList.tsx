import { Stack, Text } from '@mantine/core';

export function ColumnKeyList({
  column,
  keys,
}: {
  column: string;
  keys: string[];
}) {
  return (
    <Stack gap={4}>
      <Text size="sm">{column}</Text>
      <Stack gap={2} pl="md">
        {keys.map(k => (
          <Text size="sm" key={k}>
            {k}
          </Text>
        ))}
      </Stack>
    </Stack>
  );
}
