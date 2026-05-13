import { z } from 'zod';

// ---------------------------------------------------------------------------
// MCP-compatible Zod schemas for saved search tools.
// ---------------------------------------------------------------------------

const mcpFilterSchema = z
  .union([
    z.object({
      type: z
        .enum(['lucene', 'sql'])
        .describe('Filter language: lucene or sql.'),
      condition: z.string().describe('Filter condition string.'),
    }),
    z.object({
      type: z.literal('sql_ast').describe('Structured SQL AST filter.'),
      operator: z
        .enum(['=', '<', '>', '!=', '<=', '>='])
        .describe('Comparison operator.'),
      left: z.string().describe('Left operand (column or expression).'),
      right: z.string().describe('Right operand (value or expression).'),
    }),
  ])
  .describe('Filter applied to the saved search.');

export const mcpSaveSavedSearchSchema = z.object({
  id: z
    .string()
    .optional()
    .describe(
      'Saved search ID. Omit to create a new saved search, provide to update an existing one.',
    ),
  name: z
    .string()
    .min(1)
    .max(512)
    .describe('Human-friendly name for the saved search.'),
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
    .describe('Language for the where filter. Default: lucene.'),
  orderBy: z
    .string()
    .optional()
    .describe('Sort expression. Example: "Timestamp DESC"'),
  sourceId: z
    .string()
    .describe(
      'Source ID — call hyperdx_list_sources to find available sources.',
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe('Tags for organizing saved searches.'),
  filters: z
    .array(mcpFilterSchema)
    .optional()
    .describe('Additional structured filters.'),
});

export type McpSaveSavedSearchInput = z.infer<typeof mcpSaveSavedSearchSchema>;
