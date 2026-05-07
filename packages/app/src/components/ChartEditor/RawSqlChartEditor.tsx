import { useEffect, useMemo } from 'react';
import { Control, UseFormSetValue, useWatch } from 'react-hook-form';
import {
  TableConnection,
  tcFromSource,
} from '@berg/common-utils/dist/core/metadata';
import { MACRO_SUGGESTIONS } from '@berg/common-utils/dist/macros';
import { QUERY_PARAMS_BY_DISPLAY_TYPE } from '@berg/common-utils/dist/rawSqlParams';
import { DisplayType } from '@berg/common-utils/dist/types';
import { Box, Button, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconHelpCircle } from '@tabler/icons-react';

import { SQLEditorControlled } from '@/components/SQLEditor/SQLEditor';
import { type SQLCompletion } from '@/components/SQLEditor/utils';
import useResizable from '@/hooks/useResizable';
import { useSources } from '@/source';
import { usePrevious } from '@/utils';

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
  onSubmit,
  isDashboardForm,
}: {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  onOpenDisplaySettings: () => void;
  onSubmit: (suppressErrorNotification?: boolean) => void;
  isDashboardForm: boolean;
}) {
  const { size, startResize } = useResizable(20, 'bottom');

  const { data: sources } = useSources();

  const displayType = useWatch({ control, name: 'displayType' });
  const connection = useWatch({ control, name: 'connection' });
  const source = useWatch({ control, name: 'source' });
  const sourceObject = sources?.find(s => s.id === source);

  const prevSource = usePrevious(source);
  const prevConnection = usePrevious(connection);

  useEffect(() => {
    // Berg has no Connection model; the connection field is preserved on
    // the chart config schema as an empty-string sentinel.
    if (!connection) {
      setValue('connection', '');
    } else if (connection !== prevConnection && prevConnection !== undefined) {
      setValue('source', '');
    }
    void prevSource;
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
    void connection;
    return sources.map(s => tcFromSource(s));
  }, [sources, connection]);

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
        />
        <div className={resizeStyles.resizeYHandle} onMouseDown={startResize} />
      </Box>
    </Stack>
  );
}
