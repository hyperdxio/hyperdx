import { useEffect, useRef } from 'react';
import {
  Control,
  UseFormGetValues,
  UseFormSetValue,
  UseFormWatch,
  useWatch,
} from 'react-hook-form';
import {
  renderBuilderConfigAsSqlTemplate,
  RenderedSqlTemplate,
} from '@hyperdx/common-utils/dist/core/builderToRawSql';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { usePrevious } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { convertFormStateToChartConfig } from '@/components/ChartEditor/utils';
import { useMetadataWithSettings } from '@/hooks/useMetadata';

type ConfigType = ChartEditorFormState['configType'];

/** The mode a chart edit belongs to for conversion purposes. */
export type EditedMode = 'builder' | 'sql';

/**
 * Fields that belong to neither the builder query nor the SQL editor (they're
 * shared chart metadata), so editing them must not count as a "mode edit".
 */
const MODE_AGNOSTIC_FIELDS = new Set(['name', 'configType']);

/**
 * Classify a react-hook-form field change as a builder-mode edit, a SQL-mode
 * edit, or neither. Only genuine user input (type='change') counts as an edit.
 */
export function classifyFormEdit({
  name,
  type,
  configType,
}: {
  name?: string;
  type?: string;
  configType?: ConfigType;
}): EditedMode | null {
  if (type !== 'change' || !name || MODE_AGNOSTIC_FIELDS.has(name)) {
    return null;
  }
  // In SQL mode only the SQL editor is a query edit; in builder mode every
  // query field except the SQL editor is (a denylist, so new builder fields
  // are covered automatically).
  if (configType === 'sql') {
    return name === 'sqlTemplate' ? 'sql' : null;
  }
  if (configType === 'builder') {
    return name === 'sqlTemplate' ? null : 'builder';
  }
  return null;
}

/**
 * One-way Builder → SQL carry-over: when the chart editor switches from builder
 * mode to SQL mode, generates a macro-based SQL template from the current
 * builder config and populates the SQL editor with it.
 *
 * The SQL is regenerated only when the user edited the chart in builder mode
 * more recently than in SQL mode. Configs that can't be converted surface a
 * notification and leave the SQL editor untouched.
 */
export function useBuilderToSqlConversion({
  control,
  getValues,
  setValue,
  watch,
  tableSource,
}: {
  control: Control<ChartEditorFormState>;
  getValues: UseFormGetValues<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  watch: UseFormWatch<ChartEditorFormState>;
  tableSource: TSource | undefined;
}) {
  const metadata = useMetadataWithSettings();

  const configType = useWatch({ control, name: 'configType' });
  const prevConfigType = usePrevious(configType);

  // Which mode the user most recently edited in
  const lastEditedModeRef = useRef<EditedMode>(
    getValues('configType') === 'sql' ? 'sql' : 'builder',
  );

  // A monotonically increasing request ID to ensure that only the latest
  // generated SQL is written to the form.
  const requestIdRef = useRef(0);

  // Track the most-recently-edited mode from genuine user input.
  useEffect(() => {
    const subscription = watch((_values, { name, type }) => {
      const editMode = classifyFormEdit({
        name,
        type,
        configType: getValues('configType'),
      });
      if (editMode) {
        lastEditedModeRef.current = editMode;
      }
    });
    return () => subscription.unsubscribe();
  }, [watch, getValues]);

  useEffect(() => {
    // Only generate a new SQL template when switching from builder mode to SQL mode.
    if (prevConfigType !== 'builder' || configType !== 'sql') {
      return;
    }

    const showError = (message: string, err?: Error) => {
      console.warn('Could not convert chart to SQL', {
        form: getValues(),
        err,
      });
      notifications.show({
        id: 'builder-to-sql-error',
        title: 'Could not auto-convert to SQL',
        message,
        color: 'red',
      });
    };

    // Only overwrite when the user edited in builder more recently than in SQL.
    if (lastEditedModeRef.current !== 'builder') {
      return;
    }

    // A resolved source is required to build a ChartConfig from the form;
    // every other reason a config can't be converted is reported by
    // renderBuilderConfigAsSqlTemplate below.
    if (!tableSource) {
      showError('Auto-converting to SQL requires a source to be selected.');
      return;
    }

    // Build a ChartConfig from the current form state
    const form = getValues();
    const config = convertFormStateToChartConfig(
      { ...form, configType: 'builder' },
      // dateRange is irrelevant here, since the SQL will contain date range macros
      [new Date(0), new Date(0)],
      tableSource,
    );
    if (!config) return;

    const requestId = ++requestIdRef.current;
    const applyResult = (result: RenderedSqlTemplate) => {
      // Ignore results from generations that a newer switch has superseded.
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (result.isError) {
        showError(result.error);
        return;
      }

      // Only write while still in SQL mode, and don't clobber a hand-edit the
      // user made while generation was in flight.
      if (
        getValues('configType') === 'sql' &&
        lastEditedModeRef.current === 'builder'
      ) {
        setValue('sqlTemplate', result.sql);
        notifications.show({
          title: 'Chart converted to SQL',
          message: 'The existing chart configuration has been converted to SQL',
          color: 'green',
        });
      }
    };

    renderBuilderConfigAsSqlTemplate(config, metadata)
      .then(applyResult)
      .catch(e => showError('Chart could not be auto-converted to SQL', e));
  }, [configType, tableSource, metadata, getValues, setValue, prevConfigType]);
}
