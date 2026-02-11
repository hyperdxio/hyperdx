import { useEffect, useState } from 'react';
import { Controller, FieldError, useForm, useWatch } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import {
  DashboardFilter,
  MetricsDataType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Center,
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
  IconFilter,
  IconInfoCircle,
  IconPencil,
  IconRefresh,
  IconStack,
  IconTrash,
} from '@tabler/icons-react';

import { SQLInlineEditorControlled } from './components/SearchInput/SQLInlineEditor';
import SourceSchemaPreview from './components/SourceSchemaPreview';
import { SourceSelectControlled } from './components/SourceSelect';
import { useSource, useSources } from './source';
import { getMetricTableName } from './utils';

import styles from '../styles/DashboardFiltersModal.module.scss';

const MODAL_SIZE = 'sm';

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
  onSave: (definition: DashboardFilter) => void;
  onClose: () => void;
  onCancel: () => void;
}

const DashboardFilterEditForm = ({
  filter,
  isNew,
  source: presetSource,
  onSave,
  onClose,
  onCancel,
}: DashboardFilterEditFormProps) => {
  const { handleSubmit, register, formState, control, reset } =
    useForm<DashboardFilter>({
      defaultValues: filter,
    });

  useEffect(() => {
    reset(filter);
  }, [filter, reset]);

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
  const metricTypes = Object.values(MetricsDataType).filter(
    type => source?.metricTables?.[type],
  );

  const [modalContentRef, setModalContentRef] = useState<HTMLElement | null>(
    null,
  );

  return (
    <Modal
      title={isNew ? 'Add filter' : 'Edit filter'}
      opened
      onClose={onClose}
      size={MODAL_SIZE}
    >
      <div ref={setModalContentRef}>
        <form onSubmit={handleSubmit(onSave)}>
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
                sourceSchemaPreview={
                  <SourceSchemaPreview source={source} variant="text" />
                }
                disabled={!!presetSource}
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
  onEdit: (filter: DashboardFilter) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onAddNew: () => void;
}

const DashboardFiltersList = ({
  filters,
  isLoading,
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
        {filters.map(filter => (
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
            <Group gap="xs">
              <IconStack size={14} />
              <Text size="xs">
                {sources?.find(s => s.id === filter.source)?.name}
              </Text>
            </Group>
          </Paper>
        ))}
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
      <DashboardFilterEditForm
        filter={selectedFilter}
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
      />
    );
  }
};

export default DashboardFiltersModal;
