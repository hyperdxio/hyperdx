import { useEffect, useState } from 'react';
import { Controller, FieldError, useForm } from 'react-hook-form';
import {
  TableConnection,
  tcFromSource,
} from '@hyperdx/common-utils/dist/metadata';
import {
  DashboardFilter,
  MetricsDataType,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import {
  Button,
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
import { IconFilter, IconPencil, IconTrash } from '@tabler/icons-react';

import SourceSchemaPreview from './components/SourceSchemaPreview';
import { SourceSelectControlled } from './components/SourceSelect';
import { SQLInlineEditorControlled } from './components/SQLInlineEditor';
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
          <i className="bi bi-info-circle ms-2" />
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
  onSave: (definition: DashboardFilter) => void;
  onClose: () => void;
  onCancel: () => void;
}

const DashboardFilterEditForm = ({
  filter,
  isNew,
  onSave,
  onClose,
  onCancel,
}: DashboardFilterEditFormProps) => {
  const { handleSubmit, register, formState, control, watch, reset } =
    useForm<DashboardFilter>({
      defaultValues: filter,
    });

  useEffect(() => {
    reset(filter);
  }, [filter, reset]);

  const sourceId = watch('source');
  const { data: source } = useSource({ id: sourceId });

  const metricType = watch('sourceMetricType');
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
    type => source?.kind === SourceKind.Metric && source?.metricTables?.[type],
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
                  <SourceSchemaPreview
                    tableConnection={tcFromSource(source)}
                    variant="text"
                  />
                }
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

            <Group justify="flex-end" my="xs">
              <Button variant="outline" color="gray.2" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit">Save filter</Button>
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
      <Stack align="center" justify="center" pt="lg" pb="xl">
        <IconFilter />
        <Title order={4}>No filters yet.</Title>
        <Text size="sm" ta="center" px="xl">
          Add filters to let users quickly narrow data on key columns. Saved
          filters will stay with this dashboard.
        </Text>
        <Button variant="outline" color="gray.2" onClick={onCreateFilter}>
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
      <Stack className={styles.filtersContainer} gap="xs">
        {filters.map(filter => (
          <Paper
            key={filter.id}
            withBorder
            bg={'dark.5'}
            className={styles.filterPaper}
            p="xs"
          >
            <Group justify="space-between" className={styles.filterHeader}>
              <Text size="xs">{filter.name}</Text>
              <Group>
                <UnstyledButton
                  onClick={() => onEdit(filter)}
                  className={styles.filterActionButton}
                >
                  <IconPencil size={16} />
                </UnstyledButton>
                <UnstyledButton
                  onClick={() => onRemove(filter.id)}
                  className={`${styles.filterActionButton} ${styles.deleteButton}`}
                >
                  <IconTrash size={16} />
                </UnstyledButton>
              </Group>
            </Group>
            <Group gap="xs">
              <i className="bi bi-collection"></i>
              <Text size="xs">
                {sources?.find(s => s.id === filter.source)?.name}
              </Text>
            </Group>
          </Paper>
        ))}
        {isLoading && (
          <div
            className="spinner-border mx-auto"
            style={{ width: 14, height: 14 }}
          />
        )}
      </Stack>

      <Group justify="center" my="sm">
        <Button variant="outline" color="gray.2" onClick={onAddNew}>
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
  onClose: () => void;
  onSaveFilter: (filter: DashboardFilter) => void;
  onRemoveFilter: (id: string) => void;
}

const NEW_FILTER_ID = 'new';

const DashboardFiltersModal = ({
  opened,
  filters,
  isLoading,
  onClose,
  onSaveFilter,
  onRemoveFilter,
}: DashboardFiltersEditModalProps) => {
  const [selectedFilter, setSelectedFilter] = useState<DashboardFilter>();

  useEffect(() => {
    if (opened) {
      setSelectedFilter(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      source: '',
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
