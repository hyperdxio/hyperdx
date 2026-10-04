import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Group,
  InputLabel,
  Select,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconHelpCircle, IconPencil } from '@tabler/icons-react';

import api from '@/api';

export default function QueryLanguageSettingsForm() {
  const { data: me } = api.useMe();
  const updateQueryLanguageSettings = api.useUpdateQueryLanguageSettings();
  const [isEditing, setIsEditing] = useState(false);

  const allowedLanguages: ('sql' | 'lucene')[] = me?.team
    ?.allowedQueryLanguages ?? ['lucene', 'sql'];
  const defaultLanguage: 'sql' | 'lucene' =
    me?.team?.defaultQueryLanguage ?? 'lucene';

  const [selectedAllowed, setSelectedAllowed] =
    useState<('sql' | 'lucene')[]>(allowedLanguages);
  const [selectedDefault, setSelectedDefault] = useState<'sql' | 'lucene'>(
    defaultLanguage,
  );

  const handleStartEdit = () => {
    setSelectedAllowed(allowedLanguages);
    setSelectedDefault(defaultLanguage);
    setIsEditing(true);
  };

  const handleToggleLanguage = (lang: 'sql' | 'lucene', checked: boolean) => {
    let newAllowed: ('sql' | 'lucene')[];
    if (checked) {
      newAllowed = [...selectedAllowed, lang];
    } else {
      newAllowed = selectedAllowed.filter(l => l !== lang);
    }
    if (newAllowed.length === 0) {
      notifications.show({
        color: 'red',
        message: 'At least one query language must be enabled',
      });
      return;
    }
    setSelectedAllowed(newAllowed);
    if (!newAllowed.includes(selectedDefault)) {
      setSelectedDefault(newAllowed[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedAllowed.length === 0) {
      notifications.show({
        color: 'red',
        message: 'At least one query language must be enabled',
      });
      return;
    }
    updateQueryLanguageSettings.mutate(
      {
        allowedQueryLanguages: selectedAllowed,
        defaultQueryLanguage: selectedDefault,
      },
      {
        onError: async err => {
          let message = 'Failed to update query language settings';
          try {
            const data = await (
              err as {
                response?: { json: () => Promise<{ message?: string }> };
              }
            )?.response?.json();
            if (data?.message) message = data.message;
          } catch {
            if (err instanceof Error) message = err.message;
          }
          notifications.show({
            color: 'red',
            message,
          });
        },
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: 'Updated query language settings',
          });
          setIsEditing(false);
        },
      },
    );
  };

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <InputLabel size="md">Query language configuration</InputLabel>
        <Tooltip label="Configure enabled query languages and default language for language pickers">
          <Text size="sm" style={{ cursor: 'help' }}>
            <IconHelpCircle size={14} />
          </Text>
        </Tooltip>
      </Group>
      <Text size="xs" c="dimmed">
        Restrict available query languages across search interfaces and set the
        default option.
      </Text>
      {isEditing ? (
        <form onSubmit={handleSubmit}>
          <Stack gap="sm" mt="xs">
            <Box>
              <InputLabel size="xs" mb={4}>
                Enabled query languages
              </InputLabel>
              <Group gap="md">
                <Checkbox
                  label="Lucene"
                  checked={selectedAllowed.includes('lucene')}
                  onChange={e =>
                    handleToggleLanguage('lucene', e.currentTarget.checked)
                  }
                />
                <Checkbox
                  label="SQL"
                  checked={selectedAllowed.includes('sql')}
                  onChange={e =>
                    handleToggleLanguage('sql', e.currentTarget.checked)
                  }
                />
              </Group>
            </Box>
            <Box style={{ maxWidth: 300 }}>
              <InputLabel size="xs" mb={4}>
                Default query language
              </InputLabel>
              <Select
                size="xs"
                value={selectedDefault}
                onChange={val => {
                  if (val === 'sql' || val === 'lucene') {
                    setSelectedDefault(val);
                  }
                }}
                data={selectedAllowed.map(l => ({
                  value: l,
                  label: l === 'sql' ? 'SQL' : 'Lucene',
                }))}
              />
            </Box>
            <Group gap="xs" mt="xs">
              <Button
                type="submit"
                size="xs"
                variant="primary"
                loading={updateQueryLanguageSettings.isPending}
              >
                Save
              </Button>
              <Button
                type="button"
                size="xs"
                variant="secondary"
                disabled={updateQueryLanguageSettings.isPending}
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
            </Group>
          </Stack>
        </form>
      ) : (
        <Group align="flex-start" justify="space-between">
          <Stack gap={2}>
            <Text size="sm">
              <Text span fw={500}>
                Enabled:{' '}
              </Text>
              {allowedLanguages
                .map(l => (l === 'sql' ? 'SQL' : 'Lucene'))
                .join(', ')}
            </Text>
            <Text size="sm">
              <Text span fw={500}>
                Default:{' '}
              </Text>
              {defaultLanguage === 'sql' ? 'SQL' : 'Lucene'}
            </Text>
          </Stack>
          <Button
            size="xs"
            variant="secondary"
            leftSection={<IconPencil size={16} />}
            onClick={handleStartEdit}
          >
            Change
          </Button>
        </Group>
      )}
    </Stack>
  );
}
