import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { getLoggedInAgent, getServer } from '@/fixtures';
import { McpContext } from '@/mcp/tools/types';
import Alert from '@/models/alert';
import Team from '@/models/team';
import Webhook, { WebhookService } from '@/models/webhook';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

describe('MCP Webhook Tools', () => {
  const server = getServer();
  let team: any;
  let user: any;
  let client: Client;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    team = result.team;
    user = result.user;

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

  describe('clickstack_save_webhook (create)', () => {
    it('creates a generic webhook and persists it scoped to the team', async () => {
      const result = await callTool(client, 'clickstack_save_webhook', {
        name: 'My Generic Hook',
        service: 'generic',
        url: 'https://example.com/webhook',
        description: 'ci test',
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output).toMatchObject({
        name: 'My Generic Hook',
        service: 'generic',
      });
      expect(output.id).toBeDefined();
      // Never echo the URL back (write-only posture, mirrors get_webhook).
      expect(output.url).toBeUndefined();

      const stored = await Webhook.findById(output.id);
      expect(stored).not.toBeNull();
      expect(stored?.team.toString()).toBe(team._id.toString());
      expect(stored?.url).toBe('https://example.com/webhook');
    });

    it('creates a slack webhook with a slack.com host', async () => {
      const result = await callTool(client, 'clickstack_save_webhook', {
        name: 'Slack Alerts',
        service: 'slack',
        url: 'https://hooks.slack.com/services/T000/B000/XXXX',
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.service).toBe('slack');
    });

    it('rejects a slack webhook that sets headers/body', async () => {
      const result = await callTool(client, 'clickstack_save_webhook', {
        name: 'Bad Slack',
        service: 'slack',
        url: 'https://hooks.slack.com/services/T000/B000/XXXX',
        headers: { 'X-Token': 'abc' },
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('slack');
    });

    it('rejects a slack webhook whose host is not slack.com', async () => {
      const result = await callTool(client, 'clickstack_save_webhook', {
        name: 'Fake Slack',
        service: 'slack',
        url: 'https://evil.example.com/webhook',
      });

      expect(result.isError).toBe(true);
    });

    it('rejects an invalid URL', async () => {
      const result = await callTool(client, 'clickstack_save_webhook', {
        name: 'Broken',
        service: 'generic',
        url: 'not-a-url',
      });

      expect(result.isError).toBe(true);
    });

    it('rejects a duplicate (team, service, name)', async () => {
      await Webhook.create({
        team: team._id,
        name: 'Dup Hook',
        service: WebhookService.Generic,
        url: 'https://example.com/existing',
      });

      const result = await callTool(client, 'clickstack_save_webhook', {
        name: 'Dup Hook',
        service: 'generic',
        url: 'https://example.com/webhook',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('already exists');
    });
  });

  describe('clickstack_save_webhook (update)', () => {
    async function createGenericWebhook() {
      return Webhook.create({
        team: team._id,
        name: 'Original',
        service: WebhookService.Generic,
        url: 'https://example.com/original',
        description: 'original desc',
        headers: { 'X-Token': 'secret' },
      });
    }

    it('updates name/url and clears omitted readable fields', async () => {
      const wh = await createGenericWebhook();

      const result = await callTool(client, 'clickstack_save_webhook', {
        id: wh._id.toString(),
        name: 'Renamed',
        service: 'generic',
        url: 'https://example.com/original', // destination unchanged
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.id).toBe(wh._id.toString());
      expect(output.name).toBe('Renamed');

      const stored = await Webhook.findById(wh._id);
      expect(stored?.name).toBe('Renamed');
      // description omitted -> cleared (full replace of readable fields)
      expect(stored?.description == null).toBe(true);
      // headers omitted + destination unchanged -> preserved
      expect(stored?.headers?.get('X-Token')).toBe('secret');
    });

    it('clears omitted write-only secrets when the destination changes', async () => {
      const wh = await createGenericWebhook();

      const result = await callTool(client, 'clickstack_save_webhook', {
        id: wh._id.toString(),
        name: 'Original',
        service: 'generic',
        url: 'https://example.com/NEW-destination', // destination changed
      });

      expect(result.isError).toBeFalsy();
      const stored = await Webhook.findById(wh._id);
      expect(stored?.url).toBe('https://example.com/NEW-destination');
      // headers omitted + destination changed -> cleared (no secret forwarding)
      const headers = stored?.headers;
      expect(headers == null || headers.size === 0).toBe(true);
    });

    // NOTE: the 'conflict' branch of updateWebhook fires only when url/service
    // change in-process between the snapshot findOne and the pinned
    // findOneAndUpdate. That race cannot be triggered deterministically through
    // the black-box MCP tool (both reads happen inside one controller call), so
    // it is intentionally not covered here; it would need a controller-level
    // unit test that injects a write between the two awaits.

    it('rejects renaming a webhook onto an existing (service, name)', async () => {
      await Webhook.create({
        team: team._id,
        name: 'Existing Name',
        service: WebhookService.Generic,
        url: 'https://example.com/a',
      });
      const target = await Webhook.create({
        team: team._id,
        name: 'Other Name',
        service: WebhookService.Generic,
        url: 'https://example.com/b',
      });

      const result = await callTool(client, 'clickstack_save_webhook', {
        id: target._id.toString(),
        name: 'Existing Name', // collide with the first webhook
        service: 'generic',
        url: 'https://example.com/b',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('already exists');
    });

    it('rejects switching service to slack with a non-slack.com host on update', async () => {
      const wh = await createGenericWebhook();

      const result = await callTool(client, 'clickstack_save_webhook', {
        id: wh._id.toString(),
        name: 'Original',
        service: 'slack',
        url: 'https://example.com/original', // not a slack.com host
      });

      expect(result.isError).toBe(true);
    });

    it('returns a user error for a non-existent id', async () => {
      const result = await callTool(client, 'clickstack_save_webhook', {
        id: '000000000000000000000000',
        name: 'Ghost',
        service: 'generic',
        url: 'https://example.com/webhook',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
    });

    it('rejects an invalid id', async () => {
      const result = await callTool(client, 'clickstack_save_webhook', {
        id: 'not-an-object-id',
        name: 'Bad',
        service: 'generic',
        url: 'https://example.com/webhook',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('webhook ID');
    });
  });

  describe('clickstack_delete_webhook', () => {
    it('deletes a webhook', async () => {
      const wh = await Webhook.create({
        team: team._id,
        name: 'To Delete',
        service: WebhookService.Generic,
        url: 'https://example.com/webhook',
      });

      const result = await callTool(client, 'clickstack_delete_webhook', {
        id: wh._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output).toMatchObject({ deleted: true, id: wh._id.toString() });

      expect(await Webhook.findById(wh._id)).toBeNull();
    });

    it('blocks deletion when an alert references the webhook', async () => {
      const wh = await Webhook.create({
        team: team._id,
        name: 'Referenced',
        service: WebhookService.Generic,
        url: 'https://example.com/webhook',
      });
      await Alert.create({
        team: team._id,
        source: 'saved_search',
        threshold: 1,
        thresholdType: 'above',
        interval: '5m',
        channel: { type: 'webhook', webhookId: wh._id.toString() },
      });

      const result = await callTool(client, 'clickstack_delete_webhook', {
        id: wh._id.toString(),
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('still reference it');
      // Not deleted.
      expect(await Webhook.findById(wh._id)).not.toBeNull();
    });

    it('returns a user error for a non-existent id', async () => {
      const result = await callTool(client, 'clickstack_delete_webhook', {
        id: '000000000000000000000000',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
    });

    it('does not delete a webhook owned by another team', async () => {
      const otherTeam = await Team.create({ name: 'Other Team' });
      const otherWebhook = await Webhook.create({
        team: otherTeam._id,
        name: 'Other Team Hook',
        service: WebhookService.Generic,
        url: 'https://example.com/other',
      });

      const result = await callTool(client, 'clickstack_delete_webhook', {
        id: otherWebhook._id.toString(),
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
      // Still present.
      expect(await Webhook.findById(otherWebhook._id)).not.toBeNull();
    });
  });
});
