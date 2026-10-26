import { isFormulaSourceKind } from '@hyperdx/common-utils/dist/core/utils';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import type { SearchView } from './searchViews';

export type ExploreFormula = {
  expression: string;
  alias?: string;
};

/** Views that can compile letter-ref formulas. */
export function exploreViewSupportsFormulas(view: SearchView): boolean {
  return view === 'timeseries' || view === 'table' || view === 'number';
}

export function canAddExploreFormula(
  view: SearchView,
  formulaCount: number,
  sourceKind?: SourceKind,
): boolean {
  if (!isFormulaSourceKind(sourceKind)) return false;
  if (!exploreViewSupportsFormulas(view)) return false;
  if (view === 'number' && formulaCount >= 1) return false;
  return true;
}

export function createEmptyExploreFormula(): ExploreFormula {
  return { expression: '', alias: '' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

/** Parse the `formulas` URL param, or null if invalid. Empty array is valid. */
export function parseExploreFormulas(value: unknown): ExploreFormula[] | null {
  if (!Array.isArray(value) || value.length > 20) {
    return null;
  }
  const formulas: ExploreFormula[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const expression =
      typeof item.expression === 'string' ? item.expression : '';
    const alias = typeof item.alias === 'string' ? item.alias : undefined;
    formulas.push({
      expression,
      ...(alias != null && alias.length > 0 ? { alias } : {}),
    });
  }
  return formulas;
}
