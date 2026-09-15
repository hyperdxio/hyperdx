import { MAX_ALERT_DISPLAY_NAME_LENGTH } from '@hyperdx/common-utils/dist/types';
import { escapeRegExp } from 'lodash';
import type { FilterQuery } from 'mongoose';
import { z } from 'zod';

import { ALERT_PAGE_POPULATE, type AlertPageRefs } from '@/controllers/alerts';
import type { ObjectId } from '@/models';
import Alert, { AlertSource, AlertState, IAlert } from '@/models/alert';
import { decodeCursor, encodeCursor } from '@/utils/pagination';
import { objectIdSchema, stringListQueryParam, tagsSchema } from '@/utils/zod';

const MAX_PAGE_LIMIT = 500;

/** The page cursor's payload: the sort key of the last item on the page. */
const alertsPageCursorSchema = z.object({
  n: z.string().nullable(),
  id: objectIdSchema,
});

type AlertsPageCursor = z.infer<typeof alertsPageCursorSchema>;

/** Query parameters schema for the list alerts endpoint. */
export const alertsPageQuerySchema = z
  .object({
    /** Number of alerts to return in one page. Omitted means no paging is applied */
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
    /** The cursor pointing to the last item of the previous page, if there was a previous page */
    cursor: z.string().optional(),
    /** A user ID, to filter for alerts created by a specific user */
    createdBy: objectIdSchema.optional(),
    /** A list of tags to filter alerts by. Returns alerts that have any of the specified tags */
    tag: stringListQueryParam.pipe(tagsSchema).optional(),
    /** A list of alert sources to filter by. Returns alerts that match any of the specified sources */
    source: stringListQueryParam
      .pipe(z.array(z.nativeEnum(AlertSource)).optional())
      .optional(),
    /** A list of alert states to filter by. Returns alerts that match any of the specified states */
    state: stringListQueryParam
      .pipe(z.array(z.nativeEnum(AlertState)).optional())
      .optional(),
    /** A search string to filter alerts by their display name. Substring, case-insensitive match */
    search: z.string().trim().max(MAX_ALERT_DISPLAY_NAME_LENGTH).optional(),
  })
  .superRefine((query, ctx) => {
    if (query.cursor == null) {
      return;
    }
    // A cursor implies pagination, which requires a limit
    if (query.limit == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'cursor requires limit',
      });
    }
    if (decodeCursor(query.cursor, alertsPageCursorSchema) == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'invalid cursor',
      });
    }
  });

export type AlertsPageParams = z.infer<typeof alertsPageQuerySchema>;

/**
 * Mongo filters for a single page.
 */
export function buildAlertsPageFilter(
  teamId: ObjectId | string,
  params: AlertsPageParams,
): FilterQuery<IAlert> {
  const filter: FilterQuery<IAlert> = { team: teamId };

  const displayName: Record<string, unknown> = {};

  if (params.createdBy != null) {
    filter.createdBy = params.createdBy;
  }

  if (params.tag != null) {
    filter.tags = { $in: params.tag };
  }

  if (params.state != null) {
    filter.state = { $in: params.state };
  }

  if (params.source != null) {
    // Some alert `source` pre-date source, so documents without the field are
    // saved-search alerts.
    filter.source = {
      $in: params.source.includes(AlertSource.SAVED_SEARCH)
        ? [...params.source, null]
        : params.source,
    };
  }

  if (params.search) {
    // Case-insensitive substring.
    displayName.$regex = escapeRegExp(params.search);
    displayName.$options = 'i';
  }

  const cursor = params.cursor
    ? decodeCursor(params.cursor, alertsPageCursorSchema)
    : null;
  if (cursor != null) {
    applyCursor(filter, cursor);
  }

  if (Object.keys(displayName).length > 0) {
    filter.displayName = displayName;
  }
  return filter;
}

/**
 * Filters for documents strictly after `cursor` in `{displayName: 1, _id: 1}` order.
 *
 * Null and missing displayNames sort first as one block, so which predicate applies
 * depends on whether the page ended inside that block.
 */
function applyCursor(
  filter: FilterQuery<IAlert>,
  cursor: AlertsPageCursor,
): void {
  // When the previous page ended inside the null block of displayNames,
  // the next row may be another null displayName or a named one.
  if (cursor.n === null) {
    filter.$or = [
      { displayName: null, _id: { $gt: cursor.id } },
      { displayName: { $gte: '' } },
    ];
    return;
  }

  // Otherwise all remaining displayNames are non-null strings, so we find documents
  // with displayNames after the cursor, or displayName equal to the cursor but with
  // a higher _id.
  filter.$or = [
    { displayName: { $gt: cursor.n } },
    { displayName: cursor.n, _id: { $gt: cursor.id } },
  ];
}

export async function getAlertsPage(
  teamId: ObjectId,
  params: AlertsPageParams,
) {
  const { limit } = params;
  const query = Alert.find(buildAlertsPageFilter(teamId, params))
    .sort({ displayName: 1, _id: 1 })
    .populate<AlertPageRefs>(ALERT_PAGE_POPULATE);

  // One row past the page answers "is there more?" without a second count
  // query. Omitting limit keeps the legacy unpaginated response.
  const docs = limit == null ? await query : await query.limit(limit + 1);
  const hasMore = limit != null && docs.length > limit;
  const data = hasMore ? docs.slice(0, limit) : docs;
  const last = data.at(-1);
  const nextCursor =
    hasMore && last != null
      ? encodeCursor({ n: last.displayName ?? null, id: last._id.toString() })
      : undefined;

  return { data, hasMore, nextCursor };
}
