import { useCallback, useEffect, useRef } from 'react';
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
import {
  convertRawSqlToBuilderConfig,
  SqlToBuilderError,
} from '@hyperdx/common-utils/dist/core/rawSqlToBuilder';
import { DisplayType, TSource } from '@hyperdx/common-utils/dist/types';
import { usePrevious } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';

import {
  ChartEditorFormState,
  ChartFormSetValue,
} from '@/components/ChartEditor/types';
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
 * Two-way carry-over between the chart editor's builder config and its raw-SQL
 * template. When the user toggles the config type, the query they were most
 * recently editing is converted into the other representation:
 *
 * - **Builder → SQL**: switching to SQL mode generates a macro-based SQL
 *   template from the current builder config and populates the SQL editor.
 * - **SQL → Builder**: switching to builder mode parses the current SQL
 *   template back into builder fields.
 *
 * Each direction only fires when the user edited that source mode more recently
 * than the target mode, so a hand-edited query is never clobbered by a
 * regeneration derived from the stale other side. Either direction failing
 * surfaces a notification and leaves the target representation untouched, so an
 * unconvertible query never destroys the config the user already had.
 */
export function useBuilderSqlConversion({
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

  // Which mode has edits not yet synced to the other representation. `null`
  // means the two are in sync (e.g. right after a successful conversion), so
  // neither direction should re-convert until the user edits one side again.
  const lastEditedModeRef = useRef<EditedMode | null>(
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

  // A `setValue` wrapper handed to the form controls. Controls that mutate a
  // query field without going through a registered react-hook-form input (so the
  // `watch` subscription above never sees a `type: 'change'` event) pass
  // `isUserChange: true`, which records the edit here so the correct direction
  // re-converts on the next mode toggle. Programmatic writes omit the flag and
  // behave like a plain `setValue`.
  const setValueWithEditTracking = useCallback<ChartFormSetValue>(
    (name, value, options) => {
      const { isUserChange, ...setValueOptions } = options ?? {};
      setValue(name, value, setValueOptions);
      if (!isUserChange) {
        return;
      }
      const editMode = classifyFormEdit({
        name,
        type: 'change',
        configType: getValues('configType'),
      });
      if (editMode) {
        lastEditedModeRef.current = editMode;
      }
    },
    [setValue, getValues],
  );

  // Builder → SQL: regenerate the SQL template when switching to SQL mode.
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
        // The two representations are now in sync; neither has pending edits, so
        // don't re-convert until the user edits one side again.
        lastEditedModeRef.current = null;
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

  // SQL → Builder: parse the SQL template back into builder fields when
  // switching to builder mode (the inverse of the Builder → SQL effect above).
  useEffect(() => {
    // Only convert when switching from SQL mode to builder mode.
    if (prevConfigType !== 'sql' || configType !== 'builder') {
      return;
    }

    // Only convert when the user edited in SQL more recently than in builder,
    // so a builder config the user was working on is never clobbered by a
    // conversion derived from stale (e.g. auto-generated) SQL.
    if (lastEditedModeRef.current !== 'sql') {
      return;
    }

    const form = getValues();
    const displayType = form.displayType ?? DisplayType.Line;
    const opts = { shouldDirty: true } as const;

    try {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: form.sqlTemplate ?? '',
        displayType,
        from: tableSource?.from,
        timestampValueExpression: tableSource?.timestampValueExpression,
      });

      const series = result.select.map(s => ({
        ...s,
        aggConditionLanguage: s.aggConditionLanguage ?? 'sql',
      }));
      setValue('select', series, opts);
      setValue('series', series, opts);
      setValue('where', result.where, opts);
      setValue('whereLanguage', result.whereLanguage, opts);
      setValue('groupBy', result.groupBy, opts);
      setValue('granularity', result.granularity, opts);
      setValue('having', result.having, opts);
      setValue('havingLanguage', result.havingLanguage, opts);
      setValue('orderBy', result.orderBy, opts);
      setValue('limit', result.limit, opts);
      setValue('seriesReturnType', result.seriesReturnType ?? 'column', opts);

      // The two representations are now in sync; neither has pending edits, so
      // don't re-convert until the user edits one side again.
      lastEditedModeRef.current = null;

      notifications.show({
        id: 'sql-to-builder',
        title: 'Converted SQL to builder',
        message: 'The SQL query was converted into a builder chart.',
        color: 'green',
      });
    } catch (e) {
      const message =
        e instanceof SqlToBuilderError
          ? e.message
          : 'The SQL query could not be converted to the builder.';
      // Logged so that failures can be monitored and fixed
      console.warn('Could not convert SQL to builder', {
        sqlTemplate: form.sqlTemplate ?? '',
        displayType,
        reason: message,
        err: e,
      });
      notifications.show({
        id: 'sql-to-builder',
        title: 'Could not convert SQL to builder',
        message,
        color: 'yellow',
      });
    }
  }, [configType, prevConfigType, getValues, setValue, tableSource]);

  return { setValue: setValueWithEditTracking };
}
