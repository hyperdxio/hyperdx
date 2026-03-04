import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { filter } from 'lodash';
import { useQueryState } from 'nuqs';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { convertToDashboardDocument } from '@hyperdx/common-utils/dist/core/utils';
import { DashboardTemplateSchema } from '@hyperdx/common-utils/dist/types';
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

const SourceResolutionForm = z.object({
  dashboardName: z.string().min(1),
  sourceMappings: z.array(z.string()),
  filterSourceMappings: z.array(z.string()).optional(),
});

type SourceResolutionFormValues = z.infer<typeof SourceResolutionForm>;

function Mapping({ input }: { input: Input }) {
  const router = useRouter();
  const { data: sources } = useSources();
  const [dashboardId] = useQueryState('dashboardId');

  const { handleSubmit, getFieldState, control, setValue } =
    useForm<SourceResolutionFormValues>({
      resolver: zodResolver(SourceResolutionForm),
      defaultValues: {
        dashboardName: input.name,
        sourceMappings: input.tiles.map(() => undefined),
      },
    });

  // When the inputs change, reset the form
  useEffect(() => {
    if (!input || !sources) return;

    const sourceMappings = input.tiles.map(tile => {
      // find matching source name
      const match = sources.find(
        source =>
          source.name.toLowerCase() === tile.config.source.toLowerCase(),
      );
      return match?.id || '';
    });

    const filterSourceMappings = input.filters?.map(filter => {
      // find matching source name
      const match = sources.find(
        source => source.name.toLowerCase() === filter.source.toLowerCase(),
      );
      return match?.id || '';
    });

    setValue('sourceMappings', sourceMappings);
    setValue('filterSourceMappings', filterSourceMappings);
  }, [setValue, sources, input]);

  const isUpdatingRef = useRef(false);
  const sourceMappings = useWatch({ control, name: 'sourceMappings' });
  const prevSourceMappingsRef = useRef(sourceMappings);

  useEffect(() => {
    if (isUpdatingRef.current) return;
    if (!sourceMappings || !input.tiles) return;

    // Find which mapping changed
    const changedIdx = sourceMappings.findIndex(
      (mapping, idx) => mapping !== prevSourceMappingsRef.current?.[idx],
    );
    if (changedIdx === -1) return;

    prevSourceMappingsRef.current = sourceMappings;

    const inputTile = input.tiles[changedIdx];
    if (!inputTile) return;
    const sourceId = sourceMappings[changedIdx] ?? '';
    const keysForTilesWithMatchingSource = input.tiles
      .map((tile, index) => ({ ...tile, index }))
      .filter(tile => tile.config.source === inputTile.config.source)
      .map(({ index }) => `sourceMappings.${index}` as const);

    const keysForFiltersWithMatchingSource =
      input.filters
        ?.map((filter, index) => ({ ...filter, index }))
        .filter(f => f.source === inputTile.config.source)
        .map(({ index }) => `filterSourceMappings.${index}` as const) ?? [];

    isUpdatingRef.current = true;

    for (const key of [
      ...keysForTilesWithMatchingSource,
      ...keysForFiltersWithMatchingSource,
    ]) {
      const fieldState = getFieldState(key);
      // Only set if the field has not been modified
      if (!fieldState.isDirty) {
        setValue(key, sourceId, {
          shouldValidate: true,
        });
      }
    }

    isUpdatingRef.current = false;
  }, [sourceMappings, input.tiles, input.filters, getFieldState, setValue]);

  const createDashboard = useCreateDashboard();
  const updateDashboard = useUpdateDashboard();

  const onSubmit = async (data: SourceResolutionFormValues) => {
    try {
      // Zip the source mappings with the input tiles
      const zippedTiles = input.tiles.map((tile, idx) => {
        const source = sources?.find(
          source => source.id === data.sourceMappings[idx],
        );
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
              <Table.Th>Input Source Name</Table.Th>
              <Table.Th>Mapped Source Name</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {input.tiles.map((tile, i) => (
              <Table.Tr key={tile.id}>
                <Table.Td>{tile.config.name}</Table.Td>
                <Table.Td>{tile.config.source}</Table.Td>
                <Table.Td>
                  <SelectControlled
                    control={control}
                    name={`sourceMappings.${i}`}
                    data={sources?.map(source => ({
                      value: source.id,
                      label: source.name,
                    }))}
                    placeholder="Select a source"
                  />
                </Table.Td>
              </Table.Tr>
            ))}
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
