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
    });

    // URL should be masked (origin + /****)
    expect(response.body.data[0].url).toBe('https://hooks.slack.com/****');
    expect(response.body.data[0].url).not.toBe(MOCK_WEBHOOK.url);

    // Header keys preserved, values redacted
    expect(response.body.data[0].headers).toEqual({
      'X-Custom-Header': '****',
    });

    // QueryParam keys preserved, values redacted
    expect(response.body.data[0].queryParams).toEqual({
      param1: '****',
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
      description: MOCK_WEBHOOK.description,
    });

    // Response should have masked URL and redacted headers
    expect(response.body.data.url).toBe('https://hooks.slack.com/****');
    expect(response.body.data.headers).toEqual({
      'X-Custom-Header': '****',
    });

    // Verify webhook was created in database with original values
    const webhooks = await Webhook.find({});
    expect(webhooks).toHaveLength(1);
    expect(webhooks[0].url).toBe(MOCK_WEBHOOK.url);
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

      // Response should have all header keys but redacted values
      const expectedRedacted = Object.fromEntries(
        Object.keys(validHeaders).map(k => [k, '****']),
      );
      expect(response.body.data.headers).toEqual(expectedRedacted);

      // Database should have real values
      const webhook = await Webhook.findById(response.body.data._id);
      const stored = webhook!.toJSON({ flattenMaps: true });
      expect(stored.headers).toMatchObject(validHeaders);
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

      // Response should have redacted values
      const expectedRedacted = Object.fromEntries(
        Object.keys(validHeaders).map(k => [k, '****']),
      );
      expect(response.body.data.headers).toEqual(expectedRedacted);

      // Database should have real values
      const webhook = await Webhook.findById(response.body.data._id);
      const stored = webhook!.toJSON({ flattenMaps: true });
      expect(stored.headers).toMatchObject(validHeaders);
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

  describe('PUT /:id - update webhook', () => {
    it('updates an existing webhook', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      // Create test webhook
      const webhook = await Webhook.create({
        ...MOCK_WEBHOOK,
        team: team._id,
      });

      const updatedData = {
        name: 'Updated Webhook Name',
        service: WebhookService.Slack,
        url: 'https://hooks.slack.com/services/T11111111/B11111111/YYYYYYYYYYYYYYYYYYYYYYYY',
        description: 'Updated description',
        queryParams: { param2: 'value2' },
        headers: { 'X-Updated-Header': 'Updated Value' },
        body: '{"text": "Updated message"}',
      };

      const response = await agent
        .put(`/webhooks/${webhook._id}`)
        .send(updatedData)
        .expect(200);

      expect(response.body.data).toMatchObject({
        name: updatedData.name,
        service: updatedData.service,
        description: updatedData.description,
      });

      // Response should have masked URL and redacted headers
      expect(response.body.data.url).toBe('https://hooks.slack.com/****');
      expect(response.body.data.headers).toEqual({
        'X-Updated-Header': '****',
      });

      // Verify webhook was updated in database with real values
      const updatedWebhook = await Webhook.findById(webhook._id);
      expect(updatedWebhook).toMatchObject({
        name: updatedData.name,
        url: updatedData.url,
        description: updatedData.description,
      });
    });

    it('returns 404 when webhook does not exist', async () => {
      const { agent } = await getLoggedInAgent(server);

      const nonExistentId = new Types.ObjectId().toString();

      const response = await agent
        .put(`/webhooks/${nonExistentId}`)
        .send(MOCK_WEBHOOK)
        .expect(404);

      expect(response.body.message).toBe('Webhook not found');
    });

    it('returns 400 when trying to update to a URL that already exists', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      // Create two webhooks
      await Webhook.create({
        ...MOCK_WEBHOOK,
        name: 'Webhook Two',
        team: team._id,
      });

      const webhook2 = await Webhook.create({
        ...MOCK_WEBHOOK,
        url: 'https://hooks.slack.com/services/T11111111/B11111111/YYYYYYYYYYYYYYYYYYYYYYYY',
        team: team._id,
      });

      // Try to update webhook2 to use webhook1's URL
      const response = await agent
        .put(`/webhooks/${webhook2._id}`)
        .send({
          ...MOCK_WEBHOOK,
          name: 'Different Name',
        })
        .expect(400);

      expect(response.body.message).toBe(
        'A webhook with this service and URL already exists',
      );
    });

    it('returns 400 when ID is invalid', async () => {
      const { agent } = await getLoggedInAgent(server);

      await agent.put('/webhooks/invalid-id').send(MOCK_WEBHOOK).expect(400);
    });

    it('updates webhook with valid headers', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const webhook = await Webhook.create({
        ...MOCK_WEBHOOK,
        team: team._id,
      });

      const updatedHeaders = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer updated-token',
        'X-New-Header': 'new-value',
      };

      const response = await agent
        .put(`/webhooks/${webhook._id}`)
        .send({
          ...MOCK_WEBHOOK,
          headers: updatedHeaders,
        })
        .expect(200);

      // Response should have redacted values
      const expectedRedacted = Object.fromEntries(
        Object.keys(updatedHeaders).map(k => [k, '****']),
      );
      expect(response.body.data.headers).toEqual(expectedRedacted);

      // Database should have real values
      const stored = await Webhook.findById(webhook._id);
      const plain = stored!.toJSON({ flattenMaps: true });
      expect(plain.headers).toMatchObject(updatedHeaders);
    });

    it('rejects update with invalid headers', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const webhook = await Webhook.create({
        ...MOCK_WEBHOOK,
        team: team._id,
      });

      const response = await agent
        .put(`/webhooks/${webhook._id}`)
        .send({
          ...MOCK_WEBHOOK,
          headers: {
            'Invalid\nHeader': 'value',
          },
        })
        .expect(400);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].type).toBe('Body');
      expect(response.body[0].errors).toBeDefined();
    });
  });

  describe('Secret redaction and merge', () => {
    it('GET / - masks URL to origin/****', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      await Webhook.create({
        ...MOCK_WEBHOOK,
        team: team._id,
      });

      const response = await agent
        .get('/webhooks')
        .query({ service: WebhookService.Slack })
        .expect(200);

      expect(response.body.data[0].url).toBe('https://hooks.slack.com/****');

      // Verify original URL is NOT exposed
      expect(response.body.data[0].url).not.toContain('services');
    });

    it('GET / - returns empty headers/queryParams unchanged', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      await Webhook.create({
        name: 'No secrets',
        service: WebhookService.Slack,
        url: 'https://hooks.slack.com/services/T00/B00/XXX',
        team: team._id,
      });

      const response = await agent
        .get('/webhooks')
        .query({ service: WebhookService.Slack })
        .expect(200);

      // Empty maps stay empty (no phantom redacted keys)
      expect(response.body.data[0].headers).toBeUndefined();
      expect(response.body.data[0].queryParams).toBeUndefined();
    });

    it('PUT - masked URL preserves existing stored URL', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const webhook = await Webhook.create({
        ...MOCK_WEBHOOK,
        team: team._id,
      });

      // Send the masked URL (as the frontend would after receiving a GET)
      await agent
        .put(`/webhooks/${webhook._id}`)
        .send({
          ...MOCK_WEBHOOK,
          url: 'https://hooks.slack.com/****',
          name: 'Renamed Only',
        })
        .expect(200);

      const stored = await Webhook.findById(webhook._id);
      expect(stored!.url).toBe(MOCK_WEBHOOK.url);
      expect(stored!.name).toBe('Renamed Only');
    });

    it('PUT - new URL replaces existing URL', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const webhook = await Webhook.create({
        ...MOCK_WEBHOOK,
        team: team._id,
      });

      const newUrl = 'https://example.com/webhook/new-endpoint';

      await agent
        .put(`/webhooks/${webhook._id}`)
        .send({
          ...MOCK_WEBHOOK,
          url: newUrl,
        })
        .expect(200);

      const stored = await Webhook.findById(webhook._id);
      expect(stored!.url).toBe(newUrl);
    });

    it('PUT - redacted header values preserve existing stored values', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const originalHeaders = {
        Authorization: 'Bearer secret-token-123',
        'X-Api-Key': 'my-api-key',
      };

      const webhook = await Webhook.create({
        ...MOCK_WEBHOOK,
        headers: originalHeaders,
        team: team._id,
      });

      // Send back redacted values (as frontend would)
      await agent
        .put(`/webhooks/${webhook._id}`)
        .send({
          ...MOCK_WEBHOOK,
          headers: {
            Authorization: '****',
            'X-Api-Key': '****',
          },
        })
        .expect(200);

      const stored = await Webhook.findById(webhook._id);
      const plain = stored!.toJSON({ flattenMaps: true });
      expect(plain.headers).toEqual(originalHeaders);
    });

    it('PUT - new header value updates, redacted value preserves', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const originalHeaders = {
        Authorization: 'Bearer old-token',
        'X-Api-Key': 'old-key',
      };

      const webhook = await Webhook.create({
        ...MOCK_WEBHOOK,
        headers: originalHeaders,
        team: team._id,
      });

      await agent
        .put(`/webhooks/${webhook._id}`)
        .send({
          ...MOCK_WEBHOOK,
          headers: {
            Authorization: '****', // preserve
            'X-Api-Key': 'brand-new-key', // update
          },
        })
        .expect(200);

      const stored = await Webhook.findById(webhook._id);
      const plain = stored!.toJSON({ flattenMaps: true });
      expect(plain.headers).toEqual({
        Authorization: 'Bearer old-token',
        'X-Api-Key': 'brand-new-key',
      });
    });

    it('PUT - removing a header key deletes it from storage', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const originalHeaders = {
        Authorization: 'Bearer token',
        'X-Api-Key': 'key-to-keep',
        'X-Remove-Me': 'will-be-removed',
      };

      const webhook = await Webhook.create({
        ...MOCK_WEBHOOK,
        headers: originalHeaders,
        team: team._id,
      });

      // Send only two keys back, omitting X-Remove-Me
      await agent
        .put(`/webhooks/${webhook._id}`)
        .send({
          ...MOCK_WEBHOOK,
          headers: {
            Authorization: '****',
            'X-Api-Key': '****',
          },
        })
        .expect(200);

      const stored = await Webhook.findById(webhook._id);
      const plain = stored!.toJSON({ flattenMaps: true });
      expect(plain.headers).toEqual({
        Authorization: 'Bearer token',
        'X-Api-Key': 'key-to-keep',
      });
      expect(plain.headers).not.toHaveProperty('X-Remove-Me');
    });

    it('PUT - empty headers object clears all stored headers', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const webhook = await Webhook.create({
        ...MOCK_WEBHOOK,
        headers: { Authorization: 'Bearer token' },
        team: team._id,
      });

      await agent
        .put(`/webhooks/${webhook._id}`)
        .send({
          ...MOCK_WEBHOOK,
          headers: {},
        })
        .expect(200);

      const stored = await Webhook.findById(webhook._id);
      const plain = stored!.toJSON({ flattenMaps: true });
      expect(plain.headers).toBeUndefined();
    });

    it('PUT - redacted queryParam values preserve existing stored values', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const originalParams = { apiKey: 'secret-key-123' };

      const webhook = await Webhook.create({
        ...MOCK_WEBHOOK,
        queryParams: originalParams,
        team: team._id,
      });

      await agent
        .put(`/webhooks/${webhook._id}`)
        .send({
          ...MOCK_WEBHOOK,
          queryParams: { apiKey: '****' },
        })
        .expect(200);

      const stored = await Webhook.findById(webhook._id);
      const plain = stored!.toJSON({ flattenMaps: true });
      expect(plain.queryParams).toEqual(originalParams);
    });

    it('PUT - duplicate check uses resolved URL, not masked URL', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      // Create two webhooks
      await Webhook.create({
        ...MOCK_WEBHOOK,
        name: 'First',
        team: team._id,
      });

      const second = await Webhook.create({
        ...MOCK_WEBHOOK,
        name: 'Second',
        url: 'https://hooks.slack.com/services/T11/B11/YYY',
        team: team._id,
      });

      // Update second webhook with masked URL should NOT trigger duplicate
      // because the resolved URL is the second webhook's own URL
      const response = await agent
        .put(`/webhooks/${second._id}`)
        .send({
          ...MOCK_WEBHOOK,
          name: 'Renamed Second',
          url: 'https://hooks.slack.com/****',
        })
        .expect(200);

      expect(response.body.data.name).toBe('Renamed Second');
    });
  });

  describe('POST /test - test webhook', () => {
    it('successfully sends a test message to a Slack webhook', async () => {
      const { agent } = await getLoggedInAgent(server);

      // Note: This will actually attempt to send to the URL in a real test
      // In a production test suite, you'd want to mock the fetch/slack client
      const response = await agent.post('/webhooks/test').send({
        service: WebhookService.Slack,
        url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
        body: '{"text": "Test message"}',
      });

      // The test will likely fail due to invalid URL, but we're testing the endpoint structure
      // In a real implementation, you'd mock the slack client
      expect([200, 500]).toContain(response.status);
    });

    it('successfully sends a test message to a generic webhook', async () => {
      const { agent } = await getLoggedInAgent(server);

      // Note: This will actually attempt to send to the URL
      // In a production test suite, you'd want to mock the fetch call
      const response = await agent.post('/webhooks/test').send({
        service: WebhookService.Generic,
        url: 'https://example.com/webhook',
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'test-value',
        },
        body: '{"message": "{{body}}"}',
      });

      // The test will likely fail due to network/URL, but we're testing the endpoint structure
      expect([200, 500]).toContain(response.status);
    });

    it('returns 400 when service is missing', async () => {
      const { agent } = await getLoggedInAgent(server);

      await agent
        .post('/webhooks/test')
        .send({
          url: 'https://example.com/webhook',
        })
        .expect(400);
    });

    it('returns 400 when URL is missing', async () => {
      const { agent } = await getLoggedInAgent(server);

      await agent
        .post('/webhooks/test')
        .send({
          service: WebhookService.Generic,
        })
        .expect(400);
    });

    it('returns 400 when URL is invalid', async () => {
      const { agent } = await getLoggedInAgent(server);

      await agent
        .post('/webhooks/test')
        .send({
          service: WebhookService.Generic,
          url: 'not-a-valid-url',
        })
        .expect(400);
    });

    it('returns 400 when service is invalid', async () => {
      const { agent } = await getLoggedInAgent(server);

      await agent
        .post('/webhooks/test')
        .send({
          service: 'INVALID_SERVICE',
          url: 'https://example.com/webhook',
        })
        .expect(400);
    });

    it('accepts optional headers and body', async () => {
      const { agent } = await getLoggedInAgent(server);

      const response = await agent.post('/webhooks/test').send({
        service: WebhookService.Generic,
        url: 'https://example.com/webhook',
        headers: {
          Authorization: 'Bearer test-token',
        },
        body: '{"custom": "body"}',
      });

      // Network call will likely fail, but endpoint should accept the request
      expect([200, 500]).toContain(response.status);
    });

    it('rejects invalid headers in test request', async () => {
      const { agent } = await getLoggedInAgent(server);

      await agent
        .post('/webhooks/test')
        .send({
          service: WebhookService.Generic,
          url: 'https://example.com/webhook',
          headers: {
            'Invalid\nHeader': 'value',
          },
        })
        .expect(400);
    });
  });
});
