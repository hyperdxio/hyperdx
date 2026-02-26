import { WebhookService } from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'mongodb';
import request, { SuperAgentTest } from 'supertest';

import { getLoggedInAgent, getServer } from '../../../fixtures';
import { ITeam } from '../../../models/team';
import { IUser } from '../../../models/user';
import Webhook from '../../../models/webhook';

const WEBHOOKS_BASE_URL = '/api/v2/webhooks';

const MOCK_SLACK_WEBHOOK = {
  name: 'Test Slack Webhook',
  service: WebhookService.Slack,
  url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
  description: 'Test webhook for Slack',
};

const MOCK_INCIDENT_IO_WEBHOOK = {
  name: 'Test IncidentIO Webhook',
  service: WebhookService.IncidentIO,
  url: 'https://api.incident.io/v2/alert_events/http/ZZZZZZZZ?token=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  description: 'Test webhook for incident.io',
};

const MOCK_GENERIC_WEBHOOK = {
  name: 'Test Generic Webhook',
  service: WebhookService.Generic,
  url: 'https://example.com/webhook',
  description: 'Test generic webhook',
  headers: { 'X-Custom-Header': 'Header Value', Authorization: 'Bearer token' },
  body: '{"text": "{{title}} | {{body}} | {{link}}"}',
};

describe('External API v2 Webhooks', () => {
  const server = getServer();
  let agent: SuperAgentTest;
  let team: ITeam;
  let user: IUser;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  const authRequest = (
    method: 'get' | 'post' | 'put' | 'delete',
    url: string,
  ) => {
    return agent[method](url).set('Authorization', `Bearer ${user?.accessKey}`);
  };

  describe('GET /api/v2/webhooks', () => {
    it('should return an empty list when no webhooks exist', async () => {
      const response = await authRequest('get', WEBHOOKS_BASE_URL).expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toEqual({ data: [] });
    });

    it('should list a Slack webhook with only Slack-allowed fields', async () => {
      await Webhook.create({ ...MOCK_SLACK_WEBHOOK, team: team._id });

      const response = await authRequest('get', WEBHOOKS_BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        id: expect.any(String),
        name: MOCK_SLACK_WEBHOOK.name,
        service: WebhookService.Slack,
        url: MOCK_SLACK_WEBHOOK.url,
        description: MOCK_SLACK_WEBHOOK.description,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(response.body.data[0]).not.toHaveProperty('headers');
      expect(response.body.data[0]).not.toHaveProperty('body');
    });

    it('should strip headers and body stored on a Slack webhook', async () => {
      await Webhook.create({
        ...MOCK_SLACK_WEBHOOK,
        headers: { 'X-Secret': 'secret' },
        body: '{"text": "hello"}',
        team: team._id,
      });

      const response = await authRequest('get', WEBHOOKS_BASE_URL).expect(200);

      expect(response.body.data[0]).not.toHaveProperty('headers');
      expect(response.body.data[0]).not.toHaveProperty('body');
    });

    it('should list an IncidentIO webhook with only IncidentIO-allowed fields', async () => {
      await Webhook.create({ ...MOCK_INCIDENT_IO_WEBHOOK, team: team._id });

      const response = await authRequest('get', WEBHOOKS_BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        id: expect.any(String),
        name: MOCK_INCIDENT_IO_WEBHOOK.name,
        service: WebhookService.IncidentIO,
        url: MOCK_INCIDENT_IO_WEBHOOK.url,
        description: MOCK_INCIDENT_IO_WEBHOOK.description,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(response.body.data[0]).not.toHaveProperty('headers');
      expect(response.body.data[0]).not.toHaveProperty('body');
    });

    it('should strip headers and body stored on an IncidentIO webhook', async () => {
      await Webhook.create({
        ...MOCK_INCIDENT_IO_WEBHOOK,
        headers: { 'X-Secret': 'secret' },
        body: '{"title": "{{title}}"}',
        team: team._id,
      });

      const response = await authRequest('get', WEBHOOKS_BASE_URL).expect(200);

      expect(response.body.data[0]).not.toHaveProperty('headers');
      expect(response.body.data[0]).not.toHaveProperty('body');
    });

    it('should list a Generic webhook with headers and body', async () => {
      await Webhook.create({ ...MOCK_GENERIC_WEBHOOK, team: team._id });

      const response = await authRequest('get', WEBHOOKS_BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        id: expect.any(String),
        name: MOCK_GENERIC_WEBHOOK.name,
        service: WebhookService.Generic,
        url: MOCK_GENERIC_WEBHOOK.url,
        description: MOCK_GENERIC_WEBHOOK.description,
        headers: MOCK_GENERIC_WEBHOOK.headers,
        body: MOCK_GENERIC_WEBHOOK.body,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('should return multiple webhooks of different service types', async () => {
      await Webhook.create({ ...MOCK_SLACK_WEBHOOK, team: team._id });
      await Webhook.create({ ...MOCK_INCIDENT_IO_WEBHOOK, team: team._id });
      await Webhook.create({ ...MOCK_GENERIC_WEBHOOK, team: team._id });

      const response = await authRequest('get', WEBHOOKS_BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(3);
      const names = response.body.data.map((w: { name: string }) => w.name);
      expect(names).toContain(MOCK_SLACK_WEBHOOK.name);
      expect(names).toContain(MOCK_INCIDENT_IO_WEBHOOK.name);
      expect(names).toContain(MOCK_GENERIC_WEBHOOK.name);
    });

    it('should not return webhooks belonging to another team', async () => {
      await Webhook.create({ ...MOCK_SLACK_WEBHOOK, team: team._id });

      const otherTeamId = new ObjectId();
      await Webhook.create({
        ...MOCK_SLACK_WEBHOOK,
        name: 'Other Team Webhook',
        team: otherTeamId,
      });

      const response = await authRequest('get', WEBHOOKS_BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe(MOCK_SLACK_WEBHOOK.name);
    });

    it('should work with a minimal Slack webhook (no optional fields)', async () => {
      await Webhook.create({
        name: 'Minimal Slack Webhook',
        service: WebhookService.Slack,
        team: team._id,
      });

      const response = await authRequest('get', WEBHOOKS_BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        id: expect.any(String),
        name: 'Minimal Slack Webhook',
        service: WebhookService.Slack,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(response.body.data[0]).not.toHaveProperty('url');
      expect(response.body.data[0]).not.toHaveProperty('description');
      expect(response.body.data[0]).not.toHaveProperty('headers');
      expect(response.body.data[0]).not.toHaveProperty('body');
    });

    it('should work with a minimal Generic webhook (no optional fields)', async () => {
      await Webhook.create({
        name: 'Minimal Generic Webhook',
        service: WebhookService.Generic,
        team: team._id,
      });

      const response = await authRequest('get', WEBHOOKS_BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        id: expect.any(String),
        name: 'Minimal Generic Webhook',
        service: WebhookService.Generic,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(response.body.data[0]).not.toHaveProperty('url');
      expect(response.body.data[0]).not.toHaveProperty('description');
      expect(response.body.data[0]).not.toHaveProperty('headers');
      expect(response.body.data[0]).not.toHaveProperty('body');
    });

    it('should require authentication', async () => {
      await request(server.getHttpServer()).get(WEBHOOKS_BASE_URL).expect(401);
    });
  });
});
