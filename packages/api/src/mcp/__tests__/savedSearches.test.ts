import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import { McpContext } from '@/mcp/tools/types';
import Connection from '@/models/connection';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

describe('MCP Saved Search Tools', () => {
  const server = getServer();
  let team: any;
  let user: any;
  let connection: any;
  let traceSource: any;
  let client: Client;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    team = result.team;
    user = result.user;

    connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    traceSource = await Source.create({
      kind: SourceKind.Trace,
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_TRACES_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Traces',
    });

    const context: McpContext = {
      teamId: team._id.toString(),
      userId: user._id.toString(),
    };
    client = await createTestClient(context);
  });

  afterEach(async () => {
    await client?.close();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  // ─── helpers ──────────────────────────────────────────────────────────────

  async function createTestSavedSearch(
    overrides: Record<string, unknown> = {},
  ) {
    return SavedSearch.create({
      team: team._id,
      name: 'Test Saved Search',
      source: traceSource._id,
      select: '',
      where: 'StatusCode:Error',
      whereLanguage: 'lucene',
      tags: ['test'],
      createdBy: user._id,
      updatedBy: user._id,
      ...overrides,
    });
  }

  // ─── clickstack_get_saved_search ─────────────────────────────────────────────

  describe('clickstack_get_saved_search', () => {
    describe('list (no id)', () => {
      it('should list all saved searches with slim summary fields', async () => {
        await createTestSavedSearch({ name: 'Search 1' });
        await createTestSavedSearch({ name: 'Search 2' });

        const result = await callTool(
          client,
          'clickstack_get_saved_search',
          {},
        );

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output).toHaveLength(2);

        // Slim summary fields present
        expect(output[0]).toHaveProperty('id');
        expect(output[0]).toHaveProperty('name');
        expect(output[0]).toHaveProperty('tags');

        // Detail fields should NOT be present in list mode
        expect(output[0]).not.toHaveProperty('where');
        expect(output[0]).not.toHaveProperty('whereLanguage');
        expect(output[0]).not.toHaveProperty('sourceId');
        expect(output[0]).not.toHaveProperty('select');
        expect(output[0]).not.toHaveProperty('filters');
      });

      it('should return empty array when no saved searches exist', async () => {
        const result = await callTool(
          client,
          'clickstack_get_saved_search',
          {},
        );

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output).toHaveLength(0);
      });

      it('should scope saved searches to the team', async () => {
        await createTestSavedSearch({ name: 'Team Scoped' });

        const otherTeamContext: McpContext = {
          teamId: '000000000000000000000099',
          userId: user._id.toString(),
        };
        const client2 = await createTestClient(otherTeamContext);

        const listResult = await callTool(
          client2,
          'clickstack_get_saved_search',
          {},
        );
        const output = JSON.parse(getFirstText(listResult));
        expect(output).toHaveLength(0);

        await client2.close();
      });
    });

    describe('detail (with id)', () => {
      it('should get full saved search detail when id is provided', async () => {
        const savedSearch = await createTestSavedSearch({
          name: 'Detail Test',
          where: 'level:error',
        });

        const result = await callTool(client, 'clickstack_get_saved_search', {
          id: savedSearch._id.toString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        // External format uses 'id' not '_id'
        expect(output.id).toBe(savedSearch._id.toString());
        expect(output).not.toHaveProperty('_id');
        expect(output.name).toBe('Detail Test');
        expect(output.where).toBe('level:error');
        // Full detail includes fields not in the list summary
        expect(output).toHaveProperty('sourceId');
        expect(output).toHaveProperty('whereLanguage');
        expect(output).toHaveProperty('tags');
        expect(output).toHaveProperty('teamId');
        expect(output).toHaveProperty('createdAt');
      });

      it('should return error for invalid ObjectId format', async () => {
        const result = await callTool(client, 'clickstack_get_saved_search', {
          id: 'not-a-valid-id',
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Invalid saved search ID');
      });

      it('should return error for non-existent saved search id', async () => {
        const fakeId = '000000000000000000000000';
        const result = await callTool(client, 'clickstack_get_saved_search', {
          id: fakeId,
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Saved search not found');
      });
    });
  });

  // ─── clickstack_save_saved_search ────────────────────────────────────────────

  describe('clickstack_save_saved_search', () => {
    describe('create', () => {
      it('should create a new saved search', async () => {
        const result = await callTool(client, 'clickstack_save_saved_search', {
          name: 'Error Traces',
          sourceId: traceSource._id.toString(),
          where: 'StatusCode:Error',
          whereLanguage: 'lucene',
          tags: ['errors'],
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        // External format uses 'id' not '_id'
        expect(output.id).toBeDefined();
        expect(output).not.toHaveProperty('_id');
        expect(output.name).toBe('Error Traces');
        expect(output.where).toBe('StatusCode:Error');
        expect(output.whereLanguage).toBe('lucene');
        expect(output.tags).toEqual(['errors']);

        // Verify in database
        const savedSearch = await SavedSearch.findById(output.id);
        expect(savedSearch).not.toBeNull();
        expect(savedSearch?.name).toBe('Error Traces');
      });

      it('should create a saved search with minimal fields', async () => {
        const result = await callTool(client, 'clickstack_save_saved_search', {
          name: 'Minimal Search',
          sourceId: traceSource._id.toString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.name).toBe('Minimal Search');
        expect(output.where).toBe('');
        expect(output.select).toBe('');
        expect(output.tags).toEqual([]);
      });

      it('should create a saved search with SQL where language', async () => {
        const result = await callTool(client, 'clickstack_save_saved_search', {
          name: 'SQL Search',
          sourceId: traceSource._id.toString(),
          where: "StatusCode = 'Error'",
          whereLanguage: 'sql',
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.whereLanguage).toBe('sql');
        expect(output.where).toBe("StatusCode = 'Error'");
      });

      it('should create a saved search with select and orderBy', async () => {
        const result = await callTool(client, 'clickstack_save_saved_search', {
          name: 'Full Search',
          sourceId: traceSource._id.toString(),
          select: 'body,service.name,duration',
          where: 'StatusCode:Error',
          orderBy: 'Timestamp DESC',
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.select).toBe('body,service.name,duration');
        expect(output.orderBy).toBe('Timestamp DESC');
      });

      it('should create a saved search with filters', async () => {
        const result = await callTool(client, 'clickstack_save_saved_search', {
          name: 'Filtered Search',
          sourceId: traceSource._id.toString(),
          filters: [
            { type: 'lucene', condition: 'level:error' },
            {
              type: 'sql_ast',
              operator: '=',
              left: 'StatusCode',
              right: 'Error',
            },
          ],
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.filters).toHaveLength(2);
        expect(output.filters[0].type).toBe('lucene');
        expect(output.filters[1].type).toBe('sql_ast');
      });

      it('should reject invalid sourceId', async () => {
        const result = await callTool(client, 'clickstack_save_saved_search', {
          name: 'Bad Source',
          sourceId: 'not-a-valid-id',
        });

        expect(result.isError).toBe(true);
        const text = getFirstText(result);
        expect(text).toContain('Invalid ObjectId');
        expect(text).toContain('sourceId');
      });

      it('should include url in response when FRONTEND_URL is set', async () => {
        const result = await callTool(client, 'clickstack_save_saved_search', {
          name: 'URL Test',
          sourceId: traceSource._id.toString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        if (config.FRONTEND_URL) {
          expect(output.url).toContain('/search/');
        }
      });
    });

    describe('update', () => {
      it('should update an existing saved search', async () => {
        const savedSearch = await createTestSavedSearch({
          name: 'Original Name',
        });

        const result = await callTool(client, 'clickstack_save_saved_search', {
          id: savedSearch._id.toString(),
          name: 'Updated Name',
          sourceId: traceSource._id.toString(),
          where: 'StatusCode:Ok',
          tags: ['updated'],
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.id).toBe(savedSearch._id.toString());
        expect(output).not.toHaveProperty('_id');
        expect(output.name).toBe('Updated Name');
        expect(output.where).toBe('StatusCode:Ok');
        expect(output.tags).toEqual(['updated']);

        // Verify in database
        const updated = await SavedSearch.findById(savedSearch._id);
        expect(updated?.name).toBe('Updated Name');
        expect(updated?.where).toBe('StatusCode:Ok');
      });

      it('should return error for non-existent saved search on update', async () => {
        const fakeId = '000000000000000000000000';
        const result = await callTool(client, 'clickstack_save_saved_search', {
          id: fakeId,
          name: 'Ghost Search',
          sourceId: traceSource._id.toString(),
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Saved search not found');
      });

      it('should return error for invalid ObjectId format on update', async () => {
        const result = await callTool(client, 'clickstack_save_saved_search', {
          id: '!!!',
          name: 'Bad ID',
          sourceId: traceSource._id.toString(),
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Invalid saved search ID');
      });
    });
  });
});
