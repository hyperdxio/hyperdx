import { Types } from 'mongoose';

import { getLoggedInAgent, getServer } from '@/fixtures';
import Webhook, { WebhookService } from '@/models/webhook';

const MOCK_WEBHOOK = {
  name: 'Test Webhook',
  service: WebhookService.Slack,
  url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
  description: 'Test webhook for Slack',
  queryParams: { param1: 'value1' },
  headers: { 'X-Custom-Header': 'Header Value' },
  body: '{"text": "Test message"}',
};

describe('webhooks router', () => {
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

  it('GET / - returns webhooks filtered by service', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create test webhook
    await Webhook.create({
      ...MOCK_WEBHOOK,
      team: team._id,
    });

    // Create a webhook for a different service
    await Webhook.create({
      ...MOCK_WEBHOOK,
      service: WebhookService.Generic,
      url: 'https://example.com/webhook/generic',
      team: team._id,
    });

    // Get webhooks for Slack
    const response = await agent
      .get('/webhooks')
      .query({ service: WebhookService.Slack })
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      name: MOCK_WEBHOOK.name,
      service: MOCK_WEBHOOK.service,
      url: MOCK_WEBHOOK.url,
    });

    // Get webhooks for multiple services
    const multiResponse = await agent
      .get('/webhooks')
      .query({ service: [WebhookService.Slack, WebhookService.Generic] })
      .expect(200);

    expect(multiResponse.body.data).toHaveLength(2);
  });

  it('GET / - returns empty array when no webhooks exist', async () => {
    const { agent } = await getLoggedInAgent(server);

    const response = await agent
      .get('/webhooks')
      .query({ service: WebhookService.Slack })
      .expect(200);

    expect(response.body.data).toEqual([]);
  });

  it('POST / - creates a new webhook', async () => {
    const { agent } = await getLoggedInAgent(server);

    const response = await agent
      .post('/webhooks')
      .send(MOCK_WEBHOOK)
      .expect(200);

    expect(response.body.data).toMatchObject({
      name: MOCK_WEBHOOK.name,
      service: MOCK_WEBHOOK.service,
      url: MOCK_WEBHOOK.url,
      description: MOCK_WEBHOOK.description,
    });

    // Verify webhook was created in database
    const webhooks = await Webhook.find({});
    expect(webhooks).toHaveLength(1);
  });

  it('POST / - returns 400 when webhook with same URL already exists', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create webhook first
    await Webhook.create({
      ...MOCK_WEBHOOK,
      team: team._id,
    });

    // Try to create the same webhook again
    const response = await agent
      .post('/webhooks')
      .send(MOCK_WEBHOOK)
      .expect(400);

    expect(response.body.message).toBe('Webhook already exists');

    // Verify only one webhook exists
    const webhooks = await Webhook.find({});
    expect(webhooks).toHaveLength(1);
  });

  it('POST / - returns 400 when request body is invalid', async () => {
    const { agent } = await getLoggedInAgent(server);

    // Missing required fields
    await agent
      .post('/webhooks')
      .send({
        name: 'Invalid Webhook',
      })
      .expect(400);

    // Invalid URL
    await agent
      .post('/webhooks')
      .send({
        ...MOCK_WEBHOOK,
        url: 'not-a-url',
      })
      .expect(400);

    // Invalid service
    await agent
      .post('/webhooks')
      .send({
        ...MOCK_WEBHOOK,
        service: 'INVALID_SERVICE',
      })
      .expect(400);
  });

  it('DELETE /:id - deletes a webhook', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create test webhook
    const webhook = await Webhook.create({
      ...MOCK_WEBHOOK,
      team: team._id,
    });

    await agent.delete(`/webhooks/${webhook._id}`).expect(200);

    // Verify webhook was deleted
    const deletedWebhook = await Webhook.findById(webhook._id);
    expect(deletedWebhook).toBeNull();
  });

  it('DELETE /:id - returns 200 when webhook does not exist', async () => {
    const { agent } = await getLoggedInAgent(server);

    const nonExistentId = new Types.ObjectId().toString();

    // This will succeed even if the ID doesn't exist, consistent with the implementation
    await agent.delete(`/webhooks/${nonExistentId}`).expect(200);
  });

  it('DELETE /:id - returns 400 when ID is invalid', async () => {
    const { agent } = await getLoggedInAgent(server);

    await agent.delete('/webhooks/invalid-id').expect(400);
  });

  describe('Header validation', () => {
    it('POST / - accepts valid header names', async () => {
      const { agent } = await getLoggedInAgent(server);

      const validHeaders = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token',
        'X-Custom-Header': 'value',
        'User-Agent': 'test',
        'x-api-key': 'secret',
        'custom!header#test': 'value',
      };

      const response = await agent
        .post('/webhooks')
        .send({
          ...MOCK_WEBHOOK,
          url: 'https://example.com/valid-headers',
          headers: validHeaders,
        })
        .expect(200);

      expect(response.body.data.headers).toMatchObject(validHeaders);
    });

    it('POST / - rejects header names starting with numbers', async () => {
      const { agent } = await getLoggedInAgent(server);

      const response = await agent
        .post('/webhooks')
        .send({
          ...MOCK_WEBHOOK,
          url: 'https://example.com/invalid-header-name',
          headers: {
            '123Invalid': 'value',
          },
        })
        .expect(400);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].type).toBe('Body');
      expect(response.body[0].errors).toBeDefined();
    });

    it('POST / - rejects empty header names', async () => {
      const { agent } = await getLoggedInAgent(server);

      const response = await agent
        .post('/webhooks')
        .send({
          ...MOCK_WEBHOOK,
          url: 'https://example.com/empty-header-name',
          headers: {
            '': 'value',
          },
        })
        .expect(400);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].type).toBe('Body');
      expect(response.body[0].errors).toBeDefined();
    });

    it('POST / - rejects header names with invalid characters', async () => {
      const { agent } = await getLoggedInAgent(server);

      const invalidHeaderNames = [
        { 'Header Name': 'value' }, // space
        { 'Header\nName': 'value' }, // newline
        { 'Header\rName': 'value' }, // carriage return
        { 'Header\tName': 'value' }, // tab
        { 'Header@Name': 'value' }, // @ not allowed
        { 'Header[Name]': 'value' }, // brackets not allowed
      ];

      for (const headers of invalidHeaderNames) {
        const response = await agent
          .post('/webhooks')
          .send({
            ...MOCK_WEBHOOK,
            url: `https://example.com/invalid-header-${Math.random()}`,
            headers,
          })
          .expect(400);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body[0].type).toBe('Body');
        expect(response.body[0].errors).toBeDefined();
      }
    });

    it('POST / - accepts valid header values', async () => {
      const { agent } = await getLoggedInAgent(server);

      const validHeaders = {
        Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Api-Key': 'abc123-def456-ghi789',
        'User-Agent': 'Mozilla/5.0 (compatible; TestBot/1.0)',
        'Custom-Header': 'value with spaces and special chars: !@#$%^&*()',
      };

      const response = await agent
        .post('/webhooks')
        .send({
          ...MOCK_WEBHOOK,
          url: 'https://example.com/valid-header-values',
          headers: validHeaders,
        })
        .expect(200);

      expect(response.body.data.headers).toMatchObject(validHeaders);
    });

    it('POST / - rejects header values with CRLF injection', async () => {
      const { agent } = await getLoggedInAgent(server);

      const response = await agent
        .post('/webhooks')
        .send({
          ...MOCK_WEBHOOK,
          url: 'https://example.com/crlf-injection',
          headers: {
            'X-Custom-Header': 'value\r\nX-Injected-Header: malicious',
          },
        })
        .expect(400);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].type).toBe('Body');
      expect(response.body[0].errors).toBeDefined();
    });

    it('POST / - rejects header values with tab characters', async () => {
      const { agent } = await getLoggedInAgent(server);

      const response = await agent
        .post('/webhooks')
        .send({
          ...MOCK_WEBHOOK,
          url: 'https://example.com/tab-injection',
          headers: {
            'X-Custom-Header': 'value\twith\ttabs',
          },
        })
        .expect(400);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].type).toBe('Body');
      expect(response.body[0].errors).toBeDefined();
    });

    it('POST / - rejects header values with control characters', async () => {
      const { agent } = await getLoggedInAgent(server);

      // Test various control characters
      const controlCharTests = [
        '\x00', // null
        '\x01', // start of heading
        '\x0B', // vertical tab
        '\x0C', // form feed
        '\x1F', // unit separator
        '\x7F', // delete
      ];

      for (const controlChar of controlCharTests) {
        const response = await agent
          .post('/webhooks')
          .send({
            ...MOCK_WEBHOOK,
            url: `https://example.com/control-char-${Math.random()}`,
            headers: {
              'X-Custom-Header': `value${controlChar}test`,
            },
          })
          .expect(400);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body[0].type).toBe('Body');
        expect(response.body[0].errors).toBeDefined();
      }
    });

    it('POST / - rejects header values with newline characters', async () => {
      const { agent } = await getLoggedInAgent(server);

      const response = await agent
        .post('/webhooks')
        .send({
          ...MOCK_WEBHOOK,
          url: 'https://example.com/newline-injection',
          headers: {
            'X-Custom-Header': 'value\nwith\nnewlines',
          },
        })
        .expect(400);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].type).toBe('Body');
      expect(response.body[0].errors).toBeDefined();
    });

    it('POST / - rejects header values with carriage return characters', async () => {
      const { agent } = await getLoggedInAgent(server);

      const response = await agent
        .post('/webhooks')
        .send({
          ...MOCK_WEBHOOK,
          url: 'https://example.com/carriage-return-injection',
          headers: {
            'X-Custom-Header': 'value\rwith\rcarriage\rreturns',
          },
        })
        .expect(400);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].type).toBe('Body');
      expect(response.body[0].errors).toBeDefined();
    });
  });
});
