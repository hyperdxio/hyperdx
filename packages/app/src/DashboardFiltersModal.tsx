import { useEffect, useMemo, useState } from 'react';
import { Controller, FieldError, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  parseKeyPath,
  TableConnection,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  DashboardFilter,
  DashboardFilterRenderMode,
  Filter,
  MetricsDataType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Button,
  Center,
  Group,
  Input,
  Modal,
  Paper,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconFilter,
  IconInfoCircle,
  IconLock,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';

import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { VirtualMultiSelect } from '@/components/VirtualMultiSelect/VirtualMultiSelect';
import { parseQuery } from '@/searchFilters';

import { SourceMultiSelectControlled } from './components/SourceMultiSelect';
import SourceSchemaPreview, {
  isSourceSchemaPreviewEnabled,
} from './components/SourceSchemaPreview';
import { SourceSelectControlled } from './components/SourceSelect';
import { useDashboardFilterValues } from './hooks/useDashboardFilterValues';
import { useSource, useSources } from './source';
import { getMetricTableName } from './utils';

import styles from '../styles/DashboardFiltersModal.module.scss';

const MODAL_SIZE = 'md';

// The Visibility select presents one combined control over the two
// orthogonal schema fields `constant` and `renderMode`. The three preset
// values are the only meaningful combinations in v1; the schema admits
// more, leaving room for MCP / external API callers to express future
// variants (e.g. constant + editable).
type FilterVisibility = z.infer<typeof DashboardFilterRenderMode>;

const getFilterVisibility = (filter: {
  constant?: boolean;
  renderMode?: FilterVisibility;
}): FilterVisibility => {
  if (filter.renderMode === 'hidden') return 'hidden';
  if (filter.renderMode === 'readonly' || filter.constant) return 'readonly';
  return 'editable';
};

const applyFilterVisibility = (
  visibility: FilterVisibility,
): Pick<DashboardFilter, 'constant' | 'renderMode'> => {
  switch (visibility) {
    case 'readonly':
      return { constant: true, renderMode: 'readonly' };
    case 'hidden':
      return { constant: true, renderMode: 'hidden' };
    case 'editable':
    default:
      // The submit path destructures `constant` and `renderMode` out of
      // the form values before spreading, so an empty object here is
      // intentional: the resulting persisted filter has neither key.
      // That keeps the wire format identical to today's editable filter
      // (no spurious `constant: undefined` / `renderMode: undefined`
      // entries that would diff against a server round-trip).
      return {};
  }
};

const VISIBILITY_OPTIONS: { value: FilterVisibility; label: string }[] = [
  { value: 'editable', label: 'Editable' },
  { value: 'readonly', label: 'Read-only (locked to saved default)' },
  { value: 'hidden', label: 'Hidden (locked, no chip in the filter bar)' },
];

// Sentinel time range used to satisfy the `useDashboardFilterValues` hook
// signature when the form is not configured enough to actually fetch
// values (queryReady=false). The hook only fires when filtersForQuery is
// non-empty, so this placeholder never reaches ClickHouse.
const NEVER_USED_RANGE: [Date, Date] = [new Date(0), new Date(0)];

interface CustomInputWrapperProps {
  children: React.ReactNode;
  label: string;
  tooltipText?: string;
  error?: FieldError;
}

const CustomInputWrapper = ({
  children,
  label,
  tooltipText,
  error,
}: CustomInputWrapperProps) => {
  const errorMessage =
    error &&
    (error.message ||
      (error?.type === 'required' ? 'This field is required' : 'Error'));

  return (
    <div>
      <Input.Label>{label}</Input.Label>
      {tooltipText && (
        <Tooltip label={tooltipText}>
          <IconInfoCircle size={14} className="ms-2" />
        </Tooltip>
      )}
      {errorMessage && (
        <Input.Error color="red" size="sm">
          {errorMessage}
        </Input.Error>
      )}
      <div className="mt-1">{children}</div>
    </div>
  );
};

// Look up the current default values for a filter expression by parsing
// the dashboard's savedFilterValues (Lucene-encoded Filter[]) and reading
// the included set keyed by the normalized expression.
const getDefaultValuesForExpression = (
  expression: string,
  savedFilterValues: Filter[] | null | undefined,
): string[] => {
  if (!savedFilterValues?.length) return [];
  const { filters: parsed } = parseQuery(savedFilterValues);
  const norm = parseKeyPath(expression).join('.');
  for (const [key, value] of Object.entries(parsed)) {
    if (parseKeyPath(key).join('.') === norm) {
      return Array.from(value.included).map(v => v.toString());
    }
  }
  return [];
};

// Default-value picker for the filter editor. Reuses the same value
// query the filter chip uses (useDashboardFilterValues) so the author
// gets autocomplete from the configured source / expression / WHERE
// triple, with the same UX as the runtime chip dropdown.
//
// The query runs only when the filter is configured enough to fetch
// values (source + expression). Until then, the picker still accepts
// free-form input so the author can pre-populate a value before the
// source schema is fully loaded.
interface FilterDefaultValueSelectProps {
  filter: Pick<
    DashboardFilter,
    | 'id'
    | 'type'
    | 'name'
    | 'source'
    | 'expression'
    | 'where'
    | 'whereLanguage'
    | 'sourceMetricType'
  > | null;
  dateRange?: [Date, Date];
  value: string[];
  onChange: (values: string[]) => void;
}

const FilterDefaultValueSelect = ({
  filter,
  dateRange,
  value,
  onChange,
}: FilterDefaultValueSelectProps) => {
  // The hook always runs but is a no-op when the filter has no source
  // or no dateRange (no query is issued).
  const queryReady =
    !!filter && !!filter.source && !!filter.expression && !!dateRange;
  const filtersForQuery = useMemo(
    () => (queryReady && filter ? [filter] : []),
    [queryReady, filter],
  );

  const { data: filterValuesById, isLoading } = useDashboardFilterValues({
    filters: filtersForQuery,
    dateRange: dateRange ?? NEVER_USED_RANGE,
  });

  const queriedValues = useMemo(() => {
    if (!filter) return [];
    const entry = filterValuesById.get(filter.id);
    return entry?.values ?? [];
  }, [filterValuesById, filter]);

  // Always include the currently-selected values so they remain visible
  // as pills even if the source / WHERE narrowing wouldn't return them
  // (e.g. the author selected a value that's no longer in the
  // dropdown's current result set).
  const options = useMemo(() => {
    const set = new Set<string>([...queriedValues, ...value]);
    return Array.from(set).sort();
  }, [queriedValues, value]);

  return (
    <VirtualMultiSelect
      data={options}
      values={value}
      onChange={onChange}
      placeholder={
        queryReady && isLoading
          ? 'Loading values...'
          : queryReady
            ? 'Pick one or more values'
            : 'Pick a source and expression first'
      }
      disabled={!queryReady}
      data-testid="filter-default-values-input"
    />
  );
};

interface DashboardFilterEditFormProps {
  filter: DashboardFilter;
  isNew: boolean;
  source: TSource | undefined;
  savedFilterValues?: Filter[] | null;
  /**
   * Time range used by the default-value picker to query autocomplete
   * options. Same range the runtime chip uses, so the editor preview
   * matches what the viewer would see.
   */
  dateRange?: [Date, Date];
  /**
   * Whether this filter editor supports the locked / constant filter
   * flow. Set to true for regular dashboards (which carry
   * savedFilterValues for storing the locked value); leave false for
   * preset dashboards (Services) where the locked value has nowhere to
   * be stored in v1.
   */
  supportsConstantFilters?: boolean;
  onSave: (
    definition: DashboardFilter,
    options?: { defaultValues?: string[] },
  ) => void;
  onClose: () => void;
  onCancel: () => void;
}

interface FilterEditFormValues extends DashboardFilter {
  // UI-only synthetic field that maps to (constant, renderMode) on save.
  // Kept in form state so users see the chosen preset reflected when
  // editing an existing filter.
  visibility: FilterVisibility;
  // UI-only synthetic field that maps to a savedFilterValues entry for
  // this filter's expression. Surfaced so the author can set the locked
  // default value for read-only and hidden filters without relying on
  // the filter chip (which is disabled or absent in those modes).
  defaultValues: string[];
}

const DashboardFilterEditForm = ({
  filter,
  isNew,
  source: presetSource,
  savedFilterValues,
  dateRange,
  supportsConstantFilters = false,
  onSave,
  onClose,
  onCancel,
}: DashboardFilterEditFormProps) => {
  // Snapshot the saved default value once per filter.id. A background
  // savedFilterValues refetch that lands while the modal is open would
  // otherwise re-derive `initialDefaultValues`, fire the reset effect,
  // and wipe any in-progress edit to the `defaultValues` field. The
  // reset still runs when the user switches which filter is being
  // edited (filter.id changes).
  //
  // State (not a ref) so the initial form values can read the snapshot
  // during render without tripping the react-hooks/refs lint, and so
  // the dep array on the reset effect omits savedFilterValues by design.
  const [initialDefaultValues, setInitialDefaultValues] = useState<string[]>(
    () => getDefaultValuesForExpression(filter.expression, savedFilterValues),
  );

  const { handleSubmit, register, formState, control, reset } =
    useForm<FilterEditFormValues>({
      defaultValues: {
        ...filter,
        where: filter.where ?? '',
        whereLanguage: filter.whereLanguage ?? getStoredLanguage() ?? 'sql',
        appliesToSourceIds: filter.appliesToSourceIds ?? [],
        visibility: getFilterVisibility(filter),
        defaultValues: initialDefaultValues,
      },
    });

  // Re-snapshot and reset when the user switches which filter is being
  // edited. Omitting `savedFilterValues` from the dep array is deliberate:
  // a background refetch should not wipe in-progress edits. The latest
  // value is still read on the next filter switch via the closure on the
  // savedFilterValues prop.
  useEffect(() => {
    const next = getDefaultValuesForExpression(
      filter.expression,
      savedFilterValues,
    );
    setInitialDefaultValues(next);
    reset({
      ...filter,
      where: filter.where ?? '',
      whereLanguage: filter.whereLanguage ?? getStoredLanguage() ?? 'sql',
      appliesToSourceIds: filter.appliesToSourceIds ?? [],
      visibility: getFilterVisibility(filter),
      defaultValues: next,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.id, reset]);

  const watchedVisibility = useWatch({ control, name: 'visibility' });
  const watchedDefaultValues = useWatch({ control, name: 'defaultValues' });
  const watchedExpression = useWatch({ control, name: 'expression' });
  const watchedWhere = useWatch({ control, name: 'where' });
  const watchedWhereLanguage = useWatch({ control, name: 'whereLanguage' });

  // CodeMirror-backed inputs (`expression`, `where`, `whereLanguage`) emit
  // a `useWatch` update on every keystroke, so feeding them straight into
  // `filterForValueQuery` below would fire a new ClickHouse autocomplete
  // request per character and frequently with mid-edit partial WHERE
  // strings that the proxy rejects server-side. Debounce on a stable
  // 300ms window (matches `MetricAttributeHelperPanel`) so the picker
  // only re-queries once the author pauses typing.
  const [debouncedExpression] = useDebouncedValue(watchedExpression, 300);
  const [debouncedWhere] = useDebouncedValue(watchedWhere, 300);
  const [debouncedWhereLanguage] = useDebouncedValue(watchedWhereLanguage, 300);

  const sourceId = useWatch({ control, name: 'source' });
  const { data: source } = useSource({ id: sourceId });

  const metricType = useWatch({ control, name: 'sourceMetricType' });
  const tableName = source && getMetricTableName(source, metricType);
  const tableConnection: TableConnection | undefined = tableName
    ? {
        connectionId: source.connection,
        databaseName: source.from.databaseName,
        tableName,
      }
    : undefined;

  const sourceIsMetric = source?.kind === SourceKind.Metric;
  const metricTypes = Object.values(MetricsDataType).filter(type =>
    source?.kind === SourceKind.Metric ? source.metricTables?.[type] : false,
  );

  // Build a stable filter shape from the watched form fields so the
  // default-value picker can query autocomplete values matching the
  // configured source / expression / WHERE. Memoize on the primitive
  // bits so we don't re-issue the same query on unrelated form edits.
  //
  // Gate on `tableName` (not just `sourceId`): a metric source with no
  // metricType picked yet resolves to `source.from.tableName`, which is
  // typically empty on a metric source. Firing the autocomplete in that
  // state produces a malformed DESCRIBE ({db}.{} with an empty Identifier
  // substitution) that the ClickHouse proxy rejects with a 500. The
  // query only makes sense once the form has enough information to name
  // a real table.
  const filterForValueQuery = useMemo(() => {
    if (!sourceId || !debouncedExpression || !tableName) return null;
    return {
      id: filter.id,
      type: 'QUERY_EXPRESSION' as const,
      name: filter.name || 'preview',
      source: sourceId,
      expression: debouncedExpression,
      where: debouncedWhere?.trim() ? debouncedWhere : undefined,
      whereLanguage: debouncedWhere?.trim()
        ? (debouncedWhereLanguage ?? 'sql')
        : undefined,
      sourceMetricType: metricType,
    };
  }, [
    filter.id,
    filter.name,
    sourceId,
    debouncedExpression,
    debouncedWhere,
    debouncedWhereLanguage,
    metricType,
    tableName,
  ]);

  const [modalContentRef, setModalContentRef] = useState<HTMLElement | null>(
    null,
  );
  const [isSourceSchemaPreviewOpen, setIsSourceSchemaPreviewOpen] =
    useState(false);

  return (
    <Modal
      title={isNew ? 'Add filter' : 'Edit filter'}
      opened
      onClose={onClose}
      size={MODAL_SIZE}
    >
      <div ref={setModalContentRef}>
        <form
          onSubmit={handleSubmit(values => {
            const trimmedWhere = values.where?.trim() ?? '';
            const appliesTo = values.appliesToSourceIds?.filter(
              id => !!id?.length,
            );
            // Strip the UI-only synthetic fields AND the schema's
            // `constant` / `renderMode` pair before saving: `visibility`
            // is the canonical UI input and `applyFilterVisibility`
            // below produces the (constant, renderMode) pair to spread
            // on top of `rest`. Pulling `constant` and `renderMode`
            // out of `rest` here ensures the spread of
            // `visibilityFields` is authoritative: when the author
            // flips a saved readonly/hidden filter back to "Editable",
            // the persisted filter ends up without those keys (matching
            // a fresh editable filter), not still carrying the stale
            // `constant: true` / `renderMode: 'readonly'` from before
            // the visibility change.
            const {
              visibility,
              defaultValues: editedDefaultValues,
              constant: _droppedConstant,
              renderMode: _droppedRenderMode,
              ...rest
            } = values;
            // Visibility / default-value editing is gated on
            // `supportsConstantFilters`. When the parent (e.g. the
            // preset dashboard editor) doesn't opt in, those UI fields
            // are not rendered and the saved filter keeps whatever
            // constant/renderMode it already had.
            const visibilityFields = supportsConstantFilters
              ? applyFilterVisibility(visibility)
              : {};
            // Only round-trip the editor's default value when it would
            // actually change the saved state. Editable filters keep using
            // the chip + "Save default" flow; the editor only takes
            // ownership of the saved value when the author is in a locked
            // mode (or when they're clearing a previously-saved default
            // they could no longer reach via the chip).
            const sanitizedDefaults =
              editedDefaultValues
                ?.map(v => v.trim())
                .filter(v => v.length > 0) ?? [];
            const initialNormalized = initialDefaultValues.map(v => v.trim());
            // Set equality so reordering the same values doesn't fire a
            // spurious save write.
            const sanitizedSet = new Set(sanitizedDefaults);
            const initialSet = new Set(initialNormalized);
            const defaultsChanged =
              sanitizedSet.size !== initialSet.size ||
              [...sanitizedSet].some(v => !initialSet.has(v));
            const shouldUpdateDefaults =
              supportsConstantFilters &&
              (visibility !== 'editable' || defaultsChanged);
            onSave(
              {
                ...rest,
                ...visibilityFields,
                where: trimmedWhere || undefined,
                whereLanguage: trimmedWhere
                  ? (values.whereLanguage ?? 'sql')
                  : undefined,
                appliesToSourceIds: appliesTo?.length ? appliesTo : undefined,
              },
              shouldUpdateDefaults
                ? { defaultValues: sanitizedDefaults }
                : undefined,
            );
          })}
        >
          <Stack>
            <CustomInputWrapper label="Name" error={formState.errors.name}>
              <TextInput
                placeholder="Name"
                data-testid="filter-name-input"
                {...register('name', { required: true, minLength: 1 })}
              />
            </CustomInputWrapper>
            <CustomInputWrapper
              label="Data source"
              tooltipText="The data source that the filter values are queried from"
              error={formState.errors.source}
            >
              <SourceSelectControlled
                control={control}
                name="source"
                data-testid="source-selector"
                rules={{ required: true }}
                comboboxProps={{ withinPortal: true }}
                onSchemaPreview={() => setIsSourceSchemaPreviewOpen(true)}
                isSchemaPreviewEnabled={isSourceSchemaPreviewEnabled(source)}
                disabled={!!presetSource}
              />
              <SourceSchemaPreview
                source={source}
                controlled
                open={isSourceSchemaPreviewOpen}
                onClose={() => setIsSourceSchemaPreviewOpen(false)}
              />
            </CustomInputWrapper>
            {!presetSource && (
              <CustomInputWrapper
                label="Applies to sources"
                tooltipText="Leave empty to apply to all tiles. Selecting one or more sources restricts the filter to only tiles using those sources."
              >
                <SourceMultiSelectControlled
                  control={control}
                  name="appliesToSourceIds"
                  data-testid="applies-to-source-selector"
                  comboboxProps={{ withinPortal: true }}
                  placeholder="All sources"
                />
              </CustomInputWrapper>
            )}
            {sourceIsMetric && (
              <CustomInputWrapper
                label="Metric type"
                tooltipText="The metric table that the filter values are queried from"
                error={formState.errors.sourceMetricType}
              >
                <Controller
                  control={control}
                  name="sourceMetricType"
                  rules={{ required: true }}
                  render={({ field: { onChange, value } }) => (
                    <Radio.Group
                      value={value}
                      onChange={v => onChange(v)}
                      withAsterisk
                    >
                      <Group>
                        {metricTypes.map(type => (
                          <Radio key={type} value={type} label={type} />
                        ))}
                      </Group>
                    </Radio.Group>
                  )}
                />
              </CustomInputWrapper>
            )}

            <CustomInputWrapper
              label="Filter expression"
              tooltipText="The SQL column or expression to filter on"
              error={formState.errors.expression}
            >
              <SQLInlineEditorControlled
                tableConnection={tableConnection}
                control={control}
                name="expression"
                placeholder="SQL column or expression"
                language="sql"
                enableHotkey
                rules={{ required: true }}
                parentRef={modalContentRef}
              />
            </CustomInputWrapper>

            <CustomInputWrapper
              label="Dropdown values filter"
              tooltipText="Optional condition used to filter the rows from which available filter values are queried"
            >
              <SearchWhereInput
                tableConnection={tableConnection}
                control={control}
                name="where"
                languageName="whereLanguage"
                showLabel={false}
                allowMultiline={true}
                sqlPlaceholder="Filter for dropdown values"
                lucenePlaceholder="Filter for dropdown values"
              />
            </CustomInputWrapper>

            {supportsConstantFilters && (
              <>
                <CustomInputWrapper
                  label="Default value"
                  tooltipText="Optional. Value(s) applied when the dashboard loads. Editable filters: viewers can change via the chip; the 'Save default' button (under the dashboard's ⋯ menu) captures the current chip state back into this default. Read-only and Hidden filters: this value is locked; viewers cannot change it."
                >
                  <Controller
                    control={control}
                    name="defaultValues"
                    render={({ field: { onChange, value } }) => (
                      <FilterDefaultValueSelect
                        filter={filterForValueQuery}
                        dateRange={dateRange}
                        value={value ?? []}
                        onChange={onChange}
                      />
                    )}
                  />
                </CustomInputWrapper>

                <CustomInputWrapper
                  label="Visibility"
                  tooltipText="Editable: viewers can change the value via the chip. Read-only: chip is shown with a lock icon; the default value applies and cannot be changed. Hidden: no chip in the filter bar; the default value still applies silently. Pick Read-only or Hidden when this dashboard is a template scoped by a single saved value."
                >
                  <Controller
                    control={control}
                    name="visibility"
                    render={({ field: { onChange, value } }) => (
                      <Select
                        value={value}
                        onChange={v => onChange(v ?? 'editable')}
                        data={VISIBILITY_OPTIONS}
                        allowDeselect={false}
                        comboboxProps={{ withinPortal: true }}
                        data-testid="filter-visibility-select"
                      />
                    )}
                  />
                </CustomInputWrapper>

                {watchedVisibility !== 'editable' &&
                  (!watchedDefaultValues ||
                    watchedDefaultValues.length === 0) && (
                    <Alert
                      icon={<IconLock size={14} />}
                      color="yellow"
                      variant="light"
                    >
                      <Text size="xs">
                        No default value set. Tiles will not be scoped on this
                        expression until you add one above.
                      </Text>
                    </Alert>
                  )}
              </>
            )}

            <Group justify="space-between" my="xs">
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                data-testid="save-filter-button"
              >
                Save filter
              </Button>
            </Group>
          </Stack>
        </form>
      </div>
    </Modal>
  );
};

interface EmptyStateProps {
  onCreateFilter: () => void;
  onClose: () => void;
}

const EmptyState = ({ onCreateFilter, onClose }: EmptyStateProps) => {
  return (
    <Modal opened onClose={onClose} size={MODAL_SIZE}>
      <Stack
        align="center"
        justify="center"
        pt="lg"
        pb="xl"
        data-testid="dashboard-filters-empty-state"
      >
        <IconFilter />
        <Title order={4}>No filters yet.</Title>
        <Text size="sm" ta="center" px="xl">
          Add filters to let users quickly narrow data on key columns. Saved
          filters will stay with this dashboard.
        </Text>
        <Button
          variant="primary"
          onClick={onCreateFilter}
          data-testid="add-filter-button"
        >
          Add new filter
        </Button>
      </Stack>
    </Modal>
  );
};

interface DashboardFiltersListProps {
  filters: DashboardFilter[];
  isLoading?: boolean;
  hideAppliesTo?: boolean;
  onEdit: (filter: DashboardFilter) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onAddNew: () => void;
}

const DashboardFiltersList = ({
  filters,
  isLoading,
  hideAppliesTo,
  onEdit,
  onRemove,
  onClose,
  onAddNew,
}: DashboardFiltersListProps) => {
  const { data: sources } = useSources();

  return (
    <Modal
      opened
      onClose={onClose}
      title="Filters"
      size={MODAL_SIZE}
      className={styles.modal}
    >
      <Stack
        className={styles.filtersContainer}
        gap="xs"
        data-testid="dashboard-filters-list"
      >
        {filters.map(filter => {
          const queriedSourceName = sources?.find(
            s => s.id === filter.source,
          )?.name;
          const appliedSourceNames = filter.appliesToSourceIds?.length
            ? filter.appliesToSourceIds
                .map(id => sources?.find(s => s.id === id)?.name)
                .filter((name): name is string => !!name)
            : undefined;
          const appliedDisplay = appliedSourceNames
            ? appliedSourceNames.join(', ')
            : 'All sources';
          return (
            <Paper
              key={filter.id}
              withBorder
              className={styles.filterPaper}
              p="xs"
              variant="muted"
              data-testid={`dashboard-filter-item-${filter.name}`}
            >
              <Group justify="space-between" className={styles.filterHeader}>
                <Text size="xs">{filter.name}</Text>
                <Group>
                  <UnstyledButton
                    onClick={() => onEdit(filter)}
                    className={styles.filterActionButton}
                    data-testid={`edit-filter-button-${filter.name}`}
                  >
                    <IconPencil size={16} />
                  </UnstyledButton>
                  <UnstyledButton
                    onClick={() => onRemove(filter.id)}
                    className={`${styles.filterActionButton} ${styles.deleteButton}`}
                    data-testid={`delete-filter-button-${filter.name}`}
                  >
                    <IconTrash size={16} />
                  </UnstyledButton>
                </Group>
              </Group>
              <Group gap="xs" wrap="nowrap">
                <Tooltip
                  label="Source the dropdown values are queried from"
                  withinPortal
                >
                  <IconSearch size={14} />
                </Tooltip>
                <Text size="xs" truncate="end">
                  {queriedSourceName}
                </Text>
              </Group>
              {!hideAppliesTo && (
                <Group
                  gap="xs"
                  wrap="nowrap"
                  data-testid={`dashboard-filter-applies-to-${filter.name}`}
                >
                  <Tooltip
                    label={'Sources this filter applies to'}
                    withinPortal
                    multiline
                    maw={400}
                  >
                    <IconFilter size={14} style={{ flexShrink: 0 }} />
                  </Tooltip>
                  <Text size="xs" truncate="end">
                    {appliedDisplay}
                  </Text>
                </Group>
              )}
            </Paper>
          );
        })}
        {isLoading && (
          <Center>
            <IconRefresh className="spin-animate" />
          </Center>
        )}
      </Stack>

      <Group justify="space-between" my="sm">
        <Button
          variant="secondary"
          onClick={onClose}
          data-testid="close-filters-button"
        >
          Close
        </Button>
        <Button
          variant="primary"
          onClick={onAddNew}
          data-testid="add-filter-button"
        >
          Add new filter
        </Button>
      </Group>
    </Modal>
  );
};

interface DashboardFiltersEditModalProps {
  opened: boolean;
  filters: DashboardFilter[];
  /**
   * The dashboard's saved filter values. The editor reads the default
   * value for the filter currently being edited from this array (matched
   * by expression). Optional; when omitted the default-value editor
   * starts empty for locked filters.
   */
  savedFilterValues?: Filter[] | null;
  /**
   * Time range used by the default-value picker to query autocomplete
   * options. Same range the runtime chip uses.
   */
  dateRange?: [Date, Date];
  /**
   * Whether this modal supports the locked / constant filter flow. Set
   * to true for regular dashboards (DBDashboardPage); leave false for
   * preset dashboards (Services) where the locked value has nowhere
   * to be stored.
   */
  supportsConstantFilters?: boolean;
  isLoading?: boolean;
  source?: TSource;
  onClose: () => void;
  onSaveFilter: (
    filter: DashboardFilter,
    options?: { defaultValues?: string[] },
  ) => void;
  onRemoveFilter: (id: string) => void;
}

const NEW_FILTER_ID = 'new';

const DashboardFiltersModal = ({
  opened,
  filters,
  savedFilterValues,
  dateRange,
  supportsConstantFilters = false,
  isLoading,
  source,
  onClose,
  onSaveFilter,
  onRemoveFilter,
}: DashboardFiltersEditModalProps) => {
  const [selectedFilter, setSelectedFilter] = useState<DashboardFilter>();

  useEffect(() => {
    if (opened) {
      setSelectedFilter(undefined);
    }
  }, [opened]);

  const handleRemoveFilter = (id: string) => {
    if (id === selectedFilter?.id) {
      setSelectedFilter(filters.find(f => f.id !== id));
    }
    onRemoveFilter(id);
  };

  const handleAddNewFilter = () => {
    setSelectedFilter({
      id: NEW_FILTER_ID,
      type: 'QUERY_EXPRESSION',
      name: '',
      expression: '',
      source: source?.id ?? '',
      where: '',
      whereLanguage: getStoredLanguage() ?? 'sql',
    });
  };

  const handleSaveFilter = (
    filter: DashboardFilter,
    options?: { defaultValues?: string[] },
  ) => {
    setSelectedFilter(undefined);
    if (filter.id === NEW_FILTER_ID) {
      const filterWithRealId = { ...filter, id: crypto.randomUUID() };
      onSaveFilter(filterWithRealId, options);
    } else {
      onSaveFilter(filter, options);
    }
  };

  const isEmpty = !selectedFilter && filters.length === 0;

  if (!opened) {
    return null;
  } else if (isEmpty) {
    return <EmptyState onCreateFilter={handleAddNewFilter} onClose={onClose} />;
  } else if (selectedFilter) {
    return (
      <DashboardFilterEditForm
        filter={selectedFilter}
        savedFilterValues={savedFilterValues}
        dateRange={dateRange}
        supportsConstantFilters={supportsConstantFilters}
        onSave={handleSaveFilter}
        onCancel={() => setSelectedFilter(undefined)}
        onClose={onClose}
        isNew={selectedFilter.id === NEW_FILTER_ID}
        source={source}
      />
    );
  } else {
    return (
      <DashboardFiltersList
        filters={filters}
        onEdit={setSelectedFilter}
        onRemove={handleRemoveFilter}
        onClose={onClose}
        onAddNew={handleAddNewFilter}
        isLoading={isLoading}
        hideAppliesTo={!!source}
      />
    );
  }
};

export default DashboardFiltersModal;
