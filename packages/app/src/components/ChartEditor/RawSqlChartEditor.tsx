import { useEffect, useMemo } from 'react';
import { Control, UseFormSetValue, useWatch } from 'react-hook-form';
import {
  TableConnection,
  tcFromSource,
} from '@hyperdx/common-utils/dist/core/metadata';
import { MACRO_SUGGESTIONS } from '@hyperdx/common-utils/dist/macros';
import { QUERY_PARAMS_BY_DISPLAY_TYPE } from '@hyperdx/common-utils/dist/rawSqlParams';
import {
  DisplayType,
  isLogSource,
  isMetricSource,
  isTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Button, Group, Stack, Text } from '@mantine/core';

import { SQLEditorControlled } from '@/components/SQLEditor/SQLEditor';
import { type SQLCompletion } from '@/components/SQLEditor/utils';
import useResizable from '@/hooks/useResizable';
import { useSources } from '@/source';
import { getAllMetricTables } from '@/utils';

import { ConnectionSelectControlled } from '../ConnectionSelect';

import { SQL_PLACEHOLDERS } from './constants';
import { RawSqlChartInstructions } from './RawSqlChartInstructions';
import { ChartEditorFormState } from './types';

import resizeStyles from '@/../styles/ResizablePanel.module.scss';

export default function RawSqlChartEditor({
  control,
  setValue,
  onOpenDisplaySettings,
}: {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  onOpenDisplaySettings: () => void;
}) {
  const { size, startResize } = useResizable(20, 'bottom');

  const { data: sources } = useSources();

  const displayType = useWatch({ control, name: 'displayType' });
  const connection = useWatch({ control, name: 'connection' });
  const source = useWatch({ control, name: 'source' });

  // Set a default connection
  useEffect(() => {
    if (sources && !connection) {
      const defaultConnection =
        sources.find(s => s.id === source)?.connection ??
        sources[0]?.connection;
      if (defaultConnection && defaultConnection !== connection) {
        setValue('connection', defaultConnection);
      }
    }
  }, [connection, setValue, source, sources]);

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
      ({ name, argCount }) => ({
        label: `$__${name}`,
        apply: argCount > 0 ? `$__${name}(` : `$__${name}`,
        detail: 'macro',
        type: 'function',
      }),
    );

    return [...paramCompletions, ...macroCompletions];
  }, [displayType]);

  const tableConnections: TableConnection[] = useMemo(() => {
    if (!sources) return [];
    return sources
      .filter(s => s.connection === connection)
      .flatMap(source => {
        const tables: TableConnection[] = getAllMetricTables(source);

        if (isMetricSource(source)) {
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

  return (
    <Stack>
      <Group align="center">
        <Text pe="md" size="sm">
          Connection
        </Text>
        <ConnectionSelectControlled
          control={control}
          name="connection"
          size="xs"
        />
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
      <Group justify="flex-end">
        <Button
          onClick={onOpenDisplaySettings}
          size="compact-sm"
          variant="secondary"
        >
          Display Settings
        </Button>
      </Group>
    </Stack>
  );
}
