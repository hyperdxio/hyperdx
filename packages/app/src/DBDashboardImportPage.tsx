import {
  Fragment,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { parseAsString, useQueryState } from 'nuqs';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { convertToDashboardDocument } from '@hyperdx/common-utils/dist/core/utils';
import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  type DashboardTemplate,
  DashboardTemplateSchema,
  isLogSource,
  isOnClickDashboardById,
  isOnClickSearchById,
  isTraceSource,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Breadcrumbs,
  Button,
  Collapse,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  TagsInput,
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

import SelectControlled from './components/SelectControlled';
import { useBrandDisplayName } from './theme/ThemeProvider';
import api from './api';
import { useConnections } from './connection';
import {
  useCreateDashboard,
  useDashboards,
  useUpdateDashboard,
} from './dashboard';
import { getDashboardTemplate } from './dashboardTemplates';
import { withAppNav } from './layout';
import { useSources } from './source';

function FileSelection({
  onComplete,
}: {
  onComplete: (input: DashboardTemplate | null) => void;
}) {
  // The schema for the form data we expect to receive
  const FormSchema = z.object({ file: z.instanceof(File).nullable() });

  type FormValues = z.infer<typeof FormSchema>;

  const [error, setError] = useState<{
    message: string;
    details?: ReactNode;
  } | null>(null);
  const [errorDetails, { toggle: toggleErrorDetails }] = useDisclosure(false);

  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
  });

  const onSubmit = async ({ file }: FormValues) => {
    setError(null);
    if (!file) return;

    let data: unknown;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch (e: unknown) {
      onComplete(null);
      setError({
        message: 'Invalid JSON File',
        details: e instanceof Error ? e.message : 'Failed to parse JSON',
      });
      return;
    }

    const result = DashboardTemplateSchema.safeParse(data);
    if (!result.success) {
      onComplete(null);
      setError({
        message: 'Failed to Import Dashboard',
        details: (
          <Stack gap={0}>
            {result.error.issues.map(issue => (
              <Text key={`${issue.path.join('.')}:${issue.message}`} c="red">
                {issue.message}
              </Text>
            ))}
          </Stack>
        ),
      });
      return;
    }

    onComplete(result.data);
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
            {error.details != null && (
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
                <Collapse expanded={errorDetails}>{error.details}</Collapse>
              </>
            )}
          </div>
        )}
      </Stack>
    </form>
  );
}

const MappingFormStateSchema = z.object({
  dashboardName: z.string().min(1),
  tags: z.array(z.string()),
  /** A list of tile source mappings, ordered by input tile index */
  tileSourceMappings: z.array(z.string()),
  /** A list of tile connection mappings, ordered by input tile index. Only applicable for RawSQL tiles */
  connectionMappings: z.array(z.string()),
  /** A list of filter source mappings, ordered by input filter index */
  filterSourceMappings: z.array(z.string()).optional(),
  /** A list of onClick source mappings, ordered by input tile index */
  onClickSourceMappings: z.array(z.string()).optional(),
  /** A list of onClick dashboard mappings, ordered by input tile index */
  onClickDashboardMappings: z.array(z.string()).optional(),
});

type MappingFormState = z.infer<typeof MappingFormStateSchema>;

function Mapping({ input }: { input: DashboardTemplate }) {
  const router = useRouter();
  const { data: sources } = useSources();
  const { data: connections } = useConnections();
  const { data: dashboards } = useDashboards();
  const { data: existingTags } = api.useTags();
  const [dashboardId] = useQueryState('dashboardId', parseAsString);

  const { handleSubmit, getFieldState, control, setValue } =
    useForm<MappingFormState>({
      resolver: zodResolver(MappingFormStateSchema),
      defaultValues: {
        dashboardName: input.name,
        tags: input.tags ?? [],
        tileSourceMappings: input.tiles.map(() => ''),
        connectionMappings: input.tiles.map(() => ''),
        filterSourceMappings: input.filters?.map(() => '') ?? [],
        onClickSourceMappings: input.tiles.map(() => ''),
        onClickDashboardMappings: input.tiles.map(() => ''),
      },
    });

  // When the input changes, reset the form
  useEffect(() => {
    if (!input || !sources || !connections || !dashboards) return;

    const tileSourceMappings = input.tiles.map(tile => {
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

    // onClick targets in a template carry the source/dashboard *name* in
    // target.id (see convertToDashboardTemplate). Map those names back to
    // the corresponding id in the current workspace. Template-mode targets
    // and non-matching types yield ''.
    const onClickSourceMappings = input.tiles.map(tile => {
      const config = tile.config as SavedChartConfig;
      const onClick = config.onClick;
      if (!isOnClickSearchById(onClick)) return '';
      const targetName = onClick.target.id.toLowerCase();
      const match = sources.find(
        source => source.name.toLowerCase() === targetName,
      );
      return match?.id || '';
    });

    const onClickDashboardMappings = input.tiles.map(tile => {
      const config = tile.config as SavedChartConfig;
      const onClick = config.onClick;
      if (!isOnClickDashboardById(onClick)) return '';
      const targetName = onClick.target.id.toLowerCase();
      const match = dashboards.find(d => d.name.toLowerCase() === targetName);
      return match?.id || '';
    });

    setValue('tileSourceMappings', tileSourceMappings);
    setValue('connectionMappings', connectionMappings);
    setValue('filterSourceMappings', filterSourceMappings);
    setValue('onClickSourceMappings', onClickSourceMappings);
    setValue('onClickDashboardMappings', onClickDashboardMappings);
  }, [setValue, sources, connections, dashboards, input]);

  const isUpdatingRef = useRef(false);
  const tileSourceMappings = useWatch({ control, name: 'tileSourceMappings' });
  const filterSourceMappings = useWatch({
    control,
    name: 'filterSourceMappings',
  });
  const onClickSourceMappings = useWatch({
    control,
    name: 'onClickSourceMappings',
  });
  const connectionMappings = useWatch({ control, name: 'connectionMappings' });
  const onClickDashboardMappings = useWatch({
    control,
    name: 'onClickDashboardMappings',
  });
  const prevSourceMappingsRef = useRef(tileSourceMappings);
  const prevFilterSourceMappingsRef = useRef(filterSourceMappings);
  const prevOnClickSourceMappingsRef = useRef(onClickSourceMappings);
  const prevConnectionMappingsRef = useRef(connectionMappings);
  const prevOnClickDashboardMappingsRef = useRef(onClickDashboardMappings);

  // Propagate source mapping changes to other tiles/filters/onClicks with the
  // same input source. Triggers whenever any of tileSourceMappings,
  // filterSourceMappings, or onClickSourceMappings changes — whichever array
  // the user edited tells us which input entry's source name was remapped.
  useEffect(() => {
    if (isUpdatingRef.current) return;
    if (!input.tiles) return;

    let inputSourceName: string | undefined;
    let selectedSourceId = '';

    // Find the changed tile source mapping, if any
    if (tileSourceMappings) {
      const idx = tileSourceMappings.findIndex(
        (mapping, i) => mapping !== prevSourceMappingsRef.current?.[i],
      );
      if (idx !== -1) {
        prevSourceMappingsRef.current = tileSourceMappings;
        inputSourceName = input.tiles[idx]?.config.source;
        selectedSourceId = tileSourceMappings[idx] ?? '';
      }
    }

    // If no tile source mapping was changed, check the filter source mappings for changes
    if (inputSourceName == null && filterSourceMappings) {
      const idx = filterSourceMappings.findIndex(
        (mapping, i) => mapping !== prevFilterSourceMappingsRef.current?.[i],
      );
      if (idx !== -1) {
        prevFilterSourceMappingsRef.current = filterSourceMappings;
        inputSourceName = input.filters?.[idx]?.source;
        selectedSourceId = filterSourceMappings[idx] ?? '';
      }
    }

    // If no filter source mapping was changed, check the onClick source mappings for changes
    if (inputSourceName == null && onClickSourceMappings) {
      const idx = onClickSourceMappings.findIndex(
        (mapping, i) => mapping !== prevOnClickSourceMappingsRef.current?.[i],
      );
      if (idx !== -1) {
        prevOnClickSourceMappingsRef.current = onClickSourceMappings;
        const onClick = input.tiles[idx]?.config?.onClick;
        if (isOnClickSearchById(onClick)) {
          inputSourceName = onClick.target.id;
          selectedSourceId = onClickSourceMappings[idx] ?? '';
        }
      }
    }

    if (!inputSourceName) return;

    const keysForTilesWithMatchingSource = input.tiles
      .map((tile, index) => ({ config: tile.config, index }))
      .filter(tile => tile.config.source === inputSourceName)
      .map(({ index }) => `tileSourceMappings.${index}` as const);

    const keysForFiltersWithMatchingSource =
      input.filters
        ?.map((filter, index) => ({ ...filter, index }))
        .filter(f => f.source === inputSourceName)
        .map(({ index }) => `filterSourceMappings.${index}` as const) ?? [];

    const keysForOnClicksWithMatchingSource = input.tiles
      .map((tile, index) => ({
        config: tile.config as SavedChartConfig,
        index,
      }))
      .filter(({ config }) => {
        const onClick = config.onClick;
        return (
          isOnClickSearchById(onClick) && onClick.target.id === inputSourceName
        );
      })
      .map(({ index }) => `onClickSourceMappings.${index}` as const);

    isUpdatingRef.current = true;
    for (const key of [
      ...keysForTilesWithMatchingSource,
      ...keysForFiltersWithMatchingSource,
      ...keysForOnClicksWithMatchingSource,
    ]) {
      if (!getFieldState(key).isDirty) {
        setValue(key, selectedSourceId, { shouldValidate: true });
      }
    }
    isUpdatingRef.current = false;
  }, [
    tileSourceMappings,
    filterSourceMappings,
    onClickSourceMappings,
    input.tiles,
    input.filters,
    getFieldState,
    setValue,
  ]);

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

  // Propagate dashboard mapping changes to other tiles whose onClick targets
  // the same input dashboard. Dashboard-type onClicks in a template store the
  // target dashboard *name* in target.id (see convertToDashboardTemplate).
  useEffect(() => {
    if (isUpdatingRef.current) return;
    if (!onClickDashboardMappings || !input.tiles) return;

    const changedIdx = onClickDashboardMappings.findIndex(
      (mapping, idx) =>
        mapping !== prevOnClickDashboardMappingsRef.current?.[idx],
    );
    if (changedIdx === -1) return;

    prevOnClickDashboardMappingsRef.current = onClickDashboardMappings;

    const inputTile = input.tiles[changedIdx];
    const inputTileConfig = inputTile?.config as SavedChartConfig | undefined;
    const inputTileOnClick = inputTileConfig?.onClick;
    if (!isOnClickDashboardById(inputTileOnClick)) {
      return;
    }

    const dashboardId = onClickDashboardMappings[changedIdx] ?? '';
    const inputTileDashboardName = inputTileOnClick.target.id;

    const keysForOnClicksWithMatchingDashboard = input.tiles
      .map((tile, index) => ({
        config: tile.config as SavedChartConfig,
        index,
      }))
      .filter(({ config }) => {
        const onClick = config.onClick;
        return (
          isOnClickDashboardById(onClick) &&
          onClick.target.id === inputTileDashboardName
        );
      })
      .map(({ index }) => `onClickDashboardMappings.${index}` as const);

    isUpdatingRef.current = true;
    for (const key of keysForOnClicksWithMatchingDashboard) {
      if (!getFieldState(key).isDirty) {
        setValue(key, dashboardId, { shouldValidate: true });
      }
    }
    isUpdatingRef.current = false;
  }, [onClickDashboardMappings, input.tiles, getFieldState, setValue]);

  const createDashboard = useCreateDashboard();
  const updateDashboard = useUpdateDashboard();

  const onSubmit = async (data: MappingFormState) => {
    try {
      const findSource = (id: string | undefined) =>
        id ? sources?.find(s => s.id === id) : undefined;
      const findConnection = (id: string | undefined) =>
        id ? connections?.find(c => c.id === id) : undefined;

      // Zip the mappings with the input tiles
      const zippedTiles = input.tiles.map((tile, idx) => {
        const source = findSource(data.tileSourceMappings[idx]);

        const inputOnClick = tile.config.onClick;
        const applyOnClick = (config: SavedChartConfig): SavedChartConfig => {
          if (!inputOnClick || inputOnClick.target.mode !== 'id') return config;
          const mappedId =
            inputOnClick.type === 'search'
              ? data.onClickSourceMappings?.[idx]
              : data.onClickDashboardMappings?.[idx];

          // Drop the onClick if it has not been mapped
          if (!mappedId) return { ...config, onClick: undefined };

          return {
            ...config,
            onClick: {
              ...inputOnClick,
              target: { mode: 'id' as const, id: mappedId },
            },
          };
        };

        if (isRawSqlSavedChartConfig(tile.config)) {
          const connection = findConnection(data.connectionMappings[idx]);
          return {
            ...tile,
            config: applyOnClick({
              ...tile.config,
              connection: connection!.id,
              ...(source ? { source: source.id } : {}),
            }),
          };
        }
        return {
          ...tile,
          config: applyOnClick({
            ...tile.config,
            source: source!.id,
          }),
        };
      });

      // Zip the source mappings with the input filters
      const zippedFilters = input.filters?.map((filter, idx) => {
        const source = findSource(data.filterSourceMappings?.[idx]);
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
        tags: data.tags,
      });

      // Replace the dashboard if dashboardId is present in query params, otherwise create a new one
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

      // Redirect to the new/updated dashboard
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
        <Controller
          name="tags"
          control={control}
          render={({ field }) => (
            <TagsInput
              label="Tags"
              placeholder="Add tags"
              data={existingTags?.data ?? []}
              {...field}
            />
          )}
        />
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Tile / Filter</Table.Th>
              <Table.Th>Mapping Type</Table.Th>
              <Table.Th>From</Table.Th>
              <Table.Th>To</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {/** Map tile sources, connections, and tile OnClick sources and dashboards */}
            {input.tiles.map((tile, i) => {
              const config = tile.config;
              const isRawSql = isRawSqlSavedChartConfig(config);
              return (
                <Fragment key={tile.id}>
                  {/** Mapping for the tile's source, if one exists (they're optional for raw sql tiles) */}
                  {tile.config.source && (
                    <Table.Tr>
                      <Table.Td>{tile.config.name}</Table.Td>
                      <Table.Td>Data Source</Table.Td>
                      <Table.Td>{config.source ?? ''}</Table.Td>
                      <Table.Td>
                        <SelectControlled
                          control={control}
                          name={`tileSourceMappings.${i}`}
                          data={sources?.map(source => ({
                            value: source.id,
                            label: source.name,
                          }))}
                          placeholder="Select a source"
                        />
                      </Table.Td>
                    </Table.Tr>
                  )}
                  {/** Mapping for the tile's connection, if it's a raw sql tile */}
                  {isRawSql && (
                    <Table.Tr>
                      <Table.Td>{tile.config.name}</Table.Td>
                      <Table.Td>Data Connection</Table.Td>
                      <Table.Td>{config.connection}</Table.Td>
                      <Table.Td>
                        <SelectControlled
                          control={control}
                          name={`connectionMappings.${i}`}
                          data={connections?.map(conn => ({
                            value: conn.id,
                            label: conn.name,
                          }))}
                          placeholder="Select a connection"
                        />
                      </Table.Td>
                    </Table.Tr>
                  )}
                  {/** Mapping for the tile's onClick source */}
                  {isOnClickSearchById(tile.config.onClick) && (
                    <Table.Tr>
                      <Table.Td>{tile.config.name}</Table.Td>
                      <Table.Td>On Click - Search Source</Table.Td>
                      <Table.Td>{tile.config.onClick.target.id}</Table.Td>
                      <Table.Td>
                        <SelectControlled
                          control={control}
                          name={`onClickSourceMappings.${i}`}
                          data={sources
                            ?.filter(s => isLogSource(s) || isTraceSource(s))
                            .map(source => ({
                              value: source.id,
                              label: source.name,
                            }))}
                          placeholder="Select a source"
                        />
                      </Table.Td>
                    </Table.Tr>
                  )}
                  {/** Mapping for the tile's onClick dashboard */}
                  {isOnClickDashboardById(tile.config.onClick) && (
                    <Table.Tr>
                      <Table.Td>{tile.config.name}</Table.Td>
                      <Table.Td>On Click - Dashboard</Table.Td>
                      <Table.Td>{tile.config.onClick.target.id}</Table.Td>
                      <Table.Td>
                        <SelectControlled
                          control={control}
                          name={`onClickDashboardMappings.${i}`}
                          data={dashboards?.map(dashboard => ({
                            value: dashboard.id,
                            label: dashboard.name,
                          }))}
                          placeholder="Select a dashboard"
                        />
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Fragment>
              );
            })}

            {/** Map filter sources */}
            {input.filters?.map((filter, i) => (
              <Table.Tr key={filter.id}>
                <Table.Td>{filter.name} (Filter)</Table.Td>
                <Table.Td>Data Source</Table.Td>
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
        <Button type="submit" loading={createDashboard.isPending} mb="md">
          Finish Import
        </Button>
      </Stack>
    </form>
  );
}

function DBDashboardImportPage() {
  const brandName = useBrandDisplayName();
  const router = useRouter();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const templateName = router.query.template as string | undefined;
  const isTemplate = !!templateName;
  const isLoadingRoute = !router.isReady;

  const templateInput = useMemo(
    () => (templateName ? getDashboardTemplate(templateName) : undefined),
    [templateName],
  );

  const [fileInput, setFileInput] = useState<DashboardTemplate | null>(null);
  const input = templateInput ?? fileInput;
  const isTemplateNotFound = isTemplate && !isLoadingRoute && !templateInput;

  return (
    <div>
      <Head>
        <title>Import Dashboard - {brandName}</title>
      </Head>
      <Breadcrumbs my="lg" ms="xs" fz="sm">
        <Anchor component={Link} href="/dashboards/list" fz="sm" c="dimmed">
          Dashboards
        </Anchor>
        {isTemplate && (
          <Anchor
            component={Link}
            href="/dashboards/templates"
            fz="sm"
            c="dimmed"
          >
            Templates
          </Anchor>
        )}
        <Text fz="sm" c="dimmed">
          Import
        </Text>
      </Breadcrumbs>
      <div>
        <Container>
          <Stack gap="lg" mt="xl">
            {isLoadingRoute ? (
              <Loader mx="auto" />
            ) : isTemplateNotFound ? (
              <Stack align="center" gap="sm" py="xl">
                <Text ta="center">Oops! We couldn't find that template.</Text>
                <Text ta="center">
                  Try{' '}
                  <Anchor component={Link} href="/dashboards/templates">
                    browsing available templates
                  </Anchor>
                  .
                </Text>
              </Stack>
            ) : !isTemplate ? (
              <FileSelection
                onComplete={i => {
                  setFileInput(i);
                }}
              />
            ) : null}
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

// @ts-expect-error - withAppNav adds layout props that we don't want to type out
DBDashboardImportPageDynamic.getLayout = withAppNav;

export default DBDashboardImportPageDynamic;
