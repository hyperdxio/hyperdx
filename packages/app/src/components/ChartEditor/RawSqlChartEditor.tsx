import { useEffect, useMemo } from 'react';
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

import { TileAlertEditor } from '@/components/DBEditTimeChartForm/TileAlertEditor';
import { SQLEditorControlled } from '@/components/SQLEditor/SQLEditor';
import { type SQLCompletion } from '@/components/SQLEditor/utils';
import { IS_LOCAL_MODE } from '@/config';
import useResizable from '@/hooks/useResizable';
import { useSources } from '@/source';
import { getAllMetricTables, usePrevious } from '@/utils';
import { DEFAULT_TILE_ALERT } from '@/utils/alerts';

import { ConnectionSelectControlled } from '../ConnectionSelect';
import { OnClickFormButton } from '../DBEditTimeChartForm/OnClickForm/OnClickFormButton';
import SourceSchemaPreview from '../SourceSchemaPreview';
import { SourceSelectControlled } from '../SourceSelect';

import { SQL_PLACEHOLDERS } from './constants';
import { RawSqlChartInstructions } from './RawSqlChartInstructions';
import { ChartEditorFormState } from './types';

import resizeStyles from '@/../styles/ResizablePanel.module.scss';

export default function RawSqlChartEditor({
  control,
  setValue,
  onOpenDisplaySettings,
  isDashboardForm,
  alert,
  dashboardId,
}: {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  onOpenDisplaySettings: () => void;
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
    if (!sources) return;

    // When the source changes, sync the connection to match.
    if (source !== prevSource) {
      const sourceConnection = sources.find(s => s.id === source)?.connection;
      if (sourceConnection && sourceConnection !== connection) {
        setValue('connection', sourceConnection);
      }
    } else if (!connection) {
      // Set a default connection
      const defaultConnection = sources[0]?.connection;
      if (defaultConnection) {
        setValue('connection', defaultConnection);
      }
    } else if (connection !== prevConnection && prevConnection !== undefined) {
      // When the connection changes, clear the source
      setValue('source', '');
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

  const sourceSchemaPreview = useMemo(() => {
    return <SourceSchemaPreview source={sourceObject} variant="text" />;
  }, [sourceObject]);

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
            sourceSchemaPreview={sourceSchemaPreview}
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
              <OnClickFormButton control={control} setValue={setValue} />
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
