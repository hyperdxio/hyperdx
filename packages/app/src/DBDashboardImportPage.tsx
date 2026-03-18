import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StringParam, useQueryParam } from 'use-query-params';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { convertToDashboardDocument } from '@hyperdx/common-utils/dist/core/utils';
import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  DashboardTemplateSchema,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Collapse,
  Container,
  Group,
  Input,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconChevronRight,
  IconFile,
  IconUpload,
  IconX,
} from '@tabler/icons-react';

import { PageHeader } from './components/PageHeader';
import SelectControlled from './components/SelectControlled';
import { useBrandDisplayName } from './theme/ThemeProvider';
import { useConnections } from './connection';
import { useCreateDashboard, useUpdateDashboard } from './dashboard';
import { withAppNav } from './layout';
import { useSources } from './source';

// The schema for the JSON data we expect to receive
const InputSchema = DashboardTemplateSchema;
type Input = z.infer<typeof InputSchema>;

function FileSelection({
  onComplete,
}: {
  onComplete: (input: Input | null) => void;
}) {
  // The schema for the form data we expect to receive
  const FormSchema = z.object({ file: z.instanceof(File).nullable() });

  type FormValues = z.infer<typeof FormSchema>;

  const [error, setError] = useState<{
    message: string;
    details?: string;
  } | null>(null);
  const [errorDetails, { toggle: toggleErrorDetails }] = useDisclosure(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
  });

  const onSubmit = async ({ file }: FormValues) => {
    setError(null);
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const parsed = InputSchema.parse(data); // throws if invalid
      onComplete(parsed);
    } catch (e: any) {
      onComplete(null);
      setError({
        message: 'Failed to Import Dashboard',
        details: e?.message ?? 'Failed to parse/validate JSON',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Stack gap="sm">
        <Controller
          name="file"
          control={control}
          render={({ field }) => (
            <Dropzone
              onDrop={files => {
                field.onChange(files[0]);
                handleSubmit(onSubmit)();
              }}
              onReject={() =>
                setError({ message: 'Invalid File Type or Size' })
              }
              maxSize={5 * 1024 ** 2}
              maxFiles={1}
              accept={['application/json']}
            >
              <Group
                justify="center"
                gap="xl"
                mih={150}
                style={{ pointerEvents: 'none' }}
              >
                <Dropzone.Accept>
                  <IconUpload
                    size={52}
                    color="var(--color-text-brand)"
                    stroke={1.5}
                  />
                </Dropzone.Accept>
                <Dropzone.Reject>
                  <IconX
                    size={52}
                    color="var(--color-text-danger)"
                    stroke={1.5}
                  />
                </Dropzone.Reject>
                <Dropzone.Idle>
                  <IconFile
                    size={52}
                    color="var(--color-text-muted)"
                    stroke={1.5}
                  />
                </Dropzone.Idle>

                <div>
                  <Text size="xl" inline>
                    Import Dashboard
                  </Text>
                  <Text size="sm" c="dimmed" inline mt={7}>
                    Drag and drop a JSON file here, or click to select from your
                    computer.
                  </Text>
                </div>
              </Group>
            </Dropzone>
          )}
        />

        {error && (
          <div>
            <Text c="red">{error.message}</Text>
            {error.details && (
              <>
                <Button
                  variant="transparent"
                  onClick={toggleErrorDetails}
                  px={0}
                >
                  <Group c="red" gap={0} align="center">
                    <IconChevronRight
                      size="16px"
                      style={{
                        transition: 'transform 0.2s ease-in-out',
                        transform: errorDetails
                          ? 'rotate(90deg)'
                          : 'rotate(0deg)',
                      }}
                    />
                    {errorDetails ? 'Hide Details' : 'Show Details'}
                  </Group>
                </Button>
                <Collapse in={errorDetails}>
                  <Text c="red">{error.details}</Text>
                </Collapse>
              </>
            )}
          </div>
        )}
      </Stack>
    </form>
  );
}

const MappingForm = z.object({
  dashboardName: z.string().min(1),
  sourceMappings: z.array(z.string()),
  connectionMappings: z.array(z.string()),
  filterSourceMappings: z.array(z.string()).optional(),
});

type MappingFormValues = z.infer<typeof MappingForm>;

function Mapping({ input }: { input: Input }) {
  const router = useRouter();
  const { data: sources } = useSources();
  const { data: connections } = useConnections();
  const [dashboardId] = useQueryParam('dashboardId', StringParam);

  const { handleSubmit, getFieldState, control, setValue } =
    useForm<MappingFormValues>({
      resolver: zodResolver(MappingForm),
      defaultValues: {
        dashboardName: input.name,
        sourceMappings: input.tiles.map(() => ''),
        connectionMappings: input.tiles.map(() => ''),
      },
    });

  // When the input changes, reset the form
  useEffect(() => {
    if (!input || !sources || !connections) return;

    const sourceMappings = input.tiles.map(tile => {
      const config = tile.config as SavedChartConfig;
      if (!config.source) return '';
      const match = sources.find(
        source => source.name.toLowerCase() === config.source!.toLowerCase(),
      );
      return match?.id || '';
    });

    const connectionMappings = input.tiles.map(tile => {
      const config = tile.config as SavedChartConfig;
      if (!isRawSqlSavedChartConfig(config)) return '';
      const match = connections.find(
        conn => conn.name.toLowerCase() === config.connection.toLowerCase(),
      );
      return match?.id || '';
    });

    const filterSourceMappings = input.filters?.map(filter => {
      const match = sources.find(
        source => source.name.toLowerCase() === filter.source.toLowerCase(),
      );
      return match?.id || '';
    });

    setValue('sourceMappings', sourceMappings);
    setValue('connectionMappings', connectionMappings);
    setValue('filterSourceMappings', filterSourceMappings);
  }, [setValue, sources, connections, input]);

  const isUpdatingRef = useRef(false);
  const sourceMappings = useWatch({ control, name: 'sourceMappings' });
  const connectionMappings = useWatch({ control, name: 'connectionMappings' });
  const prevSourceMappingsRef = useRef(sourceMappings);
  const prevConnectionMappingsRef = useRef(connectionMappings);

  // Propagate source mapping changes to other tiles/filters with the same input source
  useEffect(() => {
    if (isUpdatingRef.current) return;
    if (!sourceMappings || !input.tiles) return;

    const changedIdx = sourceMappings.findIndex(
      (mapping, idx) => mapping !== prevSourceMappingsRef.current?.[idx],
    );
    if (changedIdx === -1) return;

    prevSourceMappingsRef.current = sourceMappings;

    const inputTile = input.tiles[changedIdx];
    const inputTileConfig = inputTile?.config;
    if (!inputTileConfig || !inputTileConfig.source) return;

    const sourceId = sourceMappings[changedIdx] ?? '';
    const inputTileSource = inputTileConfig.source;

    const keysForTilesWithMatchingSource = input.tiles
      .map((tile, index) => ({ config: tile.config, index }))
      .filter(tile => tile.config.source === inputTileSource)
      .map(({ index }) => `sourceMappings.${index}` as const);

    const keysForFiltersWithMatchingSource =
      input.filters
        ?.map((filter, index) => ({ ...filter, index }))
        .filter(f => f.source === inputTileSource)
        .map(({ index }) => `filterSourceMappings.${index}` as const) ?? [];

    isUpdatingRef.current = true;
    for (const key of [
      ...keysForTilesWithMatchingSource,
      ...keysForFiltersWithMatchingSource,
    ]) {
      if (!getFieldState(key).isDirty) {
        setValue(key, sourceId, { shouldValidate: true });
      }
    }
    isUpdatingRef.current = false;
  }, [sourceMappings, input.tiles, input.filters, getFieldState, setValue]);

  // Propagate connection mapping changes to other RawSQL tiles with the same input connection
  useEffect(() => {
    if (isUpdatingRef.current) return;
    if (!connectionMappings || !input.tiles) return;

    const changedIdx = connectionMappings.findIndex(
      (mapping, idx) => mapping !== prevConnectionMappingsRef.current?.[idx],
    );
    if (changedIdx === -1) return;

    prevConnectionMappingsRef.current = connectionMappings;

    const inputTile = input.tiles[changedIdx];
    const inputTileConfig = inputTile?.config as SavedChartConfig | undefined;
    if (!inputTileConfig || !isRawSqlSavedChartConfig(inputTileConfig)) return;

    const connectionId = connectionMappings[changedIdx] ?? '';
    const inputTileConnection = inputTileConfig.connection;

    const keysForTilesWithMatchingConnection = input.tiles
      .map((tile, index) => ({
        config: tile.config as SavedChartConfig,
        index,
      }))
      .filter(
        tile =>
          isRawSqlSavedChartConfig(tile.config) &&
          tile.config.connection === inputTileConnection,
      )
      .map(({ index }) => `connectionMappings.${index}` as const);

    isUpdatingRef.current = true;
    for (const key of keysForTilesWithMatchingConnection) {
      if (!getFieldState(key).isDirty) {
        setValue(key, connectionId, { shouldValidate: true });
      }
    }
    isUpdatingRef.current = false;
  }, [connectionMappings, input.tiles, getFieldState, setValue]);

  const createDashboard = useCreateDashboard();
  const updateDashboard = useUpdateDashboard();

  const onSubmit = async (data: MappingFormValues) => {
    try {
      // Zip the source/connection mappings with the input tiles
      const zippedTiles = input.tiles.map((tile, idx) => {
        const source = sources?.find(
          source => source.id === data.sourceMappings[idx],
        );

        if (isRawSqlSavedChartConfig(tile.config)) {
          const connection = connections?.find(
            conn => conn.id === data.connectionMappings[idx],
          );
          return {
            ...tile,
            config: {
              ...tile.config,
              connection: connection!.id,
              ...(source ? { source: source.id } : {}),
            },
          };
        }
        return {
          ...tile,
          config: {
            ...tile.config,
            source: source!.id,
          },
        };
      });
      // Zip the source mappings with the input filters
      const zippedFilters = input.filters?.map((filter, idx) => {
        const source = sources?.find(
          source => source.id === data.filterSourceMappings?.[idx],
        );
        return {
          ...filter,
          source: source!.id,
        };
      });
      // Format for server
      const output = convertToDashboardDocument({
        ...input,
        tiles: zippedTiles,
        filters: zippedFilters,
        name: data.dashboardName,
      });
      let _dashboardId = dashboardId;
      if (_dashboardId) {
        await updateDashboard.mutateAsync({
          ...output,
          id: _dashboardId,
        });
      } else {
        const result = await createDashboard.mutateAsync(output);
        _dashboardId = result.id;
      }
      // Redirect
      notifications.show({
        color: 'green',
        message: 'Import Successful!',
      });
      router.push(`/dashboards/${_dashboardId}`);
    } catch {
      notifications.show({
        color: 'red',
        message: 'Something went wrong. Please try again.',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Stack gap="sm">
        <Text fw={500} size="sm">
          Step 2: Map Data
        </Text>
        <Controller
          name="dashboardName"
          control={control}
          render={({ field, formState }) => (
            <TextInput
              label="Dashboard Name"
              {...field}
              error={formState.errors.dashboardName?.message}
            />
          )}
        />
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Input Source</Table.Th>
              <Table.Th>Mapped Source</Table.Th>
              <Table.Th>Input Connection</Table.Th>
              <Table.Th>Mapped Connection</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {input.tiles.map((tile, i) => {
              const config = tile.config;
              const isRawSql = isRawSqlSavedChartConfig(config);
              return (
                <Table.Tr key={tile.id}>
                  <Table.Td>{tile.config.name}</Table.Td>

                  <Table.Td>{config.source ?? ''}</Table.Td>
                  <Table.Td>
                    {config.source != null && (
                      <SelectControlled
                        control={control}
                        name={`sourceMappings.${i}`}
                        data={sources?.map(source => ({
                          value: source.id,
                          label: source.name,
                        }))}
                        placeholder="Select a source"
                      />
                    )}
                  </Table.Td>
                  <Table.Td>{isRawSql ? config.connection : ''}</Table.Td>
                  <Table.Td>
                    {isRawSql ? (
                      <SelectControlled
                        control={control}
                        name={`connectionMappings.${i}`}
                        data={connections?.map(conn => ({
                          value: conn.id,
                          label: conn.name,
                        }))}
                        placeholder="Select a connection"
                      />
                    ) : null}
                  </Table.Td>
                </Table.Tr>
              );
            })}
            {input.filters?.map((filter, i) => (
              <Table.Tr key={filter.id}>
                <Table.Td>{filter.name} (filter)</Table.Td>
                <Table.Td>{filter.source}</Table.Td>
                <Table.Td>
                  <SelectControlled
                    control={control}
                    name={`filterSourceMappings.${i}`}
                    data={sources?.map(source => ({
                      value: source.id,
                      label: source.name,
                    }))}
                    placeholder="Select a source"
                  />
                </Table.Td>
                <Table.Td />
                <Table.Td />
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {createDashboard.isError && (
          <Text c="red">{createDashboard.error.toString()}</Text>
        )}
        <Button type="submit" loading={createDashboard.isPending}>
          Finish Import
        </Button>
      </Stack>
    </form>
  );
}

function DBDashboardImportPage() {
  const brandName = useBrandDisplayName();
  const [input, setInput] = useState<Input | null>(null);

  return (
    <div>
      <Head>
        <title>Create a Dashboard - {brandName}</title>
      </Head>
      <PageHeader>
        <div>Create Dashboard &gt; Import Dashboard</div>
      </PageHeader>
      <div>
        <Container>
          <Stack gap="lg" mt="xl">
            <FileSelection
              onComplete={i => {
                setInput(i);
              }}
            />
            {input && <Mapping input={input} />}
          </Stack>
        </Container>
      </div>
    </div>
  );
}

const DBDashboardImportPageDynamic = dynamic(
  async () => DBDashboardImportPage,
  {
    ssr: false,
  },
);

// @ts-ignore
DBDashboardImportPageDynamic.getLayout = withAppNav;

export default DBDashboardImportPageDynamic;
