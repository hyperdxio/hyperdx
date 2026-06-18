import { Anchor, Code, Group, Text } from '@mantine/core';
import { IconBulb } from '@tabler/icons-react';

import { FieldCandidates } from '@/utils/sourceFieldSuggestions';

export function SourceFieldCandidateHint({
  candidates,
  onApply,
}: {
  candidates?: FieldCandidates;
  onApply: (value: string) => void;
}) {
  if (!candidates) {
    return null;
  }

  const { canonical, alternates } = candidates;

  if (!canonical && alternates.length === 0) {
    return null;
  }

  return (
    <Group gap={6} mt={4} align="center" wrap="wrap">
      <IconBulb size={13} color="var(--mantine-color-yellow-6)" />
      {canonical ? (
        <>
          <Text size="xs" c="dimmed">
            Detected
          </Text>
          <Anchor size="xs" onClick={() => onApply(canonical)}>
            <Code>{canonical}</Code> — apply
          </Anchor>
        </>
      ) : (
        <Text size="xs" c="dimmed">
          Multiple candidates:
        </Text>
      )}
      {alternates.length > 0 && (
        <>
          {canonical && (
            <Text size="xs" c="dimmed">
              Other candidates:
            </Text>
          )}
          {alternates.map(name => (
            <Anchor
              key={name}
              size="xs"
              c="dimmed"
              onClick={() => onApply(name)}
            >
              <Code>{name}</Code>
            </Anchor>
          ))}
        </>
      )}
    </Group>
  );
}
