import {
  FormEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import router from 'next/router';
import {
  parseAsBoolean,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { Filter, SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { Flex } from '@mantine/core';
import { useDebouncedCallback, useDisclosure } from '@mantine/hooks';
import { SortingState } from '@tanstack/react-table';

import { ActiveFilterPills } from '@/components/ActiveFilterPills';
import { ContactSupportText } from '@/components/ContactSupportText';
import OnboardingModal from '@/components/OnboardingModal';
import DirectTraceSidePanel from '@/components/Search/DirectTraceSidePanel';
import { getStoredLanguage } from '@/components/SearchInput/SearchWhereInput';
import SourceSchemaPreview from '@/components/SourceSchemaPreview';
import { IS_LOCAL_MODE } from '@/config';
import { DBSearchPageAlertModal } from '@/DBSearchPageAlertModal';
import { withAppNav } from '@/layout';
import { useSavedSearch } from '@/savedSearch';
import { useSearchPageFilterState } from '@/searchFilters';
import { useSource, useSources } from '@/source';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';
import { SearchConfig } from '@/types';
import { useLocalStorage } from '@/utils';
import { parseAsSortingStateString } from '@/utils/queryParsers';

import {
  useChartConfigs,
  useDefaultOrderBy,
  useDirectTraceController,
  useFormUrlSync,
  useLiveTailControls,
  useQueryErrors,
  useSavedSearchActions,
  useSourceChangeReset,
} from './hooks';
import { SavedSearchHeader } from './SavedSearchHeader';
import { SaveSearchModal } from './SaveSearchModal';
import { SearchQueryRow } from './SearchQueryRow';
import { SearchResultsArea } from './SearchResultsArea';
import { SearchTopBar } from './SearchTopBar';
import { NewSourceModal, SourceEditModal } from './SourceModals';
import {
  generateSearchUrl as buildGeneratedSearchUrl,
  getDefaultSourceId,
  parseDisplayedColumns,
  queryStateMap,
  SearchConfigFromSchema,
  SearchConfigSchema,
  toggleColumnInSelect,
} from './utils';

import searchPageStyles from '@/../styles/SearchPage.module.scss';

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 15m', false) as [Date, Date];

export function DBSearchPage() {
  const brandName = useBrandDisplayName();
  // Track the URL pathname in state so DBSearchPage stays in sync with
  // /search ↔ /search/[savedSearchId] navigations. We update on
  // `routeChangeStart` (the destination URL is given as the event arg, so
  // we don't have to wait for `pushState` to happen) and again on
  // `routeChangeComplete` (browser back/forward, programmatic
  // `router.replace`, etc., where we just resync with `window.location`).
  // We don't use `useRouter().query.savedSearchId` — next/router's
  // internal state lags behind `window.location` and would race with
  // `useQueryStates`.
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    setPathname(window.location.pathname);
    const onStart = (nextUrl: string) => {
      setPathname(nextUrl.split('?')[0].split('#')[0]);
    };
    const onComplete = () => {
      setPathname(window.location.pathname);
    };
    router.events.on('routeChangeStart', onStart);
    router.events.on('routeChangeComplete', onComplete);
    return () => {
      router.events.off('routeChangeStart', onStart);
      router.events.off('routeChangeComplete', onComplete);
    };
  }, []);

  const paths = pathname.split('/');
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
  const { data: searchedSource } = useSource({
    id: searchedConfig.source,
    kinds: [SourceKind.Log, SourceKind.Trace],
  });

  const [analysisMode, setAnalysisMode] = useQueryState(
    'mode',
    parseAsStringEnum<'results' | 'delta' | 'pattern'>([
      'results',
      'delta',
      'pattern',
    ]).withDefault('results'),
  );

  const [isLive, setIsLive] = useQueryState(
    'isLive',
    parseAsBoolean.withDefault(true),
  );

  useEffect(() => {
    if (analysisMode === 'delta' || analysisMode === 'pattern') {
      setIsLive(false);
    }
  }, [analysisMode, setIsLive]);

  const [isFilterSidebarCollapsed, setIsFilterSidebarCollapsed] =
    useLocalStorage<boolean>('isFilterSidebarCollapsed', false);

  const [denoiseResults, _setDenoiseResults] = useQueryState(
    'denoise',
    parseAsBoolean.withDefault(false),
  );
  const setDenoiseResults = useCallback(
    (value: boolean) => {
      setIsLive(false);
      _setDenoiseResults(value);
    },
    [setIsLive, _setDenoiseResults],
  );

  // Get default source
  const defaultSourceId = useMemo(
    () => getDefaultSourceId(sources, lastSelectedSourceId),
    [sources, lastSelectedSourceId],
  );

  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState('Live Tail');

  const { isReady, searchedTimeRange, onSearch, onTimeRangeSelect } =
    useNewTimeQuery({
      initialDisplayValue: 'Live Tail',
      initialTimeRange: defaultTimeRange,
      showRelativeInterval: isLive ?? true,
      setDisplayedTimeInputValue,
      updateInput: !isLive,
    });

  const {
    directTraceId,
    directTraceSource,
    chartSourceId,
    directTraceFocusDate,
    onDirectTraceSourceChange,
    closeDirectTraceSidePanel,
  } = useDirectTraceController({
    searchedSource,
    searchedConfigSource: searchedConfig.source,
    sources,
    searchedTimeRange,
    isReady,
    setIsLive,
    setSearchedConfig,
    onTimeRangeSelect,
  });

  const { control, setValue, reset, handleSubmit, formState } =
    useForm<SearchConfigFromSchema>({
      values: {
        select: searchedConfig.select || '',
        where: searchedConfig.where || '',
        whereLanguage:
          searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
        source:
          searchedConfig.source ||
          (savedSearchId || directTraceId ? '' : defaultSourceId),
        filters: searchedConfig.filters ?? [],
        orderBy: searchedConfig.orderBy ?? '',
      },
      resetOptions: {
        keepDirtyValues: true,
        keepErrors: true,
      },
      resolver: zodResolver(SearchConfigSchema),
    });

  const inputSource = useWatch({ name: 'source', control });

  const defaultOrderBy = useDefaultOrderBy(inputSource);

  // The default search config to use when the user hasn't changed the search config
  const defaultSearchConfig = useMemo(() => {
    let _savedSearch = savedSearch;
    // Ensure to not use the saved search if the saved search id is not the same as the current saved search id
    if (!savedSearchId || savedSearch?.id !== savedSearchId) {
      _savedSearch = undefined;
    }
    // Ensure to not use the saved search if the input source is not the same as the saved search source
    if (inputSource !== savedSearch?.source) {
      _savedSearch = undefined;
    }
    return {
      select:
        _savedSearch?.select ??
        (searchedSource?.kind === SourceKind.Log ||
        searchedSource?.kind === SourceKind.Trace
          ? searchedSource.defaultTableSelectExpression
          : undefined),
      where: _savedSearch?.where ?? '',
      whereLanguage: _savedSearch?.whereLanguage ?? 'lucene',
      source: _savedSearch?.source,
      filters: _savedSearch?.filters ?? [],
      orderBy: _savedSearch?.orderBy || defaultOrderBy,
    };
  }, [searchedSource, inputSource, savedSearch, defaultOrderBy, savedSearchId]);

  const { data: inputSourceObjs } = useSources();
  const inputSourceObj = inputSourceObjs?.find(s => s.id === inputSource);

  useFormUrlSync({
    searchedConfig,
    setSearchedConfig,
    savedSearch,
    savedSearchId,
    defaultSourceId,
    directTraceId,
    reset,
  });

  const inputWhere = useWatch({ name: 'where', control });
  const inputWhereLanguage = useWatch({ name: 'whereLanguage', control });

  const {
    hasQueryError,
    queryError,
    whereSuggestions,
    handleTableError,
    clearQueryErrors,
  } = useQueryErrors({
    inputWhere,
    inputWhereLanguage,
    setIsLive,
  });

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
    clearQueryErrors();
  }, [
    handleSubmit,
    setSearchedConfig,
    displayedTimeInputValue,
    onSearch,
    clearQueryErrors,
  ]);

  const debouncedSubmit = useDebouncedCallback(onSubmit, 1000);
  const handleSetFilters = useCallback(
    (filters: Filter[]) => {
      setValue('filters', filters);
      debouncedSubmit();
    },
    [debouncedSubmit, setValue],
  );

  const filters = useWatch({ name: 'filters', control });
  const searchFilters = useSearchPageFilterState({
    searchQuery: filters ?? undefined,
    onFilterChange: handleSetFilters,
  });

  const watchedSource = useWatch({
    control,
    name: 'source',
    // Watch will reset when changing saved search, so we need to default to the URL
    defaultValue: searchedConfig.source ?? undefined,
  });

  useSourceChangeReset({
    watchedSource,
    inputSourceObjs,
    savedSearch,
    savedSearchId,
    setValue,
    setLastSelectedSourceId,
    clearAllFilters: searchFilters.clearAllFilters,
  });

  const [modelFormExpanded, setModelFormExpanded] = useState(false); // Used in local mode

  const {
    chartConfig,
    isChartConfigLoading,
    queryReady,
    dbSqlRowTableConfig,
    aliasWith,
    histogramTimeChartConfig,
    filtersChartConfig,
  } = useChartConfigs({
    searchedConfig,
    chartSourceId,
    defaultSearchConfig,
    searchedSource,
    isLive: !!isLive,
    searchedTimeRange,
  });

  const {
    saveSearchModalState,
    clearSaveSearchModalState,
    onSaveSearch,
    handleUpdateTags,
    handleRenameSavedSearch,
    handleDeleteSavedSearch,
    handleSaveAsNew,
    onUpdateSearchClick,
  } = useSavedSearchActions({
    savedSearch,
    searchedConfig,
    handleSubmit,
    onSubmit,
    contactSupportNode: <ContactSupportText />,
  });

  const [newSourceModalOpened, setNewSourceModalOpened] = useState(false);

  const {
    interval,
    refreshFrequency,
    setRefreshFrequency,
    shouldShowLiveModeHint,
    collapseAllRows,
    onExpandedRowsChange,
    handleResumeLiveTail,
    onTableScroll,
    onSidebarOpen,
    onTimePickerSearch,
    onTimePickerRelativeSearch,
    handleTimeRangeSelect,
  } = useLiveTailControls({
    isLive: !!isLive,
    setIsLive,
    isReady,
    queryReady,
    searchedConfigSource: searchedConfig.source,
    setDisplayedTimeInputValue,
    onSearch,
    onTimeRangeSelect,
  });

  const displayedColumns = useMemo(
    () =>
      parseDisplayedColumns(
        dbSqlRowTableConfig?.select,
        defaultSearchConfig.select,
      ),
    [dbSqlRowTableConfig?.select, defaultSearchConfig.select],
  );

  const toggleColumn = useCallback(
    (column: string) => {
      setValue('select', toggleColumnInSelect(displayedColumns, column));
      onSubmit();
    },
    [displayedColumns, setValue, onSubmit],
  );

  const generateSearchUrl = useCallback(
    ({
      where,
      whereLanguage,
      source,
    }: {
      where: SearchConfig['where'];
      whereLanguage: SearchConfig['whereLanguage'];
      source?: TSource;
    }) =>
      buildGeneratedSearchUrl({
        where,
        whereLanguage,
        source,
        searchedSource,
        searchedConfig,
        searchedTimeRange,
        interval,
      }),
    [interval, searchedConfig, searchedSource, searchedTimeRange],
  );

  const [isAlertModalOpen, { open: openAlertModal, close: closeAlertModal }] =
    useDisclosure();

  useEffect(() => {
    if (isReady && queryReady && !isChartConfigLoading) {
      // Only trigger if we haven't searched yet (no time range in URL)
      const searchParams = new URLSearchParams(window.location.search);
      if (
        directTraceId == null &&
        !searchParams.has('from') &&
        !searchParams.has('to')
      ) {
        onSearch('Live Tail');
      }
    }
  }, [directTraceId, isReady, queryReady, isChartConfigLoading, onSearch]);

  const onFormSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
    e => {
      e.preventDefault();
      onSubmit();
      return false;
    },
    [onSubmit],
  );

  const onSortingChange = useCallback(
    (sortState: SortingState | null) => {
      setIsLive(false);
      const sort = sortState?.at(0);
      setSearchedConfig({
        orderBy: sort
          ? `${sort.id} ${sort.desc ? 'DESC' : 'ASC'}`
          : defaultSearchConfig.orderBy,
      });
    },
    [setIsLive, defaultSearchConfig.orderBy, setSearchedConfig],
  );
  // Parse the orderBy string into a SortingState. We need the string
  // version in other places so we keep this parser separate.
  const initialSortBy = useMemo(() => {
    const orderBy = parseAsSortingStateString.parse(
      searchedConfig.orderBy ?? '',
    );
    return orderBy ? [orderBy] : [];
  }, [searchedConfig.orderBy]);

  const openNewSourceModal = useCallback(() => {
    setNewSourceModalOpened(true);
  }, []);

  const [isDrawerChildModalOpen, setDrawerChildModalOpen] = useState(false);

  const rowTableContext = useMemo(
    () => ({
      onPropertyAddClick: searchFilters.setFilterValue,
      displayedColumns,
      toggleColumn,
      generateSearchUrl,
      dbSqlRowTableConfig,
      isChildModalOpen: isDrawerChildModalOpen,
      setChildModalOpen: setDrawerChildModalOpen,
      source: searchedSource,
    }),
    [
      searchFilters.setFilterValue,
      searchedSource,
      dbSqlRowTableConfig,
      displayedColumns,
      toggleColumn,
      generateSearchUrl,
      isDrawerChildModalOpen,
    ],
  );

  const inputSourceTableConnection = useMemo(
    () => tcFromSource(inputSourceObj),
    [inputSourceObj],
  );

  const sourceSchemaPreview = useMemo(
    () => <SourceSchemaPreview source={inputSourceObj} variant="text" />,
    [inputSourceObj],
  );

  const onModelFormExpandClose = useCallback(() => {
    setModelFormExpanded(false);
  }, [setModelFormExpanded]);

  const onEditSources = useCallback(() => {
    if (IS_LOCAL_MODE) {
      setModelFormExpanded(v => !v);
    } else {
      router.push('/team');
    }
  }, [setModelFormExpanded]);

  const setNewSourceModalClosed = useCallback(
    () => setNewSourceModalOpened(false),
    [setNewSourceModalOpened],
  );

  const onNewSourceCreate = useCallback(
    (newSource: TSource) => {
      setValue('source', newSource.id);
      setNewSourceModalClosed();
    },
    [setValue, setNewSourceModalClosed],
  );

  const onAcceptWhereSuggestion = useCallback(
    (corrected: string) => {
      setValue('where', corrected);
    },
    [setValue],
  );

  return (
    <Flex
      direction="column"
      h="100vh"
      style={{ overflow: 'hidden' }}
      data-testid="search-page"
    >
      <Head>
        <title>
          {savedSearch ? `${savedSearch.name} Search` : 'Search'} - {brandName}
        </title>
      </Head>
      {!IS_LOCAL_MODE && isAlertModalOpen && (
        <DBSearchPageAlertModal
          id={savedSearch?.id}
          searchedConfig={searchedConfig}
          open={isAlertModalOpen}
          onClose={closeAlertModal}
        />
      )}
      <OnboardingModal />
      {savedSearch && (
        <SavedSearchHeader
          savedSearch={savedSearch}
          onRename={handleRenameSavedSearch}
          onUpdateTags={handleUpdateTags}
          onDeleteSavedSearch={handleDeleteSavedSearch}
          onSaveAsNew={handleSaveAsNew}
        />
      )}
      <form
        data-testid="search-form"
        onSubmit={onFormSubmit}
        className={searchPageStyles.searchForm}
      >
        <SearchTopBar
          control={control}
          savedSearchId={savedSearchId}
          inputSourceTableConnection={inputSourceTableConnection}
          defaultSelect={defaultSearchConfig.select}
          defaultOrderBy={defaultSearchConfig.orderBy}
          sourceSchemaPreview={sourceSchemaPreview}
          hideAlerts={IS_LOCAL_MODE}
          onCreateSource={openNewSourceModal}
          onEditSources={onEditSources}
          onSubmit={onSubmit}
          onSaveSearch={onSaveSearch}
          onUpdateSearch={onUpdateSearchClick}
          onOpenAlertModal={openAlertModal}
        />
        <SourceEditModal
          opened={modelFormExpanded}
          onClose={onModelFormExpandClose}
          inputSource={inputSource}
        />
        <NewSourceModal
          opened={newSourceModalOpened}
          onClose={setNewSourceModalClosed}
          onCreate={onNewSourceCreate}
        />
        <SearchQueryRow
          control={control}
          inputSourceTableConnection={inputSourceTableConnection}
          displayedTimeInputValue={displayedTimeInputValue}
          setDisplayedTimeInputValue={setDisplayedTimeInputValue}
          isLive={!!isLive}
          interval={interval}
          refreshFrequency={refreshFrequency}
          setRefreshFrequency={setRefreshFrequency}
          showLive={analysisMode === 'results'}
          isFormStateDirty={formState.isDirty}
          onSubmit={onSubmit}
          onTimePickerSearch={onTimePickerSearch}
          onTimePickerRelativeSearch={onTimePickerRelativeSearch}
        />
        <ActiveFilterPills searchFilters={searchFilters} mt={6} />
      </form>
      {searchedConfig != null && searchedSource != null && (
        <SaveSearchModal
          opened={saveSearchModalState != null}
          onClose={clearSaveSearchModalState}
          searchedConfig={searchedConfig}
          isUpdate={saveSearchModalState === 'update'}
          savedSearchId={savedSearchId}
        />
      )}
      <DirectTraceSidePanel
        opened={directTraceId != null}
        traceId={directTraceId ?? ''}
        traceSourceId={directTraceSource?.id ?? null}
        dateRange={searchedTimeRange}
        focusDate={directTraceFocusDate}
        onClose={closeDirectTraceSidePanel}
        onSourceChange={onDirectTraceSourceChange}
      />
      <Flex
        direction="column"
        style={{ overflow: 'hidden', height: '100%' }}
        className="bg-body"
      >
        <SearchResultsArea
          queryReady={queryReady}
          analysisMode={analysisMode}
          setAnalysisMode={setAnalysisMode}
          isFilterSidebarCollapsed={isFilterSidebarCollapsed}
          setIsFilterSidebarCollapsed={setIsFilterSidebarCollapsed}
          denoiseResults={!!denoiseResults}
          setDenoiseResults={setDenoiseResults}
          isLive={!!isLive}
          filtersChartConfig={filtersChartConfig}
          chartConfig={chartConfig ?? null}
          histogramTimeChartConfig={histogramTimeChartConfig}
          dbSqlRowTableConfig={dbSqlRowTableConfig}
          inputSourceId={inputSourceObj?.id}
          searchedSource={searchedSource}
          searchedSourceId={searchedConfig.source ?? undefined}
          searchedTimeRange={searchedTimeRange}
          isReady={isReady}
          hasQueryError={hasQueryError}
          queryError={queryError}
          whereSuggestions={whereSuggestions ?? undefined}
          shouldShowLiveModeHint={shouldShowLiveModeHint}
          collapseAllRows={collapseAllRows}
          initialSortBy={initialSortBy}
          rowTableContext={rowTableContext}
          aliasWith={aliasWith}
          searchFilters={searchFilters}
          displayedColumns={displayedColumns}
          onColumnToggle={toggleColumn}
          onTimeRangeSelect={handleTimeRangeSelect}
          onResumeLiveTail={handleResumeLiveTail}
          onTableScroll={onTableScroll}
          onSidebarOpen={onSidebarOpen}
          onExpandedRowsChange={onExpandedRowsChange}
          onTableError={handleTableError}
          onSortingChange={onSortingChange}
          onAcceptWhereSuggestion={onAcceptWhereSuggestion}
        />
      </Flex>
    </Flex>
  );
}

const DBSearchPageDynamic = dynamic(async () => DBSearchPage, { ssr: false });

// @ts-ignore
DBSearchPageDynamic.getLayout = withAppNav;

export default DBSearchPageDynamic;
