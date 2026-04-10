import {
  BuilderSavedChartConfig,
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
 * properties from both BuilderChartConfig and RawSqlSavedChartConfig without
 * type errors.
 *
 * All fields are optional since the form may be in either builder or raw SQL
 * mode at any given time. `configType?: 'sql'` is the discriminator.
 *
 * Additionally, 'series' is added as a separate field that is always an array,
 * to work around the fact that useFieldArray only works with fields which are *always*
 * arrays. `series` stores the array `select` data for the form.
 **/
export type ChartEditorFormState = Partial<BuilderSavedChartConfig> &
  Partial<Omit<RawSqlSavedChartConfig, 'configType'>> & {
    heatmapValueExpression?: string;
    heatmapCountExpression?: string;
    heatmapScaleType?: 'log' | 'linear';
    alert?: BuilderSavedChartConfig['alert'] & {
      createdBy?: AlertWithCreatedBy['createdBy'];
    };
    series: SavedChartConfigWithSelectArray['select'];
    configType?: 'sql' | 'builder';
  };
