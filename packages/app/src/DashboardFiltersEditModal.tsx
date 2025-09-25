import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/metadata';
import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Flex,
  Group,
  Input,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';

import SourceSchemaPreview from './components/SourceSchemaPreview';
import { SourceSelectControlled } from './components/SourceSelect';
import { SQLInlineEditorControlled } from './components/SQLInlineEditor';
import { useSource } from './source';

interface DashboardFilterEditFormProps {
  filter: DashboardFilter;
  onSaveFilter: (definition: DashboardFilter) => void;
  onRemoveFilter: (id: string) => void;
  parentRef?: HTMLElement | null;
}

const DashboardFilterEditForm = ({
  filter,
  onSaveFilter,
  onRemoveFilter,
  parentRef,
}: DashboardFilterEditFormProps) => {
  const { handleSubmit, register, formState, control, watch, reset } =
    useForm<DashboardFilter>({
      defaultValues: filter,
    });

  useEffect(() => {
    reset(filter);
  }, [filter, reset]);

  const onSubmit = (data: DashboardFilter) => {
    onSaveFilter(data);
  };

  const sourceId = watch('source');
  const { data: source } = useSource({ id: sourceId });
  const tableConnection: TableConnection | undefined = source
    ? {
        connectionId: source.connection,
        ...source.from,
      }
    : undefined;

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Stack>
        <TextInput
          label="Name"
          placeholder={filter.name}
          required
          error={formState.errors.name?.message}
          {...register('name', { required: true, minLength: 1 })}
        />
        <Input.Wrapper
          label="Data Source"
          description="The data source that the filter values are queried from"
          required
        >
          <Group>
            <span className="flex-grow-1">
              <SourceSelectControlled
                control={control}
                name="source"
                data-testid="source-selector"
                rules={{ required: true }}
                comboboxProps={{ withinPortal: true }}
              />
            </span>
            <span className="me-2">
              <SourceSchemaPreview
                source={source}
                iconStyles={{ color: 'dark.2' }}
              />
            </span>
          </Group>
        </Input.Wrapper>
        <Input.Wrapper
          label="Filter Expression"
          description="SQL column or expression to filter on"
          required
        >
          <SQLInlineEditorControlled
            tableConnections={tableConnection}
            control={control}
            name="expression"
            placeholder="SQL column or expression"
            language="sql"
            enableHotkey
            rules={{ required: true }}
            parentRef={parentRef}
          />
        </Input.Wrapper>
        <Group justify="space-between" mt="md">
          <Button
            variant="outline"
            color="red"
            onClick={() => onRemoveFilter(filter.id)}
          >
            Delete
          </Button>
          <Button type="submit" className="align-self-end">
            Save
          </Button>
        </Group>
      </Stack>
    </form>
  );
};

interface EmptyStateProps {
  onCreateFilter: () => void;
}

const EmptyState = ({ onCreateFilter }: EmptyStateProps) => {
  return (
    <Stack align="center" justify="center" py="xl">
      <Text size="md" maw={300} ta="center">
        Dashboard filters allow users of this dashboard to quickly filter on
        important columns. Filters are saved in the dashboard.
      </Text>
      <Button variant="outline" onClick={onCreateFilter}>
        Create Filter
      </Button>
    </Stack>
  );
};
interface DashboardFiltersEditModalProps {
  opened: boolean;
  onClose: () => void;
  filters: DashboardFilter[];
  onSaveFilter: (filter: DashboardFilter) => void;
  onRemoveFilter: (id: string) => void;
  parentRef?: HTMLElement | null;
}

const NEW_FILTER_ID = 'new';

const DashboardFiltersEditModal = ({
  opened,
  onClose,
  filters,
  onSaveFilter,
  onRemoveFilter,
}: DashboardFiltersEditModalProps) => {
  const [selectedFilter, setSelectedFilter] = useState<
    DashboardFilter | undefined
  >(filters[0]);

  useEffect(() => {
    if (opened) {
      setSelectedFilter(filters[0]);
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
      name: 'New Filter',
      expression: '',
      source: '',
    });
  };

  const handleSaveFilter = (filter: DashboardFilter) => {
    if (filter.id === NEW_FILTER_ID) {
      const filterWithRealId = { ...filter, id: crypto.randomUUID() };
      onSaveFilter(filterWithRealId);
      setSelectedFilter(filterWithRealId);
    } else {
      onSaveFilter(filter);
    }
  };

  const [modalContentRef, setModalContentRef] = useState<HTMLElement | null>(
    null,
  );

  return (
    <Modal opened={opened} onClose={onClose} title="Filters" size="xl">
      {!selectedFilter && filters.length === 0 ? (
        <EmptyState onCreateFilter={handleAddNewFilter} />
      ) : (
        <div ref={setModalContentRef}>
          <Flex direction="row" gap="0">
            <Paper withBorder flex={0} miw={200} pt="sm">
              <Stack gap="0">
                {filters.map(filter => (
                  <UnstyledButton
                    key={filter.id}
                    className="px-2 pb-1 bg-default-dark-grey-hover"
                    onClick={() => setSelectedFilter(filter)}
                  >
                    <Text>{filter.name}</Text>
                  </UnstyledButton>
                ))}
                <Button
                  variant="subtle"
                  color="gray"
                  onClick={handleAddNewFilter}
                >
                  Add Filter
                </Button>
              </Stack>
            </Paper>
            <Paper withBorder p="md" flex={1}>
              {selectedFilter && (
                <DashboardFilterEditForm
                  filter={selectedFilter}
                  onSaveFilter={handleSaveFilter}
                  onRemoveFilter={handleRemoveFilter}
                  parentRef={modalContentRef}
                />
              )}
            </Paper>
          </Flex>
        </div>
      )}
    </Modal>
  );
};

export default DashboardFiltersEditModal;
