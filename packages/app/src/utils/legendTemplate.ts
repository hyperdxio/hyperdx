import {
  UnknownTemplateHelperError,
  validateTemplate,
} from '@hyperdx/common-utils/dist/core/handlebarsEnv';
import { MAX_LEGEND_TEMPLATE_LENGTH } from '@hyperdx/common-utils/dist/types';

/**
 * react-hook-form `validate` rule for a legend template input. Shared by the
 * chart-level template in the display settings drawer and the per-expression
 * overrides in the PromQL editor.
 */
export function validateLegendTemplateInput(value: unknown): true | string {
  if (typeof value !== 'string' || !value) return true;
  const trimmed = value.trim();
  if (trimmed.length > MAX_LEGEND_TEMPLATE_LENGTH) {
    return `Template is too long (${trimmed.length} characters, max ${MAX_LEGEND_TEMPLATE_LENGTH})`;
  }
  try {
    validateTemplate(trimmed);
    return true;
  } catch (err) {
    return err instanceof UnknownTemplateHelperError
      ? err.message
      : 'Invalid Handlebars template';
  }
}
