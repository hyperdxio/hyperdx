import { useCallback } from 'react';
import type { WhereLanguage } from '@hyperdx/common-utils/dist/types';
import { Box, Card, Divider, Select, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import api from '@/api';

const ANY_LANGUAGE = 'any';

const OPTIONS: { value: WhereLanguage | typeof ANY_LANGUAGE; label: string }[] =
  [
    { value: ANY_LANGUAGE, label: 'Lucene and SQL' },
    { value: 'lucene', label: 'Lucene only' },
    { value: 'sql', label: 'SQL only' },
  ];

function isWhereLanguage(value: string): value is WhereLanguage {
  return value === 'sql' || value === 'lucene';
}

export default function TeamSearchSettingsSection() {
  const { data: me, refetch: refetchMe } = api.useMe();
  const updateSearchSettings = api.useUpdateSearchSettings();
  const restriction = me?.team.queryLanguageRestriction;

  const handleChange = useCallback(
    (value: string | null) => {
      if (value == null) return;
      const next = isWhereLanguage(value) ? value : null;
      if (next === (restriction ?? null)) return;

      updateSearchSettings.mutate(
        { queryLanguageRestriction: next },
        {
          onError: () => {
            notifications.show({
              color: 'red',
              message: 'Failed to update query language',
            });
          },
          onSuccess: () => {
            notifications.show({
              color: 'green',
              message: 'Updated query language',
            });
            refetchMe();
          },
        },
      );
    },
    [refetchMe, restriction, updateSearchSettings],
  );

  return (
    <Box id="team_search_settings">
      <Text size="md">Search settings</Text>
      <Divider my="md" />
      <Card>
        <Stack gap="xs">
          <Select
            label="Query language"
            description="Restricting to one language locks every WHERE input to it and hides the language switch. Inputs that only accept one language are unaffected."
            data={OPTIONS}
            value={restriction ?? ANY_LANGUAGE}
            onChange={handleChange}
            disabled={me == null || updateSearchSettings.isPending}
            allowDeselect={false}
            size="xs"
            maw={300}
            data-testid="team-query-language-select"
          />
        </Stack>
      </Card>
    </Box>
  );
}
