import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/metadata';
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
import { DashboardParameter } from './DashboardParameters';
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
          description="The data source that the parameter values are queried from"
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
          description="SQL expression that provides allowed parameter values"
          required
        >
          <SQLInlineEditorControlled
            tableConnections={tableConnection}
            control={control}
            name="key"
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

interface DashboardParametersEditModalProps {
  opened: boolean;
  onClose: () => void;
  parameters: Record<string, DashboardParameter>;
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
  >(Object.keys(parameters)[0]);
  const [newParameter, setNewParameter] = useState<
    | (Partial<DashboardParameter> & Pick<DashboardParameter, 'id' | 'type'>)
    | null
  >(null);

  const handleRemoveParameterDefinition = (id: string) => {
    if (id === activeParameterId) {
      const paramIds = Object.keys(parameters).filter(
        paramId => paramId !== id,
      );
      setActiveParameterId(paramIds[0]);
    }
    onRemoveParameterDefinition(id);
  };

  const handleAddNewParameter = () => {
    setNewParameter({
      id: 'new',
      type: 'query',
      name: 'New Parameter',
      key: '',
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

  const parametersWithNew = {
    ...parameters,
    ...(newParameter
      ? { [newParameter.id]: newParameter as DashboardParameter }
      : {}),
  };

  const activeParameter = parametersWithNew[activeParameterId ?? ''];

  return (
    <Modal opened={opened} onClose={onClose} title="Edit Parameters" size="xl">
      {activeParameter && (
        <Flex direction="row" gap="0">
          <Paper withBorder flex={0} miw={200} pt="sm">
            <Stack gap="0">
              {Object.keys(parametersWithNew).map(id => (
                <UnstyledButton
                  key={id}
                  className="px-2 pb-1 bg-default-dark-grey-hover"
                  onClick={() => setActiveParameterId(id)}
                >
                  <Text>{parameters[id]?.name}</Text>
                </UnstyledButton>
              ))}
              <Button
                variant="subtle"
                color="gray"
                onClick={handleAddNewParameter}
              >
                Add Parameter
              </Button>
            </Stack>
          </Paper>
          <Paper withBorder p="md" flex={1}>
            <DashboardParametersEditForm
              parameter={activeParameter}
              onChangeParameterDefinition={handleSubmitParameter}
              onRemoveParameterDefinition={handleRemoveParameterDefinition}
            />
          </Paper>
        </Flex>
      )}
    </Modal>
  );
};

export default DashboardParametersEditModal;
