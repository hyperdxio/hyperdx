import mongoose from 'mongoose';

import { getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import TeamInvite from '@/models/teamInvite';
import Webhook, { WebhookService } from '@/models/webhook';

/**
 * FerretDB Regression Suite
 *
 * These tests exercise findOneAndUpdate, findOneAndDelete, and
 * findByIdAndDelete operations that may trigger the FerretDB
 * "findAndModify + fields" error.
 *
 * Operations that previously used projection/select with findAndModify
 * have been refactored to avoid the FerretDB "fields" limitation.
 */
describe('FerretDB regression - findAndModify operations', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('findOneAndUpdate with select option', () => {
    it(
      'webhook update with projection (excludes __v and team)',
      async () => {
        const { agent, team } = await getLoggedInAgent(server);

        const webhook = await Webhook.create({
          name: 'Test Webhook',
          service: WebhookService.Slack,
          url: 'https://hooks.slack.com/services/T00/B00/XXX',
          team: team._id,
        });

        const response = await agent
          .put(`/webhooks/${webhook._id}`)
          .send({
            name: 'Updated Webhook',
            service: WebhookService.Slack,
            url: 'https://hooks.slack.com/services/T00/B00/XXX',
          })
          .expect(200);

        // The response should not contain __v or team (projection)
        expect(response.body.data).toBeDefined();
        expect(response.body.data.__v).toBeUndefined();
        expect(response.body.data.team).toBeUndefined();
        expect(response.body.data.name).toBe('Updated Webhook');
      },
    );

    it(
      'connection update with findOneAndUpdate',
      async () => {
        const { agent, team } = await getLoggedInAgent(server);

        const connection = await Connection.create({
          name: 'Test Connection',
          host: 'localhost:9000',
          username: 'default',
          password: 'test-password',
          team: team._id,
        });

        await agent
          .put(`/connections/${connection._id}`)
          .send({
            name: 'Updated Connection',
            host: 'localhost:9000',
            username: 'default',
            password: 'test-password',
            id: connection._id.toString(),
          })
          .expect(200);

        // Verify the update was applied
        const updated = await Connection.findById(connection._id);
        expect(updated?.name).toBe('Updated Connection');
      },
    );
  });

  describe('findOneAndDelete operations', () => {
    it('webhook findOneAndDelete', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const webhook = await Webhook.create({
        name: 'Delete Me',
        service: WebhookService.Slack,
        url: 'https://hooks.slack.com/services/T00/B00/DELETE',
        team: team._id,
      });

      await agent.delete(`/webhooks/${webhook._id}`).expect(200);

      const deleted = await Webhook.findById(webhook._id);
      expect(deleted).toBeNull();
    });

    it('dashboard findOneAndDelete', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const dashboard = await Dashboard.create({
        name: 'Delete Me',
        tiles: [],
        team: team._id,
      });

      await agent.delete(`/dashboards/${dashboard._id}`).expect(204);

      const deleted = await Dashboard.findById(dashboard._id);
      expect(deleted).toBeNull();
    });

    it('connection findOneAndDelete', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const connection = await Connection.create({
        name: 'Delete Me',
        host: 'localhost:9000',
        username: 'default',
        password: 'test-password',
        team: team._id,
      });

      await agent.delete(`/connections/${connection._id}`).expect(200);

      const deleted = await Connection.findById(connection._id);
      expect(deleted).toBeNull();
    });

    it('savedSearch findOneAndDelete', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      // Create a source first (required for saved search)
      const connection = await Connection.create({
        name: 'Test Conn',
        host: 'localhost:9000',
        username: 'default',
        password: 'test-password',
        team: team._id,
      });

      await agent
        .post('/sources')
        .send({
          team: team._id.toString(),
          kind: 'log',
          name: 'Test Source',
          connection: connection._id.toString(),
          from: {
            databaseName: 'system',
            tableName: 'query_log',
          },
          timestampValueExpression: 'event_date',
          defaultTableSelectExpression: 'event_date,query',
          id: 'test-source-1',
        })
        .expect(200);

      // Get the source to use its ID
      const sourcesResp = await agent.get('/sources').expect(200);
      const sourceId = sourcesResp.body[0]._id;

      // Create a saved search
      const createResp = await agent
        .post('/saved-search')
        .send({
          name: 'Delete Me',
          select: 'SELECT * FROM table',
          where: '',
          whereLanguage: 'sql',
          source: sourceId,
          tags: [],
        })
        .expect(200);

      const savedSearchId = createResp.body._id;

      await agent.delete(`/saved-search/${savedSearchId}`).expect(204);

      const deleted = await SavedSearch.findById(savedSearchId);
      expect(deleted).toBeNull();
    });

    it('teamInvite findByIdAndDelete', async () => {
      const { team } = await getLoggedInAgent(server);

      const invite = await TeamInvite.create({
        email: 'delete-test@example.com',
        teamId: team._id,
        token: 'test-delete-token',
      });

      // Directly test the model operation that root.ts performs
      await TeamInvite.findByIdAndDelete(invite._id);

      const deleted = await TeamInvite.findById(invite._id);
      expect(deleted).toBeNull();
    });
  });
});
