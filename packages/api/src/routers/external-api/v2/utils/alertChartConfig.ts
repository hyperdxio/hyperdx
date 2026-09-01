import {
  AlertChartConfig,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import { omit } from 'lodash';

import logger from '@/utils/logger';
import { ExternalAlertChartConfig } from '@/utils/zod';

import {
  convertToExternalTileChartConfig,
  convertToInternalTileConfig,
} from './dashboards';

/**
 * Converts an inline alert's external-dialect chart config (the tile-config
 * dialect v2 dashboards use: `sourceId`, per-select `where`, `asRatio`,
 * `connectionId` + `sqlTemplate`) into the internal AlertChartConfig shape the
 * alert document persists and the check-alerts task evaluates.
 *
 * Reuses the dashboard tile converter through a synthetic tile so the two
 * surfaces cannot drift on field mapping (`where` -> `aggCondition`,
 * `asRatio` -> `seriesReturnType`, `connectionId` -> `connection`, fillNulls
 * defaulting, ...). Layout fields are placeholders — only `config` is kept.
 */
export function convertExternalAlertChartConfigToInternal(
  external: ExternalAlertChartConfig,
): AlertChartConfig {
  const { config } = convertToInternalTileConfig({
    id: '',
    name: '',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    config: external,
  });
  // The tile converter writes the synthetic tile's (empty) name into the
  // config and never emits a PromQL variant or an embedded `alert` for the
  // display types the alert schema admits, so stripping `name`/`alert` yields
  // a valid AlertChartConfig.
  return omit(config, ['name', 'alert']) as AlertChartConfig;
}

/**
 * Converts an inline alert's persisted internal chart config to the external
 * tile-config dialect for API responses. Returns undefined for configs the
 * external contract cannot represent (a corrupt document with an unsupported
 * display type or a PromQL config) — callers omit the field rather than
 * emitting an invalid shape.
 */
export function convertAlertChartConfigToExternal(
  config: AlertChartConfig,
): ExternalAlertChartConfig | undefined {
  const external = convertToExternalTileChartConfig(config);
  switch (external?.displayType) {
    case DisplayType.Line:
    case DisplayType.StackedBar:
    case DisplayType.Number:
      return external;
    default:
      logger.error(
        { config },
        'Inline alert chart config has no external representation',
      );
      return undefined;
  }
}
