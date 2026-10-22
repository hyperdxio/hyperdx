import { z } from 'zod';

import { objectIdSchema, tagsSchema } from '@/utils/zod';

// ---------------------------------------------------------------------------
// MCP-compatible Zod schemas for saved search tools.
// ---------------------------------------------------------------------------

const mcpFilterSchema = z
  .union([
    z.object({
      type: z.enum(['lucene', 'sql']).describe('Language of condition.'),
      condition: z
        .string()
        .describe(
          "Filter condition in the chosen language, e.g. level:error or StatusCode = 'Error'.",
        ),
    }),
    z.object({
      type: z
        .literal('sql_ast')
        .describe('Structured comparison, rendered as `left operator right`.'),
      operator: z
        .enum(['=', '<', '>', '!=', '<=', '>='])
        .describe('Comparison between left and right.'),
      left: z
        .string()
        .describe('Column or SQL expression to compare. Inserted as raw SQL.'),
      right: z
        .string()
        .describe(
          'Value or SQL expression that left is compared against. Inserted ' +
            'verbatim as raw SQL, so quote string literals ("\'ok\'") and leave ' +
            'numbers bare ("100").',
        ),
    }),
  ])
  .describe(
    'Extra filter ANDed with where: either a lucene/sql condition string or a ' +
      'structured sql_ast comparison.',
  );

export const mcpSaveSavedSearchSchema = z.object({
  id: z
    .string()
    .optional()
    .describe(
      'Saved search ID, from clickstack_get_saved_search. Omit to create a new ' +
        'saved search, provide to update an existing one.',
    ),
  name: z
    .string()
    .min(1)
    .max(512)
    .describe('Name shown for the saved search in the app.'),
  select: z
    .string()
    .optional()
    .describe(
      'Columns/fields to retrieve. Leave empty for defaults. ' +
        'Example: "body,service.name,duration"',
    ),
  where: z
    .string()
    .optional()
    .describe(
      'Filter condition string in the language specified by whereLanguage. ' +
        'Example (lucene): "level:error", Example (sql): "StatusCode = \'Error\'"',
    ),
  whereLanguage: z
    .enum(['sql', 'lucene'])
    .optional()
    .describe(
      'Language for the where filter. Defaults to lucene on create; on update, ' +
        'omitting it keeps the stored value, so resend it whenever you change where.',
    ),
  orderBy: z
    .string()
    .optional()
    .describe('Sort expression. Example: "Timestamp DESC"'),
  sourceId: objectIdSchema.describe(
    'Source ID — call clickstack_list_sources to find available sources.',
  ),
  tags: tagsSchema.describe(
    'Tags for organizing saved searches. On update, omitting tags clears them.',
  ),
  filters: z
    .array(mcpFilterSchema)
    .optional()
    .describe('Additional structured filters.'),
});
