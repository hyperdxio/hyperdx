import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('sources');

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
            {t('fields.detected')}
          </Text>
          <Anchor size="xs" onClick={() => onApply(canonical)}>
            <Code>{canonical}</Code> — {t('fields.apply')}
          </Anchor>
        </>
      ) : (
        <Text size="xs" c="dimmed">
          {t('fields.multipleCandidates')}
        </Text>
      )}
      {alternates.length > 0 && (
        <>
          {canonical && (
            <Text size="xs" c="dimmed">
              {t('fields.otherCandidates')}
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
