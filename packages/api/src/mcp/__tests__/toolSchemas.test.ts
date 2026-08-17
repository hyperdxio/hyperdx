import Ajv2020 from 'ajv/dist/2020';

import { McpContext } from '@/mcp/tools/types';

import { createTestClient } from './mcpTestUtils';

/**
 * Every MCP tool's `inputSchema` must be valid JSON Schema draft 2020-12.
 *
 * Clients that forward tool schemas straight to an LLM provider validate them
 * against the 2020-12 metaschema and reject the ENTIRE tool list when any one
 * schema fails — so a single bad tool takes the whole server down for that
 * client, with an error that only identifies the tool by index.
 *
 * The trap is that the MCP SDK converts our Zod v3 schemas with
 * `zod-to-json-schema`, which emits draft-07 output. Most of that output is
 * also valid 2020-12, but not all of it: `z.tuple([...])` renders as
 * `items: [ ... ]`, and in 2020-12 `items` must be a schema rather than an
 * array (tuple validation moved to `prefixItems`). This test exists to catch
 * that class of mismatch at CI time instead of in a user's client.
 */
describe('MCP tool input schemas', () => {
  // The tools/list response is built purely from the registered Zod schemas,
  // so no database or ClickHouse fixtures are needed here.
  const context: McpContext = { teamId: 'team-id', userId: 'user-id' };

  // `strict: false` keeps Ajv from complaining about the vocabulary quirks of
  // machine-generated schemas (unknown keywords, `additionalItems`, etc.).
  // Schema-level draft-2020-12 conformance is still enforced.
  const ajv = new Ajv2020({ strict: false });

  it('are all valid JSON Schema draft 2020-12', async () => {
    const client = await createTestClient(context);
    const { tools } = await client.listTools();

    // Guard against a registration regression silently emptying the list and
    // making the assertions below vacuously true.
    expect(tools.length).toBeGreaterThan(0);

    const invalid = tools.flatMap(tool => {
      // The SDK stamps `$schema: draft-07` on every converted schema; Ajv2020
      // cannot resolve that meta-schema URI, and the declaration itself is not
      // what strict clients object to. Drop it and check the schema body.
      const { $schema: _$schema, ...schema } = tool.inputSchema;

      try {
        ajv.compile(schema);
        return [];
      } catch (e) {
        return [`${tool.name}: ${e instanceof Error ? e.message : String(e)}`];
      }
    });

    expect(invalid).toEqual([]);
  });
});
