import { WebhookService } from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'mongodb';
import request, { SuperAgentTest } from 'supertest';

import { getLoggedInAgent, getServer } from '@/fixtures';
import Alert, { AlertSource, AlertState } from '@/models/alert';
import { ITeam } from '@/models/team';
import { IUser } from '@/models/user';
import Webhook from '@/models/webhook';

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
      expect(response.body).toEqual({
        data: [],
        meta: { total: 0, limit: 1000, offset: 0 },
      });
    });

    it('should paginate with limit and offset and report the total', async () => {
      for (let i = 0; i < 3; i++) {
        await Webhook.create({
          name: `Webhook ${i}`,
          service: WebhookService.Slack,
          team: team._id,
        });
      }

      const page1 = await authRequest(
        'get',
        `${WEBHOOKS_BASE_URL}?limit=2&offset=0`,
      ).expect(200);
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.meta).toEqual({ total: 3, limit: 2, offset: 0 });

      const page2 = await authRequest(
        'get',
        `${WEBHOOKS_BASE_URL}?limit=2&offset=2`,
      ).expect(200);
      expect(page2.body.data).toHaveLength(1);
      expect(page2.body.meta).toEqual({ total: 3, limit: 2, offset: 2 });

      // Pages must be disjoint and together cover every record (stable order).
      const pagedIds = [...page1.body.data, ...page2.body.data].map(w => w.id);
      expect(new Set(pagedIds).size).toBe(3);
    });

    it('should return an empty page with the correct total past the end', async () => {
      await Webhook.create({
        name: 'Only Webhook',
        service: WebhookService.Slack,
        team: team._id,
      });

      const response = await authRequest(
        'get',
        `${WEBHOOKS_BASE_URL}?offset=100`,
      ).expect(200);
      expect(response.body.data).toHaveLength(0);
      expect(response.body.meta).toEqual({
        total: 1,
        limit: 1000,
        offset: 100,
      });
    });

    it('should reject an out-of-range or non-integer limit or offset', async () => {
      await authRequest('get', `${WEBHOOKS_BASE_URL}?limit=0`).expect(400);
      await authRequest('get', `${WEBHOOKS_BASE_URL}?limit=5000`).expect(400);
      await authRequest('get', `${WEBHOOKS_BASE_URL}?offset=-1`).expect(400);
      await authRequest('get', `${WEBHOOKS_BASE_URL}?limit=abc`).expect(400);
      await authRequest('get', `${WEBHOOKS_BASE_URL}?limit=1.5`).expect(400);
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

    it('should list a Generic webhook with body but no headers', async () => {
      await Webhook.create({ ...MOCK_GENERIC_WEBHOOK, team: team._id });

      const response = await authRequest('get', WEBHOOKS_BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        id: expect.any(String),
        name: MOCK_GENERIC_WEBHOOK.name,
        service: WebhookService.Generic,
        url: MOCK_GENERIC_WEBHOOK.url,
        description: MOCK_GENERIC_WEBHOOK.description,
        body: MOCK_GENERIC_WEBHOOK.body,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(response.body.data[0]).not.toHaveProperty('headers');
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

    it('should count a row that fails schema parse in total but omit it from data', async () => {
      await Webhook.create({ ...MOCK_SLACK_WEBHOOK, team: team._id });
      // Insert a malformed row directly, bypassing Mongoose validation, so it
      // fails externalWebhookSchema parsing on read. meta.total counts every
      // stored row (countDocuments) while data drops the unparseable one, so
      // data.length can be less than meta.total — this documents that skew.
      await Webhook.collection.insertOne({
        team: team._id,
        name: 'Broken Webhook',
        service: 'not-a-real-service',
      } as any);

      const response = await authRequest('get', WEBHOOKS_BASE_URL).expect(200);

      expect(response.body.meta.total).toBe(2);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe(MOCK_SLACK_WEBHOOK.name);
    });

    it('should require authentication', async () => {
      await request(server.getHttpServer()).get(WEBHOOKS_BASE_URL).expect(401);
    });
  });

  describe('POST /api/v2/webhooks', () => {
    it('should require authentication', async () => {
      await request(server.getHttpServer())
        .post(WEBHOOKS_BASE_URL)
        .send(MOCK_SLACK_WEBHOOK)
        .expect(401);
    });

    it('should create a Slack webhook and never return sensitive fields', async () => {
      const response = await authRequest('post', WEBHOOKS_BASE_URL)
        .send(MOCK_GENERIC_WEBHOOK)
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: expect.any(String),
        name: MOCK_GENERIC_WEBHOOK.name,
        service: WebhookService.Generic,
        url: MOCK_GENERIC_WEBHOOK.url,
        body: MOCK_GENERIC_WEBHOOK.body,
      });
      // Write-only fields must not be echoed back
      expect(response.body.data).not.toHaveProperty('headers');
      expect(response.body.data).not.toHaveProperty('queryParams');

      // ...but they should be persisted
      const stored = await Webhook.findById(response.body.data.id).lean();
      expect(stored?.headers).toBeDefined();
    });

    it('should reject a duplicate service + name', async () => {
      await authRequest('post', WEBHOOKS_BASE_URL)
        .send(MOCK_SLACK_WEBHOOK)
        .expect(200);

      const response = await authRequest('post', WEBHOOKS_BASE_URL)
        .send(MOCK_SLACK_WEBHOOK)
        .expect(400);
      expect(response.body.message).toMatch(/already exists/i);
    });

    it('should reject an invalid url', async () => {
      await authRequest('post', WEBHOOKS_BASE_URL)
        .send({ ...MOCK_SLACK_WEBHOOK, url: 'not-a-url' })
        .expect(400);
    });

    it('should reject a private webhook URL without persisting it', async () => {
      const response = await authRequest('post', WEBHOOKS_BASE_URL)
        .send({ ...MOCK_GENERIC_WEBHOOK, url: 'http://10.0.0.1/webhook' })
        .expect(400);

      expect(response.body.message).toContain('private or reserved address');
      expect(await Webhook.countDocuments({})).toBe(0);
    });

    it.each(['headers', 'queryParams', 'body'])(
      'should reject %s on a slack webhook (unsupported by the service)',
      async field => {
        const payload =
          field === 'body'
            ? { ...MOCK_SLACK_WEBHOOK, body: '{"text": "hi"}' }
            : { ...MOCK_SLACK_WEBHOOK, [field]: { 'X-Custom': 'value' } };

        const response = await authRequest('post', WEBHOOKS_BASE_URL)
          .send(payload)
          .expect(400);
        expect(JSON.stringify(response.body)).toMatch(/not supported/i);
      },
    );

    it('should reject header values with control characters', async () => {
      await authRequest('post', WEBHOOKS_BASE_URL)
        .send({
          ...MOCK_GENERIC_WEBHOOK,
          headers: { 'X-Bad': 'line1\nline2' },
        })
        .expect(400);
    });

    it('should reject query param values with control characters', async () => {
      await authRequest('post', WEBHOOKS_BASE_URL)
        .send({
          ...MOCK_GENERIC_WEBHOOK,
          queryParams: { token: 'line1\r\nX-Injected: evil' },
        })
        .expect(400);
    });

    it('should reject query param names with control characters', async () => {
      await authRequest('post', WEBHOOKS_BASE_URL)
        .send({
          ...MOCK_GENERIC_WEBHOOK,
          queryParams: { 'bad\nkey': 'value' },
        })
        .expect(400);
    });

    it('should reject a header name with characters outside the HTTP token charset', async () => {
      await authRequest('post', WEBHOOKS_BASE_URL)
        .send({
          ...MOCK_GENERIC_WEBHOOK,
          headers: { 'X-Bad@Name': 'value' },
        })
        .expect(400);
    });

    it('should reject a header name containing a colon', async () => {
      await authRequest('post', WEBHOOKS_BASE_URL)
        .send({
          ...MOCK_GENERIC_WEBHOOK,
          headers: { 'X-Bad:Name': 'value' },
        })
        .expect(400);
    });

    it('should reject a header name that starts with a digit', async () => {
      await authRequest('post', WEBHOOKS_BASE_URL)
        .send({
          ...MOCK_GENERIC_WEBHOOK,
          headers: { '1-Header': 'value' },
        })
        .expect(400);
    });

    it('should reject an empty header name', async () => {
      await authRequest('post', WEBHOOKS_BASE_URL)
        .send({
          ...MOCK_GENERIC_WEBHOOK,
          headers: { '': 'value' },
        })
        .expect(400);
    });

    describe('field size caps', () => {
      it('should reject an over-long name', async () => {
        await authRequest('post', WEBHOOKS_BASE_URL)
          .send({ ...MOCK_GENERIC_WEBHOOK, name: 'x'.repeat(1025) })
          .expect(400);
      });

      it('should reject an over-long url', async () => {
        await authRequest('post', WEBHOOKS_BASE_URL)
          .send({
            ...MOCK_GENERIC_WEBHOOK,
            url: `https://example.com/${'a'.repeat(2049)}`,
          })
          .expect(400);
      });

      it('should reject an over-long description', async () => {
        await authRequest('post', WEBHOOKS_BASE_URL)
          .send({ ...MOCK_GENERIC_WEBHOOK, description: 'x'.repeat(2049) })
          .expect(400);
      });

      it('should reject an over-long body', async () => {
        await authRequest('post', WEBHOOKS_BASE_URL)
          .send({ ...MOCK_GENERIC_WEBHOOK, body: 'x'.repeat(16 * 1024 + 1) })
          .expect(400);
      });

      it('should reject an over-long header value', async () => {
        await authRequest('post', WEBHOOKS_BASE_URL)
          .send({
            ...MOCK_GENERIC_WEBHOOK,
            headers: { 'X-Big': 'x'.repeat(4097) },
          })
          .expect(400);
      });

      it('should reject an over-long query param value', async () => {
        await authRequest('post', WEBHOOKS_BASE_URL)
          .send({
            ...MOCK_GENERIC_WEBHOOK,
            queryParams: { token: 'x'.repeat(4097) },
          })
          .expect(400);
      });

      it('should reject more than 100 headers', async () => {
        const headers: Record<string, string> = {};
        for (let i = 0; i < 101; i++) headers[`X-H-${i}`] = 'v';
        await authRequest('post', WEBHOOKS_BASE_URL)
          .send({ ...MOCK_GENERIC_WEBHOOK, headers })
          .expect(400);
      });

      it('should reject more than 100 query params', async () => {
        const queryParams: Record<string, string> = {};
        for (let i = 0; i < 101; i++) queryParams[`p${i}`] = 'v';
        await authRequest('post', WEBHOOKS_BASE_URL)
          .send({ ...MOCK_GENERIC_WEBHOOK, queryParams })
          .expect(400);
      });
    });
  });

  describe('PUT /api/v2/webhooks/:id', () => {
    it('should reject a private webhook URL without updating it', async () => {
      const created = await Webhook.create({
        ...MOCK_GENERIC_WEBHOOK,
        team: team._id,
      });

      const response = await authRequest(
        'put',
        `${WEBHOOKS_BASE_URL}/${created._id}`,
      )
        .send({ ...MOCK_GENERIC_WEBHOOK, url: 'http://[fd00::1]/webhook' })
        .expect(400);

      expect(response.body.message).toContain('private or reserved address');
      expect((await Webhook.findById(created._id))!.url).toBe(
        MOCK_GENERIC_WEBHOOK.url,
      );
    });

    it('should replace readable fields but preserve omitted write-only fields when the destination is unchanged', async () => {
      const created = await Webhook.create({
        ...MOCK_GENERIC_WEBHOOK,
        team: team._id,
      });

      const response = await authRequest(
        'put',
        `${WEBHOOKS_BASE_URL}/${created._id}`,
      )
        .send({
          name: 'Renamed Generic',
          service: WebhookService.Generic,
          // Same url/service => destination unchanged => write-only fields preserved
          url: MOCK_GENERIC_WEBHOOK.url,
        })
        .expect(200);

      expect(response.body.data.name).toBe('Renamed Generic');
      expect(response.body.data.url).toBe(MOCK_GENERIC_WEBHOOK.url);
      // Write-only fields must not be echoed back on update either
      expect(response.body.data).not.toHaveProperty('headers');
      expect(response.body.data).not.toHaveProperty('queryParams');

      const stored = await Webhook.findById(created._id).lean();
      // headers omitted + destination unchanged => preserved (clients can never read them back)
      expect(stored?.headers).toEqual(MOCK_GENERIC_WEBHOOK.headers);
      // readable fields omitted => cleared (full replace)
      expect(stored?.body).toBeUndefined();
      expect(stored?.description).toBeUndefined();
    });

    it('should preserve omitted queryParams when the destination is unchanged', async () => {
      const created = await Webhook.create({
        ...MOCK_GENERIC_WEBHOOK,
        queryParams: { token: 'secret-token' },
        team: team._id,
      });

      await authRequest('put', `${WEBHOOKS_BASE_URL}/${created._id}`)
        .send({
          name: 'Renamed Generic',
          service: WebhookService.Generic,
          // Same url/service => destination unchanged => write-only fields preserved
          url: MOCK_GENERIC_WEBHOOK.url,
        })
        .expect(200);

      const stored = await Webhook.findById(created._id).lean();
      expect(stored?.queryParams).toEqual({ token: 'secret-token' });
    });

    it('should NOT forward stored write-only secrets when the url changes', async () => {
      // The exfiltration path: a caller who cannot read headers/queryParams
      // back must not be able to repoint url at an endpoint they control and
      // have the stored secret headers forwarded there on the next alert.
      const created = await Webhook.create({
        ...MOCK_GENERIC_WEBHOOK,
        headers: { Authorization: 'Bearer super-secret' },
        queryParams: { token: 'secret-token' },
        team: team._id,
      });

      await authRequest('put', `${WEBHOOKS_BASE_URL}/${created._id}`)
        .send({
          name: MOCK_GENERIC_WEBHOOK.name,
          service: WebhookService.Generic,
          // attacker repoints the destination while omitting the secrets
          url: 'https://attacker.example.com/steal',
        })
        .expect(200);

      const stored = await Webhook.findById(created._id).lean();
      // Stored secrets must be cleared, never forwarded to the new destination.
      expect(stored?.headers).toBeUndefined();
      expect(stored?.queryParams).toBeUndefined();
      expect(stored?.url).toBe('https://attacker.example.com/steal');
    });

    it('should clear stored write-only secrets when the service changes', async () => {
      const created = await Webhook.create({
        ...MOCK_GENERIC_WEBHOOK,
        headers: { Authorization: 'Bearer super-secret' },
        team: team._id,
      });

      await authRequest('put', `${WEBHOOKS_BASE_URL}/${created._id}`)
        .send({
          name: MOCK_GENERIC_WEBHOOK.name,
          // service and URL change together to a valid Slack destination
          service: WebhookService.Slack,
          url: MOCK_SLACK_WEBHOOK.url,
        })
        .expect(200);

      const stored = await Webhook.findById(created._id).lean();
      expect(stored?.headers).toBeUndefined();
    });

    it('should keep re-supplied write-only fields when the url changes', async () => {
      const created = await Webhook.create({
        ...MOCK_GENERIC_WEBHOOK,
        headers: { Authorization: 'Bearer old-secret' },
        team: team._id,
      });

      await authRequest('put', `${WEBHOOKS_BASE_URL}/${created._id}`)
        .send({
          name: MOCK_GENERIC_WEBHOOK.name,
          service: WebhookService.Generic,
          url: 'https://example.com/new-but-trusted',
          headers: { Authorization: 'Bearer new-secret' },
        })
        .expect(200);

      const stored = await Webhook.findById(created._id).lean();
      // Explicitly re-supplied for the new destination => written.
      expect(stored?.headers).toEqual({ Authorization: 'Bearer new-secret' });
    });

    it('should clear write-only fields when an explicit empty object is sent', async () => {
      const created = await Webhook.create({
        ...MOCK_GENERIC_WEBHOOK,
        team: team._id,
      });

      await authRequest('put', `${WEBHOOKS_BASE_URL}/${created._id}`)
        .send({
          name: MOCK_GENERIC_WEBHOOK.name,
          service: WebhookService.Generic,
          url: MOCK_GENERIC_WEBHOOK.url,
          headers: {},
        })
        .expect(200);

      const stored = await Webhook.findById(created._id).lean();
      expect(stored?.headers).toBeUndefined();
    });

    it('should reject renaming a webhook onto an existing service + name', async () => {
      await Webhook.create({
        ...MOCK_SLACK_WEBHOOK,
        team: team._id,
      });
      const created = await Webhook.create({
        ...MOCK_SLACK_WEBHOOK,
        name: 'Another Slack Webhook',
        team: team._id,
      });

      const response = await authRequest(
        'put',
        `${WEBHOOKS_BASE_URL}/${created._id}`,
      )
        .send({ ...MOCK_SLACK_WEBHOOK })
        .expect(400);
      expect(response.body.message).toMatch(/already exists/i);
    });

    it('should return 404 for a webhook belonging to another team', async () => {
      const otherTeamId = new ObjectId();
      const created = await Webhook.create({
        ...MOCK_SLACK_WEBHOOK,
        team: otherTeamId,
      });

      await authRequest('put', `${WEBHOOKS_BASE_URL}/${created._id}`)
        .send(MOCK_SLACK_WEBHOOK)
        .expect(404);
    });

    it('should return 404 for a non-existent webhook', async () => {
      await authRequest('put', `${WEBHOOKS_BASE_URL}/${new ObjectId()}`)
        .send(MOCK_SLACK_WEBHOOK)
        .expect(404);
    });

    it('should return 409 when the destination is changed concurrently between read and write', async () => {
      // The pinned findOneAndUpdate guards against a concurrent PUT repointing
      // the destination between the read and the write (which would otherwise
      // leave a secret configured for one destination attached to another).
      // Simulate that race: the initial findOne returns the stale snapshot but
      // a concurrent write has already moved the url, so the pinned update
      // matches nothing while the document still exists => 409.
      const created = await Webhook.create({
        ...MOCK_GENERIC_WEBHOOK,
        team: team._id,
      });
      const staleDoc = await Webhook.findOne({
        _id: created._id,
        team: team._id,
      });

      const spy = jest.spyOn(Webhook, 'findOne').mockImplementationOnce((() =>
        (async () => {
          await Webhook.updateOne(
            { _id: created._id },
            { $set: { url: 'https://example.com/moved-concurrently' } },
          );
          return staleDoc;
        })()) as any);

      try {
        const response = await authRequest(
          'put',
          `${WEBHOOKS_BASE_URL}/${created._id}`,
        )
          .send({
            name: 'Renamed without repointing',
            service: WebhookService.Generic,
            url: MOCK_GENERIC_WEBHOOK.url,
          })
          .expect(409);
        expect(response.body.message).toMatch(/concurrently/i);
      } finally {
        spy.mockRestore();
      }

      // The losing update did not apply; the concurrent write stands.
      const stored = await Webhook.findById(created._id).lean();
      expect(stored?.url).toBe('https://example.com/moved-concurrently');
      expect(stored?.name).toBe(MOCK_GENERIC_WEBHOOK.name);
    });

    it('should return 404 when the webhook is deleted concurrently between read and write', async () => {
      // Same pinned-update miss, but the document no longer exists => the
      // 409-vs-404 disambiguation (Webhook.exists) must resolve to 404.
      const created = await Webhook.create({
        ...MOCK_GENERIC_WEBHOOK,
        team: team._id,
      });
      const staleDoc = await Webhook.findOne({
        _id: created._id,
        team: team._id,
      });

      const spy = jest.spyOn(Webhook, 'findOne').mockImplementationOnce((() =>
        (async () => {
          await Webhook.deleteOne({ _id: created._id });
          return staleDoc;
        })()) as any);

      try {
        await authRequest('put', `${WEBHOOKS_BASE_URL}/${created._id}`)
          .send({
            name: MOCK_GENERIC_WEBHOOK.name,
            service: WebhookService.Generic,
            url: MOCK_GENERIC_WEBHOOK.url,
          })
          .expect(404);
      } finally {
        spy.mockRestore();
      }

      expect(await Webhook.findById(created._id)).toBeNull();
    });
  });

  describe('DELETE /api/v2/webhooks/:id', () => {
    it('should delete a webhook', async () => {
      const created = await Webhook.create({
        ...MOCK_SLACK_WEBHOOK,
        team: team._id,
      });

      await authRequest('delete', `${WEBHOOKS_BASE_URL}/${created._id}`).expect(
        200,
      );

      expect(await Webhook.findById(created._id)).toBeNull();
    });

    it('should return 404 for a webhook belonging to another team', async () => {
      const otherTeamId = new ObjectId();
      const created = await Webhook.create({
        ...MOCK_SLACK_WEBHOOK,
        team: otherTeamId,
      });

      await authRequest('delete', `${WEBHOOKS_BASE_URL}/${created._id}`).expect(
        404,
      );

      // untouched
      expect(await Webhook.findById(created._id)).not.toBeNull();
    });

    it('should return 409 (not orphan alerts) when an alert still references the webhook', async () => {
      const created = await Webhook.create({
        ...MOCK_SLACK_WEBHOOK,
        team: team._id,
      });
      await Alert.create({
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: new ObjectId(),
        threshold: 1,
        interval: '5m',
        state: AlertState.OK,
        channel: { type: 'webhook', webhookId: created._id.toString() },
      });

      const response = await authRequest(
        'delete',
        `${WEBHOOKS_BASE_URL}/${created._id}`,
      ).expect(409);
      expect(response.body.message).toMatch(/still reference/i);

      // The webhook must survive so the referencing alert isn't orphaned.
      expect(await Webhook.findById(created._id)).not.toBeNull();
    });
  });
});
