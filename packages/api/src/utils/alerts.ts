import {
  clampAlertDisplayName,
  clampAlertTags,
  formatTileAlertDisplayName,
} from '@hyperdx/common-utils/dist/alerts';
import { Types } from 'mongoose';

import type { ObjectId } from '@/models';
import { AlertSource } from '@/models/alert';

import logger from './logger';

/**
 * Documents that an alert may reference. Structural rather than
 * `Pick<IDashboard | ISavedSearch, ...>` because derivation reads
 * the data as untrusted from old Mongo documents.
 */
export type AlertRefs = {
  savedSearch?: { name?: unknown; tags?: unknown } | null;
  dashboard?: {
    name?: unknown;
    tags?: unknown;
    tiles?: { id?: string | null; config?: { name?: unknown } | null }[] | null;
  } | null;
};

export type AlertDisplayFields = {
  displayName: string;
  tags: string[];
};

/** `null` means "nothing to derive from", not "derived to empty". */
export type DerivedAlertDisplayFields = {
  displayName: string | null;
  tags: string[] | null;
};

type AlertDisplayInput = {
  source?: AlertSource | null;
  tileId?: string | null;
  chartConfig?: { name?: string | null } | null;
  displayName?: string | null;
  tags?: string[] | null;
};

const FALLBACK_DISPLAY_NAME = 'Alert';

/**
 * Referenced entities are read straight from Mongo and predate any of these
 * fields, so treat their values as untrusted: anything that isn't a non-blank
 * string is "no name".
 */
function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Untrusted Mongo value -> tags that satisfy `alertTagsSchema`. */
function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return clampAlertTags(
    value.filter((tag): tag is string => typeof tag === 'string'),
  );
}

/**
 * A Mongoose ref field is either a bare ObjectId or, when the query populated
 * it, the referenced document. Documents don't override toString(), so an
 * unguarded `.toString()` on a populated ref silently yields "[object Object]".
 */
export function isPopulatedRef(ref: unknown): ref is { _id: ObjectId } {
  return typeof ref === 'object' && ref !== null && '_id' in ref;
}

/**
 * The populated document when the ref field was populated, null otherwise.
 * The instanceof check is for the type system: the predicate alone can't
 * remove the bare-ObjectId branch from the union.
 */
export function populatedRefOrNull<T extends { _id: ObjectId }>(
  ref: ObjectId | T | null | undefined,
): T | null {
  return isPopulatedRef(ref) && !(ref instanceof Types.ObjectId) ? ref : null;
}

/**
 * The display name/tags an alert falls back to when it has no stored values of
 * its own, derived from whatever entity it references. Returns `null` per field
 * when the referenced entity isn't available: writers persist `null` rather than
 * freezing the generic fallback, so a later read with the ref populated still
 * resolves to the real name.
 */
export function deriveAlertDisplayFields(
  alert: AlertDisplayInput,
  refs: AlertRefs = {},
): DerivedAlertDisplayFields {
  const { savedSearch, dashboard } = refs;

  let displayName: string | null = null;
  let tags: string[] | null = null;

  try {
    switch (alert.source) {
      case AlertSource.TILE: {
        const dashboardName = normalizeName(dashboard?.name);
        if (dashboardName != null) {
          const tiles = Array.isArray(dashboard?.tiles) ? dashboard.tiles : [];
          const tile = alert.tileId
            ? tiles.find(t => t.id === alert.tileId)
            : undefined;
          displayName = formatTileAlertDisplayName(
            dashboardName,
            normalizeName(tile?.config?.name),
          );
        }
        tags = dashboard ? normalizeTags(dashboard.tags) : null;
        break;
      }
      case AlertSource.INLINE:
        displayName = normalizeName(alert.chartConfig?.name);
        tags = []; // Inline alerts have no parent to inherit tags from.
        break;
      case AlertSource.SAVED_SEARCH:
      default:
        displayName = normalizeName(savedSearch?.name);
        tags = savedSearch ? normalizeTags(savedSearch.tags) : null;
        break;
    }
  } catch (e) {
    logger.error(
      {
        alert,
        refs,
      },
      'deriveAlertDisplayFields failed',
      e,
    );
  }

  return {
    displayName:
      displayName == null ? null : clampAlertDisplayName(displayName),
    tags,
  };
}

/**
 * Stored value per field, falling back to the derived one. Every read path goes
 * through this so documents written before the fields existed still render.
 */
export function resolveAlertDisplayFields(
  alert: AlertDisplayInput,
  refs: AlertRefs = {},
): AlertDisplayFields {
  const derived = deriveAlertDisplayFields(alert, refs);
  return {
    displayName:
      alert.displayName ?? derived.displayName ?? FALLBACK_DISPLAY_NAME,
    tags: alert.tags != null ? [...alert.tags] : (derived.tags ?? []),
  };
}
