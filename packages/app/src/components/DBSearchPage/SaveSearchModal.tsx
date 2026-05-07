import { FormEvent, memo, useEffect, useState } from 'react';
import router from 'next/router';
import { useForm } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconX } from '@tabler/icons-react';

import { InputControlled } from '@/components/InputControlled';
import { getStoredLanguage } from '@/components/SearchInput/SearchWhereInput';
import { Tags } from '@/components/Tags';
import {
  useCreateSavedSearch,
  useSavedSearch,
  useUpdateSavedSearch,
} from '@/savedSearch';
import { useSource } from '@/source';
import { SearchConfig } from '@/types';

import { useSearchedConfigToChartConfig } from './hooks';

type SaveSearchModalProps = {
  searchedConfig: SearchConfig;
  opened: boolean;
  onClose: () => void;
  isUpdate: boolean;
  savedSearchId: string | undefined | null;
};

function SaveSearchModalComponent({
  searchedConfig,
  opened,
  onClose,
  isUpdate,
  savedSearchId,
}: SaveSearchModalProps) {
  const { data: savedSearch } = useSavedSearch(
    { id: savedSearchId ?? '' },
    {
      enabled: savedSearchId != null,
    },
  );

  const {
    control,
    handleSubmit,
    formState,
    reset: resetForm,
  } = useForm({
    ...(isUpdate
      ? {
          values: {
            name: savedSearch?.name ?? '',
          },
        }
      : {}),
    resetOptions: {
      keepDirtyValues: true,
      keepErrors: true,
    },
  });

  const closeAndReset = () => {
    resetForm();
    onClose();
  };

  const isValidName = (name?: string): boolean =>
    Boolean(name && name.trim().length > 0);
  const [tags, setTags] = useState<string[]>(savedSearch?.tags || []);

  // Update tags when savedSearch changes
  useEffect(() => {
    if (savedSearch?.tags) {
      setTags(savedSearch.tags);
    }
  }, [savedSearch]);
  const createSavedSearch = useCreateSavedSearch();
  const updateSavedSearch = useUpdateSavedSearch();

  const { data: sourceObj } = useSource({
    id: searchedConfig.source,
    kinds: [SourceKind.Log, SourceKind.Trace],
  });
  const effectiveSelect =
    searchedConfig.select || sourceObj?.defaultTableSelectExpression || '';

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    handleSubmit(async ({ name }) => {
      if (isUpdate) {
        if (savedSearchId == null) {
          throw new Error('savedSearchId is required for update');
        }

        updateSavedSearch.mutate(
          {
            id: savedSearchId,
            name,
            select: effectiveSelect,
            where: searchedConfig.where ?? '',
            whereLanguage:
              searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
            source: searchedConfig.source ?? '',
            orderBy: searchedConfig.orderBy ?? '',
            filters: searchedConfig.filters ?? [],
            tags: tags,
          },
          {
            onSuccess: () => {
              onClose();
            },
            onError: error => {
              console.error('Error updating saved search:', error);
              notifications.show({
                color: 'red',
                title: 'Error',
                message:
                  'An error occurred while updating your saved search. Please try again.',
              });
            },
          },
        );
      } else {
        try {
          const savedSearch = await createSavedSearch.mutateAsync({
            name,
            select: effectiveSelect,
            where: searchedConfig.where ?? '',
            whereLanguage:
              searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
            source: searchedConfig.source ?? '',
            orderBy: searchedConfig.orderBy ?? '',
            filters: searchedConfig.filters ?? [],
            tags: tags,
          });

          router.push(`/search/${savedSearch.id}${window.location.search}`);
          onClose();
        } catch (error) {
          console.error('Error creating saved search:', error);
          notifications.show({
            color: 'red',
            title: 'Error',
            message:
              'An error occurred while saving your search. Please try again.',
          });
        }
      }
    })();
  };

  const isPending = createSavedSearch.isPending || updateSavedSearch.isPending;

  const { data: chartConfig } = useSearchedConfigToChartConfig(searchedConfig);

  return (
    <Modal
      data-testid="save-search-modal"
      opened={opened}
      onClose={closeAndReset}
      title="Save Search"
      centered
      size="lg"
    >
      <form data-testid="save-search-form" onSubmit={onSubmit}>
        <Stack>
          {chartConfig != null ? (
            <Card withBorder>
              <Text size="xs" mb="xs">
                SELECT
              </Text>
              <Text mb="sm" size="xs">{`${chartConfig.select}`}</Text>
              <Text size="xs" mb="xs">
                FROM
              </Text>
              <Text mb="sm" size="xs">
                {chartConfig?.from.databaseName}.{chartConfig?.from.tableName}
              </Text>
              <Text size="xs" mb="xs">
                WHERE
              </Text>
              {chartConfig.where ? (
                <Text size="xs">{chartConfig.where}</Text>
              ) : (
                <Text size="xxs" fs="italic">
                  None
                </Text>
              )}
              <Text size="xs" mb="xs" mt="sm">
                ORDER BY
              </Text>
              <Text size="xs">{`${chartConfig.orderBy ?? ''}`}</Text>
              {searchedConfig.filters && searchedConfig.filters.length > 0 && (
                <>
                  <Text size="xs" mb="xs" mt="sm">
                    FILTERS
                  </Text>
                  <Stack gap="xs">
                    {searchedConfig.filters.map((filter, idx) => (
                      <Text key={idx} size="xs" c="dimmed">
                        {filter.type === 'sql_ast'
                          ? `${filter.left} ${filter.operator} ${filter.right}`
                          : filter.condition}
                      </Text>
                    ))}
                  </Stack>
                </>
              )}
            </Card>
          ) : (
            <Text>Loading Chart Config...</Text>
          )}
          <Box>
            <Text size="xs" mb="xs">
              Name
            </Text>
            <InputControlled
              data-testid="save-search-name-input"
              control={control}
              name="name"
              rules={{ required: true, validate: isValidName }}
            />
          </Box>
          <Box mb="sm">
            <Text size="xs" mb="xs">
              Tags
            </Text>
            <Group gap="xs" align="center" mb="xs">
              {tags.map(tag => (
                <Button
                  key={tag}
                  variant="secondary"
                  size="xs"
                  rightSection={
                    <ActionIcon
                      variant="transparent"
                      color="gray"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        setTags(tags.filter(t => t !== tag));
                      }}
                      size="xs"
                    >
                      <IconX size={14} />
                    </ActionIcon>
                  }
                >
                  {tag.toUpperCase()}
                </Button>
              ))}
              <Tags allowCreate values={tags} onChange={setTags}>
                <Button
                  data-testid="add-tag-button"
                  variant="secondary"
                  size="xs"
                >
                  <IconPlus size={14} className="me-1" />
                  Add Tag
                </Button>
              </Tags>
            </Group>
          </Box>
          <Button
            data-testid="save-search-submit-button"
            variant="primary"
            type="submit"
            disabled={!formState.isValid}
            loading={isPending}
          >
            {isUpdate ? 'Update' : 'Save'}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

export const SaveSearchModal = memo(SaveSearchModalComponent);
