import { useCallback, useEffect, useState } from 'react';
import router from 'next/router';
import {
  parseAsBoolean,
  parseAsJson,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { tcFromSource } from '@hyperdx/common-utils/dist/metadata';
import { Filter } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Group,
  Modal,
  Text,
} from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';

import { ContactSupportText } from '@/components/ContactSupportText';
import SearchPageActionBar from '@/components/SearchPageActionBar';
import { TableSourceForm } from '@/components/SourceForm';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLInlineEditor';
import { Tags } from '@/components/Tags';
import { TimePicker } from '@/components/TimePicker';
import WhereLanguageControlled from '@/components/WhereLanguageControlled';
import { IS_LOCAL_MODE } from '@/config';
import {
  useDeleteSavedSearch,
  useSavedSearch,
  useUpdateSavedSearch,
} from '@/savedSearch';
import { useSearchPageFilterState } from '@/searchFilters';
import SearchInputV2 from '@/SearchInputV2';
import { getFirstTimestampValueExpression, useSources } from '@/source';
import { useNewTimeQuery } from '@/timeQuery';
import { QUERY_LOCAL_STORAGE, useLocalStorage, usePrevious } from '@/utils';

const SearchConfigSchema = z.object({
  select: z.string(),
  source: z.string(),
  where: z.string(),
  whereLanguage: z.enum(['sql', 'lucene']),
  orderBy: z.string(),
  filters: z.array(
    z.union([
      z.object({
        type: z.literal('sql_ast'),
        operator: z.enum(['=', '<', '>', '>=', '<=', '!=']),
        left: z.string(),
        right: z.string(),
      }),
      z.object({
        type: z.enum(['sql', 'lucene']),
        condition: z.string(),
      }),
    ]),
  ),
});

type SearchConfigFromSchema = z.infer<typeof SearchConfigSchema>;

const queryStateMap = {
  source: parseAsString,
  where: parseAsString,
  select: parseAsString,
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
  filters: parseAsJson<Filter[]>(),
  orderBy: parseAsString,
};

const defaultTimeRange: [Date, Date] = [
  new Date(Date.now() - 1000 * 60 * 60),
  new Date(),
];

interface DBSearchFormProps {
  onOpenAlertModal?: () => void;
  onSetSaveSearchModalState?: (state: 'create' | 'update' | undefined) => void;
  onFormMethodsReady?: (methods: {
    setValue: (name: string, value: any) => void;
    onSubmit: () => void;
  }) => void;
}

export function DBSearchForm({
  onOpenAlertModal,
  onSetSaveSearchModalState,
  onFormMethodsReady,
}: DBSearchFormProps = {}) {
  // Next router is laggy behind window.location, which causes race
  // conditions with useQueryStates, so we'll parse it directly
  const paths = window.location.pathname.split('/');
  const savedSearchId = paths.length === 3 ? paths[2] : null;

  const [searchedConfig, setSearchedConfig] = useQueryStates(queryStateMap);

  const { data: savedSearch } = useSavedSearch(
    { id: `${savedSearchId}` },
    {
      enabled: savedSearchId != null,
    },
  );

  const { data: sources } = useSources();
  const [lastSelectedSourceId, setLastSelectedSourceId] = useLocalStorage(
    'hdx-last-selected-source-id',
    '',
  );

  const [analysisMode] = useQueryState(
    'mode',
    parseAsStringEnum<'results' | 'delta' | 'pattern'>([
      'results',
      'delta',
      'pattern',
    ]).withDefault('results'),
  );

  const [_isLive, setIsLive] = useQueryState('isLive', parseAsBoolean);
  const isLive = _isLive ?? true;

  const { control, watch, setValue, reset, handleSubmit, formState } =
    useForm<SearchConfigFromSchema>({
      values: {
        select: searchedConfig.select || '',
        where: searchedConfig.where || '',
        whereLanguage: searchedConfig.whereLanguage ?? 'lucene',
        source:
          searchedConfig.source ??
          (lastSelectedSourceId &&
          sources?.some(s => s.id === lastSelectedSourceId)
            ? lastSelectedSourceId
            : sources?.[0]?.id) ??
          '',
        filters: searchedConfig.filters ?? [],
        orderBy: searchedConfig.orderBy ?? '',
      },
      resetOptions: {
        keepDirtyValues: true,
        keepErrors: true,
      },
      resolver: zodResolver(SearchConfigSchema),
    });

  const inputSource = watch('source');
  const { data: inputSourceObjs } = useSources();
  const inputSourceObj = inputSourceObjs?.find(s => s.id === inputSource);

  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState('Live Tail');

  const { from, to, isReady, searchedTimeRange, onSearch, onTimeRangeSelect } =
    useNewTimeQuery({
      initialDisplayValue: 'Live Tail',
      initialTimeRange: defaultTimeRange,
      showRelativeInterval: isLive ?? true,
      setDisplayedTimeInputValue,
      updateInput: !isLive,
    });

  // Populate searched query with saved search if the query params have
  // been wiped (ex. clicking on the same saved search again)
  useEffect(() => {
    const { source, where, select, whereLanguage, filters } = searchedConfig;
    const isSearchConfigEmpty =
      !source && !where && !select && !whereLanguage && !filters?.length;

    if (isSearchConfigEmpty) {
      // Landed on saved search (if we just landed on a searchId route)
      if (
        savedSearch != null && // Make sure saved search data is loaded
        savedSearch.id === savedSearchId // Make sure we've loaded the correct saved search
      ) {
        setSearchedConfig({
          source: savedSearch.source,
          where: savedSearch.where,
          select: savedSearch.select,
          whereLanguage: savedSearch.whereLanguage as 'sql' | 'lucene',
          orderBy: savedSearch.orderBy ?? '',
        });
        return;
      }

      // Landed on a new search
      if (inputSource && savedSearchId == null) {
        setSearchedConfig({
          source: inputSource,
          where: '',
          select: '',
          whereLanguage: 'lucene',
          orderBy: '',
        });
        return;
      }
    }
  }, [
    savedSearch,
    searchedConfig,
    setSearchedConfig,
    savedSearchId,
    inputSource,
    lastSelectedSourceId,
    sources,
  ]);

  // If live tail is null, but time range exists, don't live tail
  // If live tail is null, and time range is null, let's live tail
  useEffect(() => {
    if (_isLive == null && isReady) {
      if (from == null && to == null) {
        setIsLive(true);
      } else {
        setIsLive(false);
      }
    }
  }, [_isLive, setIsLive, from, to, isReady]);

  // Sync url state back with form state
  const prevSearched = usePrevious(searchedConfig);
  useEffect(() => {
    if (JSON.stringify(prevSearched) !== JSON.stringify(searchedConfig)) {
      reset({
        select: searchedConfig?.select ?? '',
        where: searchedConfig?.where ?? '',
        whereLanguage: searchedConfig?.whereLanguage ?? 'lucene',
        source: searchedConfig?.source ?? undefined,
        filters: searchedConfig?.filters ?? [],
        orderBy: searchedConfig?.orderBy ?? '',
      });
    }
  }, [searchedConfig, reset, prevSearched]);

  // Populate searched query with saved search if the query params have been wiped
  useEffect(() => {
    const { source, where, select, whereLanguage, filters } = searchedConfig;
    const isSearchConfigEmpty =
      !source && !where && !select && !whereLanguage && !filters?.length;

    if (isSearchConfigEmpty) {
      if (savedSearch != null && savedSearch.id === savedSearchId) {
        setSearchedConfig({
          source: savedSearch.source,
          where: savedSearch.where,
          select: savedSearch.select,
          whereLanguage: savedSearch.whereLanguage as 'sql' | 'lucene',
          orderBy: savedSearch.orderBy ?? '',
        });
        return;
      }

      if (inputSource && savedSearchId == null) {
        setSearchedConfig({
          source: inputSource,
          where: '',
          select: '',
          whereLanguage: 'lucene',
          orderBy: '',
        });
        return;
      }
    }
  }, [
    savedSearch,
    searchedConfig,
    setSearchedConfig,
    savedSearchId,
    inputSource,
    lastSelectedSourceId,
    sources,
  ]);

  const onSubmit = useCallback(() => {
    onSearch(displayedTimeInputValue);
    handleSubmit(
      ({ select, where, whereLanguage, source, filters, orderBy }) => {
        setSearchedConfig({
          select,
          where,
          whereLanguage,
          source,
          filters,
          orderBy,
        });
      },
    )();
  }, [handleSubmit, setSearchedConfig, displayedTimeInputValue, onSearch]);

  const debouncedSubmit = useDebouncedCallback(onSubmit, 1000);
  const handleSetFilters = useCallback(
    (filters: Filter[]) => {
      setValue('filters', filters);
      debouncedSubmit();
    },
    [debouncedSubmit, setValue],
  );

  const searchFilters = useSearchPageFilterState({
    searchQuery: watch('filters') ?? undefined,
    onFilterChange: handleSetFilters,
  });

  useEffect(() => {
    const { unsubscribe } = watch((data, { name, type }) => {
      if (name === 'source' && type === 'change') {
        const newInputSourceObj = inputSourceObjs?.find(
          s => s.id === data.source,
        );
        if (newInputSourceObj != null) {
          setLastSelectedSourceId(newInputSourceObj.id);

          setValue(
            'select',
            newInputSourceObj?.defaultTableSelectExpression ?? '',
          );
          setValue(
            'orderBy',
            `${getFirstTimestampValueExpression(
              newInputSourceObj?.timestampValueExpression ?? '',
            )} DESC`,
          );
          searchFilters.clearAllFilters();
        }
      }
    });
    return () => unsubscribe();
  }, [
    watch,
    inputSourceObj,
    setValue,
    inputSourceObjs,
    searchFilters,
    setLastSelectedSourceId,
  ]);

  const [modelFormExpanded, setModelFormExpanded] = useState(false);
  const [newSourceModalOpened, setNewSourceModalOpened] = useState(false);

  const updateSavedSearch = useUpdateSavedSearch();
  const deleteSavedSearch = useDeleteSavedSearch();

  const onSaveSearch = useCallback(() => {
    if (savedSearch == null) {
      onSetSaveSearchModalState?.('create');
    } else {
      handleSubmit(s => {
        updateSavedSearch.mutate(
          {
            id: savedSearch.id,
            ...s,
          },
          {
            onSuccess: () => {
              onSubmit();
            },
          },
        );
      })();
    }
  }, [
    savedSearch,
    updateSavedSearch,
    onSubmit,
    handleSubmit,
    onSetSaveSearchModalState,
  ]);

  const handleUpdateTags = useCallback(
    (newTags: string[]) => {
      if (savedSearch?.id) {
        updateSavedSearch.mutate(
          {
            id: savedSearch.id,
            name: savedSearch.name,
            select: searchedConfig.select ?? '',
            where: searchedConfig.where ?? '',
            whereLanguage: searchedConfig.whereLanguage ?? 'lucene',
            source: searchedConfig.source ?? '',
            orderBy: searchedConfig.orderBy ?? '',
            tags: newTags,
          },
          {
            onSuccess: () => {
              notifications.show({
                color: 'green',
                message: 'Tags updated successfully',
              });
            },
            onError: () => {
              notifications.show({
                color: 'red',
                message: (
                  <>
                    An error occurred. <ContactSupportText />
                  </>
                ),
              });
            },
          },
        );
      }
    },
    [savedSearch, searchedConfig, updateSavedSearch],
  );

  const defaultOrderBy = `${getFirstTimestampValueExpression(
    inputSourceObj?.timestampValueExpression ?? '',
  )} DESC`;

  // Expose form methods to parent component
  useEffect(() => {
    if (onFormMethodsReady) {
      onFormMethodsReady({
        setValue,
        onSubmit,
      });
    }
  }, [onFormMethodsReady, setValue, onSubmit]);

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSubmit();
        return false;
      }}
    >
      <Flex gap="sm" px="sm" pt="sm" wrap="nowrap">
        <Group gap="4px" wrap="nowrap">
          <SourceSelectControlled
            key={`${savedSearchId}`}
            size="xs"
            control={control}
            name="source"
            onCreate={() => {
              setNewSourceModalOpened(true);
            }}
          />
          <ActionIcon
            variant="subtle"
            color="dark.2"
            size="sm"
            onClick={() => setModelFormExpanded(v => !v)}
            title="Edit Source"
          >
            <Text size="xs">
              <i className="bi bi-gear" />
            </Text>
          </ActionIcon>
        </Group>
        <Box style={{ minWidth: 100, flexGrow: 1 }}>
          <SQLInlineEditorControlled
            tableConnections={tcFromSource(inputSourceObj)}
            control={control}
            name="select"
            defaultValue={inputSourceObj?.defaultTableSelectExpression}
            placeholder={
              inputSourceObj?.defaultTableSelectExpression || 'SELECT Columns'
            }
            onSubmit={onSubmit}
            label="SELECT"
            size="xs"
          />
        </Box>
        <Box style={{ maxWidth: 400, width: '20%' }}>
          <SQLInlineEditorControlled
            tableConnections={tcFromSource(inputSourceObj)}
            control={control}
            name="orderBy"
            defaultValue={defaultOrderBy}
            onSubmit={onSubmit}
            label="ORDER BY"
            size="xs"
          />
        </Box>
        {!IS_LOCAL_MODE && (
          <>
            {!savedSearchId ? (
              <Button
                variant="outline"
                color="dark.2"
                px="xs"
                size="xs"
                onClick={onSaveSearch}
                style={{ flexShrink: 0 }}
              >
                Save
              </Button>
            ) : (
              <Button
                variant="outline"
                color="dark.2"
                px="xs"
                size="xs"
                onClick={() => {
                  onSetSaveSearchModalState?.('update');
                }}
                style={{ flexShrink: 0 }}
              >
                Update
              </Button>
            )}
            {!IS_LOCAL_MODE && (
              <Button
                variant="outline"
                color="dark.2"
                px="xs"
                size="xs"
                onClick={onOpenAlertModal}
                style={{ flexShrink: 0 }}
              >
                Alerts
              </Button>
            )}
            {!!savedSearch && (
              <>
                <Tags
                  allowCreate
                  values={savedSearch.tags || []}
                  onChange={handleUpdateTags}
                >
                  <Button
                    variant="outline"
                    color="dark.2"
                    px="xs"
                    size="xs"
                    style={{ flexShrink: 0 }}
                  >
                    <i className="bi bi-tags-fill me-1"></i>
                    {savedSearch.tags?.length || 0}
                  </Button>
                </Tags>

                <SearchPageActionBar
                  onClickDeleteSavedSearch={() => {
                    deleteSavedSearch.mutate(savedSearch?.id ?? '', {
                      onSuccess: () => {
                        router.push('/search');
                      },
                    });
                  }}
                  onClickRenameSavedSearch={() => {
                    onSetSaveSearchModalState?.('update');
                  }}
                />
              </>
            )}
          </>
        )}
      </Flex>
      <Modal
        size="xl"
        opened={modelFormExpanded}
        onClose={() => {
          setModelFormExpanded(false);
        }}
        title="Edit Source"
      >
        <TableSourceForm sourceId={inputSource} />
      </Modal>
      <Modal
        size="xl"
        opened={newSourceModalOpened}
        onClose={() => {
          setNewSourceModalOpened(false);
        }}
        title="Configure New Source"
      >
        <TableSourceForm
          isNew
          defaultName="My New Source"
          onCreate={newSource => {
            setValue('source', newSource.id);
            setNewSourceModalOpened(false);
          }}
        />
      </Modal>
      <Flex gap="sm" mt="sm" px="sm">
        <WhereLanguageControlled
          name="whereLanguage"
          control={control}
          sqlInput={
            <Box style={{ width: '75%', flexGrow: 1 }}>
              <SQLInlineEditorControlled
                tableConnections={tcFromSource(inputSourceObj)}
                control={control}
                name="where"
                placeholder="SQL WHERE clause (ex. column = 'foo')"
                onLanguageChange={lang =>
                  setValue('whereLanguage', lang, {
                    shouldDirty: true,
                  })
                }
                language="sql"
                onSubmit={onSubmit}
                label="WHERE"
                queryHistoryType={QUERY_LOCAL_STORAGE.SEARCH_SQL}
                enableHotkey
              />
            </Box>
          }
          luceneInput={
            <SearchInputV2
              tableConnections={tcFromSource(inputSourceObj)}
              control={control}
              name="where"
              onLanguageChange={lang =>
                setValue('whereLanguage', lang, {
                  shouldDirty: true,
                })
              }
              onSubmit={onSubmit}
              language="lucene"
              placeholder="Search your events w/ Lucene ex. column:foo"
              queryHistoryType={QUERY_LOCAL_STORAGE.SEARCH_LUCENE}
              enableHotkey
            />
          }
        />
        <TimePicker
          inputValue={displayedTimeInputValue}
          setInputValue={setDisplayedTimeInputValue}
          onSearch={range => {
            if (range === 'Live Tail') {
              setIsLive(true);
            } else {
              setIsLive(false);
            }
            onSearch(range);
          }}
          showLive={analysisMode === 'results'}
        />
        <Button
          variant="outline"
          type="submit"
          color={formState.isDirty ? 'green' : 'gray.4'}
        >
          <i className="bi bi-play"></i>
        </Button>
      </Flex>
    </form>
  );
}
