import { FieldPath, FieldPathValue, SetValueConfig } from 'react-hook-form';
import {
  BuilderSavedChartConfig,
  PromqlSavedChartConfig,
  RawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/types';

import { AlertWithCreatedBy } from '@/types';

export type SavedChartConfigWithSelectArray = Omit<
  BuilderSavedChartConfig,
  'select'
> & {
  select: NonNullable<Exclude<BuilderSavedChartConfig['select'], string>>;
};

/**
 * A type that flattens the SavedChartConfig union so that the form can include
 * properties from both BuilderChartConfig, RawSqlSavedChartConfig, and
 * PromqlSavedChartConfig without type errors.
 *
 * All fields are optional since the form may be in builder, raw SQL, or PromQL
 * mode at any given time. `configType` is the discriminator.
 *
 * Additionally, 'series' is added as a separate field that is always an array,
 * to work around the fact that useFieldArray only works with fields which are *always*
 * arrays. `series` stores the array `select` data for the form.
 **/
export type ChartEditorFormState = Partial<BuilderSavedChartConfig> &
  Partial<Omit<RawSqlSavedChartConfig, 'configType'>> &
  Partial<Omit<PromqlSavedChartConfig, 'configType'>> & {
    alert?: BuilderSavedChartConfig['alert'] & {
      id?: string;
      createdBy?: AlertWithCreatedBy['createdBy'];
    };
    series: SavedChartConfigWithSelectArray['select'];
    configType?: 'sql' | 'builder' | 'promql';
  };

/**
 * Options accepted by {@link ChartFormSetValue}: react-hook-form's standard
 * `setValue` config plus `isUserChange`, which records that the write came from
 * a genuine user edit (see below).
 */
export type ChartFormSetValueOptions = SetValueConfig & {
  isUserChange?: boolean;
};

/**
 * A `setValue` wrapper for the chart editor form that also records whether the
 * write came from a genuine user edit. Builder ⇄ SQL conversion uses this to
 * tell user edits apart from the many programmatic `setValue` writes (defaults,
 * resets, its own generated output). Pass `{ isUserChange: true }` only when the
 * user directly changed the field via a control that isn't a registered
 * react-hook-form input (toggles, pickers, table sorts, helper buttons, etc.).
 *
 * The flag lives in the options object (rather than a positional argument) so
 * this stays assignable to `UseFormSetValue` and can be threaded through
 * components that only forward `setValue` without any changes.
 */
export type ChartFormSetValue = <TName extends FieldPath<ChartEditorFormState>>(
  name: TName,
  value: FieldPathValue<ChartEditorFormState, TName>,
  options?: ChartFormSetValueOptions,
) => void;
