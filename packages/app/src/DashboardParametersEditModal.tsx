import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/metadata';
import { DashboardParameter } from '@hyperdx/common-utils/dist/types';
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

interface DashboardParametersEditFormProps {
  parameter: DashboardParameter;
  onChangeParameterDefinition: (definition: DashboardParameter) => void;
  onRemoveParameterDefinition: (id: string) => void;
}

const DashboardParametersEditForm = ({
  parameter,
  onChangeParameterDefinition,
  onRemoveParameterDefinition,
}: DashboardParametersEditFormProps) => {
  const { handleSubmit, register, formState, control, watch, reset } =
    useForm<DashboardParameter>({
      defaultValues: parameter,
    });

  useEffect(() => {
    reset(parameter);
  }, [parameter, reset]);

  const onSubmit = (data: DashboardParameter) => {
    onChangeParameterDefinition(data);
  };

  const sourceId = watch('sourceId');
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
          placeholder={parameter.name}
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
                name="sourceId"
                data-testid="source-selector"
                rules={{ required: true }}
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
          />
        </Input.Wrapper>
        <Group justify="space-between" mt="md">
          <Button
            variant="outline"
            color="red"
            onClick={() => onRemoveParameterDefinition(parameter.id)}
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
  onCreateFirstParameter: () => void;
}

const EmptyState = ({ onCreateFirstParameter }: EmptyStateProps) => {
  return (
    <Stack align="center" justify="center" py="xl">
      <Text size="md" maw={300} ta="center">
        Dashboard filters allow users of this dashboard to quickly filter on
        important columns.
      </Text>
      <Button variant="outline" onClick={onCreateFirstParameter}>
        Create Filter
      </Button>
    </Stack>
  );
};
interface DashboardParametersEditModalProps {
  opened: boolean;
  onClose: () => void;
  parameters: DashboardParameter[];
  onChangeParameterDefinition: (definition: DashboardParameter) => void;
  onRemoveParameterDefinition: (id: string) => void;
}

const DashboardParametersEditModal = ({
  opened,
  onClose,
  parameters,
  onChangeParameterDefinition,
  onRemoveParameterDefinition,
}: DashboardParametersEditModalProps) => {
  const [activeParameterId, setActiveParameterId] = useState<
    string | undefined
  >(parameters[0]?.id);
  const [newParameter, setNewParameter] = useState<
    | (Partial<DashboardParameter> & Pick<DashboardParameter, 'id' | 'type'>)
    | null
  >(null);

  useEffect(() => {
    if (opened) {
      setActiveParameterId(parameters[0]?.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const handleRemoveParameterDefinition = (id: string) => {
    if (id === activeParameterId) {
      setActiveParameterId(parameters[0]?.id);
    }
    if (id === 'new') {
      setNewParameter(null);
    }
    onRemoveParameterDefinition(id);
  };

  const handleAddNewParameter = () => {
    setNewParameter({
      id: 'new',
      type: 'QUERY_EXPRESSION',
      name: 'New Parameter',
      expression: '',
      sourceId: '',
    });
    setActiveParameterId('new');
  };

  const handleSubmitParameter = (parameter: DashboardParameter) => {
    if (newParameter && parameter.id === 'new') {
      // Assign a unique ID to the new parameter TODO how to just use the mongo ID?
      const uniqueId = `param-${Date.now()}`;
      onChangeParameterDefinition({ ...parameter, id: uniqueId });
      setActiveParameterId(uniqueId);
      setNewParameter(null);
    } else {
      onChangeParameterDefinition(parameter);
    }
  };

  const handleClose = () => {
    setNewParameter(null);
    onClose();
  };

  const parametersWithNew = [
    ...parameters,
    ...(newParameter ? [newParameter as DashboardParameter] : []),
  ];

  const activeParameter = parametersWithNew.find(
    param => param.id === activeParameterId,
  );

  return (
    <Modal opened={opened} onClose={handleClose} title="Filters" size="xl">
      {parametersWithNew.length === 0 ? (
        <EmptyState onCreateFirstParameter={handleAddNewParameter} />
      ) : (
        <Flex direction="row" gap="0">
          <Paper withBorder flex={0} miw={200} pt="sm">
            <Stack gap="0">
              {parametersWithNew.map(({ id, name }) => (
                <UnstyledButton
                  key={id}
                  className="px-2 pb-1 bg-default-dark-grey-hover"
                  onClick={() => setActiveParameterId(id)}
                >
                  <Text>{name}</Text>
                </UnstyledButton>
              ))}
              <Button
                variant="subtle"
                color="gray"
                onClick={handleAddNewParameter}
              >
                Add Filter
              </Button>
            </Stack>
          </Paper>
          <Paper withBorder p="md" flex={1}>
            {activeParameter && (
              <DashboardParametersEditForm
                parameter={activeParameter}
                onChangeParameterDefinition={handleSubmitParameter}
                onRemoveParameterDefinition={handleRemoveParameterDefinition}
              />
            )}
          </Paper>
        </Flex>
      )}
    </Modal>
  );
};

export default DashboardParametersEditModal;
