import { useEffect, useMemo, useState } from 'react';
import { Control, UseFormSetValue, useWatch } from 'react-hook-form';
import {
  TableConnection,
  tcFromSource,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  displayTypeSupportsRawSqlAlerts,
  validateRawSqlForAlert,
} from '@hyperdx/common-utils/dist/core/utils';
import { MACRO_SUGGESTIONS } from '@hyperdx/common-utils/dist/macros';
import { QUERY_PARAMS_BY_DISPLAY_TYPE } from '@hyperdx/common-utils/dist/rawSqlParams';
import { RawSqlChartConfig } from '@hyperdx/common-utils/dist/types';
import {
  DisplayType,
  isLogSource,
  isMetricSource,
  isTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Button, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconBell, IconHelpCircle } from '@tabler/icons-react';

import { ConnectionSelectControlled } from '@/components/ConnectionSelect';
import { OnClickFormButton } from '@/components/DBEditTimeChartForm/OnClickForm/OnClickFormButton';
import { TileAlertEditor } from '@/components/DBEditTimeChartForm/TileAlertEditor';
import SourceSchemaPreview, {
  isSourceSchemaPreviewEnabled,
} from '@/components/SourceSchemaPreview';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLEditorControlled } from '@/components/SQLEditor/SQLEditor';
import { type SQLCompletion } from '@/components/SQLEditor/utils';
import { IS_LOCAL_MODE } from '@/config';
import useResizable from '@/hooks/useResizable';
import { useSources } from '@/source';
import { getAllMetricTables, usePrevious } from '@/utils';
import { DEFAULT_TILE_ALERT } from '@/utils/alerts';

import { SQL_PLACEHOLDERS } from './constants';
import { RawSqlChartInstructions } from './RawSqlChartInstructions';
import { ChartEditorFormState } from './types';

import resizeStyles from '@/../styles/ResizablePanel.module.scss';

type ConnectionSourceSyncResult =
  | { field: 'connection'; value: string }
  | { field: 'source'; value: '' }
  | null;

/**
 * Decides how the `connection` and `source` form fields should be kept in sync
 * in raw SQL mode. Extracted as a pure function so the behavior can be unit
 * tested independently of the component's effect.
 */
export function resolveConnectionSourceSync({
  source,
  connection,
  prevSource,
  prevConnection,
  sources,
}: {
  source: string | undefined;
  connection: string | undefined;
  prevSource: string | undefined;
  prevConnection: string | undefined;
  sources: { id: string; connection: string }[] | undefined;
}): ConnectionSourceSyncResult {
  if (!sources) return null;

  // When the source changes, sync the connection to match.
  if (source !== prevSource) {
    const sourceConnection = sources.find(s => s.id === source)?.connection;
    if (sourceConnection && sourceConnection !== connection) {
      return { field: 'connection', value: sourceConnection };
    }
    return null;
  }

  // Set a default connection when none is selected.
  if (!connection) {
    const defaultConnection = sources[0]?.connection;
    if (defaultConnection) {
      return { field: 'connection', value: defaultConnection };
    }
    return null;
  }

  // When the connection changes, clear the source only if the currently
  // selected source doesn't belong to the new connection. This avoids clearing
  // a source that was just carried over (e.g. from builder mode), where the
  // connection change above was itself triggered by the source.
  if (connection !== prevConnection && prevConnection !== undefined) {
    const sourceConnection = sources.find(s => s.id === source)?.connection;
    if (source && sourceConnection !== connection) {
      return { field: 'source', value: '' };
    }
  }

  return null;
}

export default function RawSqlChartEditor({
  control,
  setValue,
  onOpenDisplaySettings,
  onSubmit,
  isDashboardForm,
  alert,
  dashboardId,
}: {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  onOpenDisplaySettings: () => void;
  onSubmit: (suppressErrorNotification?: boolean) => void;
  isDashboardForm: boolean;
  alert: ChartEditorFormState['alert'];
  dashboardId?: string;
}) {
  const { size, startResize } = useResizable(20, 'bottom');

  const { data: sources } = useSources();

  const displayType = useWatch({ control, name: 'displayType' });
  const connection = useWatch({ control, name: 'connection' });
  const source = useWatch({ control, name: 'source' });
  const sqlTemplate = useWatch({ control, name: 'sqlTemplate' });
  const sourceObject = sources?.find(s => s.id === source);

  const rawSqlConfig = useMemo(
    () =>
      ({
        configType: 'sql',
        sqlTemplate: sqlTemplate ?? '',
        connection: connection ?? '',
        from: sourceObject?.from,
        displayType,
      }) satisfies RawSqlChartConfig,
    [sqlTemplate, connection, sourceObject?.from, displayType],
  );

  const { alertErrorMessage, alertWarningMessage } = useMemo(() => {
    const { errors, warnings } = validateRawSqlForAlert(rawSqlConfig);
    return {
      alertErrorMessage: errors.length > 0 ? errors.join('. ') : undefined,
      alertWarningMessage:
        warnings.length > 0 ? warnings.join('. ') : undefined,
    };
  }, [rawSqlConfig]);

  const prevSource = usePrevious(source);
  const prevConnection = usePrevious(connection);

  useEffect(() => {
    const update = resolveConnectionSourceSync({
      source,
      connection,
      prevSource,
      prevConnection,
      sources,
    });
    if (update?.field === 'connection') {
      setValue('connection', update.value);
    } else if (update?.field === 'source') {
      setValue('source', update.value);
    }
  }, [connection, prevConnection, prevSource, setValue, source, sources]);

  const placeholderSQl = SQL_PLACEHOLDERS[displayType ?? DisplayType.Table];

  const additionalCompletions: SQLCompletion[] = useMemo(() => {
    const effectiveDisplayType = displayType ?? DisplayType.Table;
    const params = QUERY_PARAMS_BY_DISPLAY_TYPE[effectiveDisplayType];

    const paramCompletions: SQLCompletion[] = params.map(({ name, type }) => ({
      label: `{${name}:${type}}`,
      apply: `{${name}:${type}`, // Omit the closing } because the editor will have added it when the user types {
      detail: 'param',
      type: 'variable',
    }));

    const macroCompletions: SQLCompletion[] = MACRO_SUGGESTIONS.map(
      ({ name, minArgs }) => ({
        label: `$__${name}`,
        apply: minArgs > 0 ? `$__${name}(` : `$__${name}`,
        detail: 'macro',
        type: 'function',
      }),
    );

    return [...paramCompletions, ...macroCompletions];
  }, [displayType]);

  const [isSourceSchemaPreviewOpen, setIsSourceSchemaPreviewOpen] =
    useState(false);

  const tableConnections: TableConnection[] = useMemo(() => {
    if (!sources) return [];
    return sources
      .filter(s => s.connection === connection)
      .flatMap(source => {
        const tables: TableConnection[] = getAllMetricTables(source);

        if (!isMetricSource(source)) {
          tables.push(tcFromSource(source));
        }

        if (
          (isLogSource(source) || isTraceSource(source)) &&
          source.materializedViews
        ) {
          tables.push(
            ...source.materializedViews.map(mv => ({
              databaseName: mv.databaseName,
              tableName: mv.tableName,
              connectionId: source.connection,
            })),
          );
        }

        return tables;
      });
  }, [sources, connection]);

  const alertTooltip =
    displayType === DisplayType.Number
      ? 'The threshold will be evaluated against the last numeric column in the first query result'
      : 'The threshold will be evaluated against the last numeric column in each query result';

  return (
    <Stack gap="xs">
      <Group align="center" gap={0} justify="space-between">
        <Group align="center" gap={0}>
          <Text pe="md" size="sm">
            Connection
          </Text>
          <ConnectionSelectControlled
            control={control}
            name="connection"
            size="xs"
          />
          <Group align="center" gap={8} mx="md">
            <Text size="sm" ps="md">
              Source
            </Text>
            {isDashboardForm && (
              <Tooltip
                label="Optional. Required to apply dashboard filters to this chart."
                pe="md"
              >
                <IconHelpCircle size={14} className="cursor-pointer" />
              </Tooltip>
            )}
          </Group>
          <SourceSelectControlled
            control={control}
            name="source"
            connectionId={connection}
            size="xs"
            clearable
            placeholder="None"
            onSchemaPreview={() => setIsSourceSchemaPreviewOpen(true)}
            isSchemaPreviewEnabled={isSourceSchemaPreviewEnabled(sourceObject)}
          />
          <SourceSchemaPreview
            source={sourceObject}
            controlled
            open={isSourceSchemaPreviewOpen}
            onClose={() => setIsSourceSchemaPreviewOpen(false)}
          />
        </Group>
        <Group gap="xs">
          {displayTypeSupportsRawSqlAlerts(displayType) &&
            dashboardId &&
            !alert &&
            !IS_LOCAL_MODE && (
              <Button
                variant="subtle"
                data-testid="alert-button"
                size="sm"
                color={'gray'}
                onClick={() => setValue('alert', DEFAULT_TILE_ALERT)}
              >
                <IconBell size={14} className="me-2" />
                Add Alert
              </Button>
            )}

          <Group>
            {displayType === DisplayType.Table && (
              <OnClickFormButton
                control={control}
                setValue={setValue}
                onSubmit={onSubmit}
              />
            )}
            <Button
              onClick={onOpenDisplaySettings}
              size="compact-sm"
              variant="secondary"
            >
              Display Settings
            </Button>
          </Group>
        </Group>
      </Group>
      <RawSqlChartInstructions displayType={displayType ?? DisplayType.Table} />
      <Box style={{ position: 'relative' }}>
        <SQLEditorControlled
          control={control}
          name="sqlTemplate"
          height={`${size}vh`}
          enableLineWrapping
          placeholder={placeholderSQl}
          tableConnections={tableConnections}
          additionalCompletions={additionalCompletions}
          onSubmit={onSubmit}
        />
        <div className={resizeStyles.resizeYHandle} onMouseDown={startResize} />
      </Box>
      {alert && (
        <TileAlertEditor
          control={control}
          setValue={setValue}
          alert={alert}
          onRemove={() => setValue('alert', undefined)}
          error={alertErrorMessage}
          warning={alertWarningMessage}
          tooltip={alertTooltip}
        />
      )}
    </Stack>
  );
}
