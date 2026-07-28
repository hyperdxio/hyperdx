import { useFieldArray } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  InputLabel,
  Stack,
  Text,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';

import { TextInputControlled } from '@/components/InputControlled';

import { DrawerControl } from './utils';

export function FilterTemplateList({ control }: { control: DrawerControl }) {
  const { t } = useTranslation('charts');
  const {
    fields: filters,
    append,
    remove,
  } = useFieldArray({
    control,
    name: 'onClick.filters' as const,
  });

  return (
    <Box>
      <InputLabel>{t('onClick.filters')}</InputLabel>
      <Text size="xs" c="dimmed" mb="xs">
        {t('onClick.filtersHelp')}
      </Text>
      <Stack gap="xs">
        {filters.map((filter, i) => (
          <Group key={filter.id} gap="xs" align="flex-start" wrap="nowrap">
            <TextInputControlled
              control={control}
              name={`onClick.filters.${i}.expression` as const}
              placeholder={t('onClick.expressionPlaceholder')}
              style={{ flex: 1 }}
              data-testid="onclick-filter-expression-input"
            />
            <TextInputControlled
              control={control}
              name={`onClick.filters.${i}.template` as const}
              placeholder="Template (e.g. {{ServiceName}})"
              style={{ flex: 1 }}
              data-testid="onclick-filter-template-input"
            />
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={t('onClick.removeFilter')}
              onClick={() => remove(i)}
              mt={3}
              data-testid="onclick-filter-remove-button"
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        ))}
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<IconPlus size={14} />}
          onClick={() =>
            append({
              kind: 'expressionTemplate',
              expression: '',
              template: '',
            })
          }
          style={{ alignSelf: 'flex-start' }}
        >
          {t('onClick.addFilter')}
        </Button>
      </Stack>
    </Box>
  );
}
