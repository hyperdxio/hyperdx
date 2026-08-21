import { useEffect, useMemo, useState } from 'react';
import { Controller, FieldError, useForm, useWatch } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import {
  deriveVariableName,
  getFilterVariableName,
  hasFilterEffect,
  isFilterBroadcastEnabled,
  isFilterVariableEnabled,
  validateVariableName,
} from '@hyperdx/common-utils/dist/filters';
import {
  ChartVariable,
  DashboardFilter,
  MetricsDataType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Input,
  Modal,
  Paper,
  Radio,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconFilter,
  IconInfoCircle,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';

import { CheckBoxControlled } from '@/components/InputControlled';
import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { SqlVariablesProvider } from '@/components/SQLEditor/variableCompletions';

import { SourceMultiSelectControlled } from './components/SourceMultiSelect';
import SourceSchemaPreview, {
  isSourceSchemaPreviewEnabled,
} from './components/SourceSchemaPreview';
import { SourceSelectControlled } from './components/SourceSelect';
import { useSource, useSources } from './source';
import { getMetricTableName } from './utils';

import styles from '@styles/DashboardFiltersModal.module.scss';

const MODAL_SIZE = 'lg';

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

interface DashboardFilterEditFormProps {
  filter: DashboardFilter;
  isNew: boolean;
  source: TSource | undefined;
  /** Filters that already exist on the dashboard, used to keep variable names unique. */
  filters: DashboardFilter[];
  /** Whether the broadcast / variable controls are available. */
  showVariableOptions: boolean;
  onSave: (definition: DashboardFilter) => void;
  onClose: () => void;
  onCancel: () => void;
}

/** Normalize a stored filter into form values. */
const toFormValues = (filter: DashboardFilter): DashboardFilter => ({
  ...filter,
  where: filter.where ?? '',
  whereLanguage: filter.whereLanguage ?? getStoredLanguage() ?? 'sql',
  appliesToSourceIds: filter.appliesToSourceIds ?? [],
  isBroadcastEnabled: isFilterBroadcastEnabled(filter),
  isVariableEnabled: isFilterVariableEnabled(filter),
  variableName: filter.variableName ?? '',
});

const DashboardFilterEditForm = ({
  filter,
  isNew,
  source: presetSource,
  filters,
  showVariableOptions,
  onSave,
  onClose,
  onCancel,
}: DashboardFilterEditFormProps) => {
  const {
    handleSubmit,
    register,
    formState,
    control,
    reset,
    setValue,
    trigger,
  } = useForm<DashboardFilter>({
    defaultValues: toFormValues(filter),
  });

  // Gates the auto-fill of Variable Name from Name below. Seeded true for a filter
  // that already has a stored name, because renaming an existing filter must not
  // silently break the tiles referencing its old token.
  const [hasEditedVariableName, setHasEditedVariableName] = useState(
    !isNew && !!filter.variableName,
  );

  useEffect(() => {
    reset(toFormValues(filter));
    setHasEditedVariableName(!isNew && !!filter.variableName);
  }, [filter, isNew, reset]);

  const otherFilters = useMemo(
    () => filters.filter(f => f.id !== filter.id),
    [filters, filter.id],
  );

  const [
    formFilterName,
    formIsBroadCastEnabled,
    formIsVariableEnabled,
    formAppliesToSourceIds,
  ] = useWatch({
    control,
    name: [
      'name',
      'isBroadcastEnabled',
      'isVariableEnabled',
      'appliesToSourceIds',
    ],
  });

  // Both modes on with an unrestricted broadcast is almost always a mistake:
  // broadcast already reaches every tile, so the variable adds nothing and the
  // tiles that reference it get filtered twice over. Scoping the broadcast is
  // what makes the pair meaningful, so nudge toward "Applies to sources".
  const showUnscopedBroadcastWarning =
    showVariableOptions &&
    formIsBroadCastEnabled !== false &&
    formIsVariableEnabled === true &&
    !formAppliesToSourceIds?.some(id => !!id?.length);

  const derivedVariableName = deriveVariableName(formFilterName ?? '');

  useEffect(() => {
    if (!showVariableOptions || hasEditedVariableName) return;
    setValue('variableName', derivedVariableName);
  }, [
    derivedVariableName,
    hasEditedVariableName,
    showVariableOptions,
    setValue,
  ]);

  const validateVariableNameField = (value: string | undefined) => {
    if (!showVariableOptions || !formIsVariableEnabled) return true;
    return validateVariableName({ value, otherFilters }) ?? true;
  };

  /**
   * Registered on the variable checkbox — the lower of the pair — so the
   * message lands under both controls rather than between them.
   *
   * Skipped when the controls are hidden: the form cannot express the invalid
   * state there (broadcast defaults on, and neither box is reachable), so all
   * an error could do is block a save the user has no way to fix.
   */
  const validateFilterModes = () => {
    if (!showVariableOptions) return true;
    return (
      hasFilterEffect({
        isBroadcastEnabled: formIsBroadCastEnabled,
        isVariableEnabled: formIsVariableEnabled,
      }) ||
      'A filter must broadcast its value, be available as a variable, or both'
    );
  };

  // The rule spans two checkboxes but its error lives on one, so react-hook-form
  // won't re-run it when the *other* box changes. Re-trigger on both.
  useEffect(() => {
    if (!showVariableOptions) return;
    void trigger('isVariableEnabled');
  }, [
    formIsBroadCastEnabled,
    formIsVariableEnabled,
    showVariableOptions,
    trigger,
  ]);

  const sourceId = useWatch({ control, name: 'source' });
  const { data: source } = useSource({
    id: sourceId,
  });

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
            const isVariableEnabled = values.isVariableEnabled === true;
            const isBroadcastEnabled = values.isBroadcastEnabled !== false;
            const trimmedVariableName = values.variableName?.trim() ?? '';
            onSave({
              ...values,
              where: trimmedWhere || undefined,
              whereLanguage: trimmedWhere
                ? (values.whereLanguage ?? 'sql')
                : undefined,
              appliesToSourceIds: appliesTo?.length ? appliesTo : undefined,
              isBroadcastEnabled,
              isVariableEnabled,
              // Dropped when the variable is disabled, so the set of variable
              // names is exactly the set of enabled filters.
              variableName: isVariableEnabled
                ? trimmedVariableName ||
                  deriveVariableName(values.name) ||
                  undefined
                : undefined,
            });
          })}
        >
          <Stack>
            <CustomInputWrapper
              label="Display name"
              error={formState.errors.name}
            >
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
                allowedSourceKinds={[
                  SourceKind.Log,
                  SourceKind.Trace,
                  SourceKind.Session,
                  SourceKind.Metric,
                ]}
              />
              <SourceSchemaPreview
                source={source}
                controlled
                open={isSourceSchemaPreviewOpen}
                onClose={() => setIsSourceSchemaPreviewOpen(false)}
              />
            </CustomInputWrapper>
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
              tooltipText="Optional condition used to filter the rows from which available filter values are queried. May reference the dashboard's other variables."
            >
              <SearchWhereInput
                tableConnection={tableConnection}
                sourceId={sourceId}
                control={control}
                name="where"
                languageName="whereLanguage"
                showLabel={false}
                allowMultiline={true}
                sqlPlaceholder="Filter for dropdown values"
                lucenePlaceholder="Filter for dropdown values"
                enableVariables={showVariableOptions}
              />
            </CustomInputWrapper>

            {showVariableOptions && (
              <>
                <Divider />
                <CheckBoxControlled
                  control={control}
                  name="isBroadcastEnabled"
                  size="xs"
                  label="Broadcast filter condition"
                  description="Automatically apply the selected value to every query builder tile, and to every Raw SQL tile that uses the $__filters macro. Optionally, narrow to tiles that use specific sources."
                  data-testid="filter-broadcast-checkbox"
                />
              </>
            )}
            {/**
             * Not available for filters on preset dashboards, always shown when showVariableOptions is disabled,
             * and shown only when the broadcast condition is enabled if showVariableOptions is enabled.
             **/}
            {!presetSource &&
              (!showVariableOptions || formIsBroadCastEnabled) && (
                <Box ml={showVariableOptions ? 'xl' : undefined}>
                  <CustomInputWrapper
                    label="Applies to sources"
                    tooltipText="Which tiles the broadcast reaches. Leave empty to broadcast to all tiles. Selecting one or more sources restricts the broadcast to tiles using those sources."
                  >
                    <SourceMultiSelectControlled
                      control={control}
                      name="appliesToSourceIds"
                      data-testid="applies-to-source-selector"
                      comboboxProps={{ withinPortal: true }}
                      placeholder="All sources"
                      allowedSourceKinds={[
                        SourceKind.Log,
                        SourceKind.Trace,
                        SourceKind.Session,
                        SourceKind.Metric,
                      ]}
                    />
                  </CustomInputWrapper>
                </Box>
              )}
            {showVariableOptions && (
              <>
                <Divider />
                <CheckBoxControlled
                  control={control}
                  name="isVariableEnabled"
                  size="xs"
                  label="Available as variable"
                  description="Expose the selected value as a $variable. Selections only affect tiles that reference the variable explicitly, typically via the $__filter or $__conditionalAll macros."
                  data-testid="filter-variable-enabled-checkbox"
                  rules={{ validate: validateFilterModes }}
                />
                {formIsVariableEnabled && (
                  <Box ml={showVariableOptions ? 'xl' : undefined}>
                    <CustomInputWrapper
                      label="Variable name"
                      tooltipText="The name by which the variable is referenced"
                      error={formState.errors.variableName}
                    >
                      <TextInput
                        placeholder={derivedVariableName || 'variable_name'}
                        data-testid="filter-variable-name-input"
                        {...register('variableName', {
                          onChange: () => setHasEditedVariableName(true),
                          validate: validateVariableNameField,
                        })}
                      />
                    </CustomInputWrapper>
                  </Box>
                )}
                {showUnscopedBroadcastWarning && (
                  <Alert
                    variant="warning"
                    icon={<IconAlertTriangle size={16} />}
                    data-testid="filter-unscoped-broadcast-warning"
                  >
                    Broadcast already applies this filter to every tile,
                    including the ones that reference the variable. Set “Applies
                    to sources” to limit which tiles the broadcast reaches, or
                    turn off broadcast so only tiles that reference the variable
                    are filtered.
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
  /** Whether the broadcast / variable controls are available. */
  showVariableOptions: boolean;
  onEdit: (filter: DashboardFilter) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onAddNew: () => void;
}

const DashboardFiltersList = ({
  filters,
  isLoading,
  hideAppliesTo,
  showVariableOptions,
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
      title={showVariableOptions ? 'Filters and Variables' : 'Filters'}
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
          const variableName =
            showVariableOptions && isFilterVariableEnabled(filter)
              ? getFilterVariableName(filter)
              : undefined;
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
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                  <Text size="xs" truncate="end">
                    {filter.name}
                    {!!variableName && ` ($${variableName})`}
                  </Text>
                </Group>
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
              {!hideAppliesTo && isFilterBroadcastEnabled(filter) && (
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
  isLoading?: boolean;
  source?: TSource;
  /** Whether to offer the broadcast / variable controls. */
  showVariableOptions: boolean;
  /** The dashboard's variables, if any */
  variables?: ChartVariable[];
  onClose: () => void;
  onSaveFilter: (filter: DashboardFilter) => void;
  onRemoveFilter: (id: string) => void;
}

const NEW_FILTER_ID = 'new';

const DashboardFiltersModal = ({
  opened,
  filters,
  isLoading,
  source,
  showVariableOptions,
  variables,
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
      isBroadcastEnabled: true,
      isVariableEnabled: false,
    });
  };

  const handleSaveFilter = (filter: DashboardFilter) => {
    setSelectedFilter(undefined);
    if (filter.id === NEW_FILTER_ID) {
      const filterWithRealId = { ...filter, id: crypto.randomUUID() };
      onSaveFilter(filterWithRealId);
    } else {
      onSaveFilter(filter);
    }
  };

  const isEmpty = !selectedFilter && filters.length === 0;

  if (!opened) {
    return null;
  } else if (isEmpty) {
    return <EmptyState onCreateFilter={handleAddNewFilter} onClose={onClose} />;
  } else if (selectedFilter) {
    return (
      <SqlVariablesProvider variables={variables}>
        <DashboardFilterEditForm
          filter={selectedFilter}
          onSave={handleSaveFilter}
          onCancel={() => setSelectedFilter(undefined)}
          onClose={onClose}
          isNew={selectedFilter.id === NEW_FILTER_ID}
          source={source}
          filters={filters}
          showVariableOptions={showVariableOptions}
        />
      </SqlVariablesProvider>
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
        showVariableOptions={showVariableOptions}
      />
    );
  }
};

export default DashboardFiltersModal;
