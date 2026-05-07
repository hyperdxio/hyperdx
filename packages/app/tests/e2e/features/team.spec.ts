// seed: packages/app/tests/e2e/features/dashboard.spec.ts

import { TeamPage } from '../page-objects/TeamPage';
import { getApiUrl } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';

test.describe('Team Settings Page', { tag: ['@team', '@full-stack'] }, () => {
  let teamPage: TeamPage;

  test.beforeEach(async ({ page }) => {
    teamPage = new TeamPage(page);
    await teamPage.goto();
  });

  test('should load team page tabs and show all sections', async () => {
    await test.step('Verify page container is visible', async () => {
      await expect(teamPage.container).toBeVisible();
    });

    await test.step('Verify team settings tabs are visible', async () => {
      await expect(teamPage.dataTab).toBeVisible();
      await expect(teamPage.teamTab).toBeVisible();
      await expect(teamPage.integrationsTab).toBeVisible();
      await expect(teamPage.advancedTab).toBeVisible();
    });

    await test.step('Verify data tab sections are visible', async () => {
      await teamPage.openDataTab();
      await expect(teamPage.sources).toBeVisible();
      await expect(teamPage.connections).toBeVisible();
    });

    await test.step('Verify data tab headings exist', async () => {
      await expect(
        teamPage.sources.getByText('Sources', { exact: true }),
      ).toBeVisible();
      await expect(
        teamPage.connections.getByText('Connections', { exact: true }),
      ).toBeVisible();
    });

    await test.step('Verify team name is in header', async () => {
      await expect(teamPage.teamNameValue).toBeVisible();
      await expect(teamPage.teamNameEditButton).toBeVisible();
    });

    await test.step('Verify members tab sections are visible', async () => {
      await teamPage.openTeamTab();
      await expect(teamPage.members).toBeVisible();
    });

    await test.step('Verify members tab heading exists', async () => {
      await expect(
        teamPage.members.getByText('Team Members', { exact: true }).first(),
      ).toBeVisible();
    });

    await test.step('Verify access tab content when available', async () => {
      if (await teamPage.hasAccessTab()) {
        await expect(teamPage.accessTab).toBeVisible();
        await teamPage.openAccessTab();
        await expect(teamPage.securityPolicies).toBeVisible();
      }
    });

    await test.step('Verify integrations tab sections are visible', async () => {
      await teamPage.openIntegrationsTab();
      await expect(teamPage.integrations).toBeVisible();
      await expect(teamPage.apiKeys).toBeVisible();
    });

    await test.step('Verify integrations tab headings exist', async () => {
      await expect(
        teamPage.integrations.getByText('Integrations', { exact: true }),
      ).toBeVisible();
      await expect(
        teamPage.apiKeys.getByText('API Keys', { exact: true }),
      ).toBeVisible();
    });

    await test.step('Verify advanced tab content is visible', async () => {
      await teamPage.openAdvancedTab();
      await expect(teamPage.querySettings).toBeVisible();
    });
  });

  test('should change team name', async () => {
    test.setTimeout(90000);
    let originalName: string;

    await test.step('Read current team name', async () => {
      const text = await teamPage.getTeamNameText();
      originalName = (text ?? '').trim();
    });

    await test.step('Start editing and verify edit controls', async () => {
      await teamPage.startEditingTeamName();
      await expect(teamPage.teamNameSave).toBeVisible();
      await expect(teamPage.teamNameCancel).toBeVisible();
    });

    const newName = `E2E Team ${Date.now()}`;

    await test.step('Fill and save new team name', async () => {
      await teamPage.fillTeamName(newName);
      await teamPage.saveTeamName();
    });

    await test.step('Verify success notification and new name', async () => {
      await expect(teamPage.page.getByText('Updated team name')).toBeVisible();
      await expect(teamPage.teamNameValue).toHaveText(newName);
    });

    await test.step('Restore original team name', async () => {
      await teamPage.changeTeamName(originalName!);
      await expect(teamPage.page.getByText('Updated team name')).toBeVisible();
    });
  });

  test('should cancel team name editing', async () => {
    let originalName: string;

    await test.step('Read current team name', async () => {
      const text = await teamPage.getTeamNameText();
      originalName = (text ?? '').trim();
    });

    await test.step('Start editing and fill new name', async () => {
      await teamPage.startEditingTeamName();
      await teamPage.fillTeamName(`E2E Temp ${Date.now()}`);
    });

    await test.step('Cancel editing', async () => {
      await teamPage.cancelEditingTeamName();
    });

    await test.step('Verify original name is still displayed', async () => {
      await expect(teamPage.teamNameValue).toHaveText(originalName!);
      await expect(teamPage.teamNameSave).toBeHidden();
    });
  });

  test('should display API keys', async () => {
    await test.step('Scroll to API keys section', async () => {
      await teamPage.openIntegrationsTab();
      await teamPage.apiKeys.scrollIntoViewIfNeeded();
    });

    await test.step('Verify API key labels are visible', async () => {
      await expect(
        teamPage.apiKeys.getByText('Ingestion API Key'),
      ).toBeVisible();
      await expect(
        teamPage.apiKeys.getByText('Personal API Access Key'),
      ).toBeVisible();
    });

    await test.step('Verify rotate button is visible', async () => {
      await expect(teamPage.rotateButton).toBeVisible();
    });
  });

  test('should open and cancel rotate API key modal', async () => {
    await test.step('Open rotate API key modal', async () => {
      await teamPage.openIntegrationsTab();
      await teamPage.clickRotateApiKey();
    });

    await test.step('Verify modal shows irreversible warning', async () => {
      await expect(teamPage.page.getByText('not reversible')).toBeVisible();
    });

    await test.step('Cancel and verify modal closes', async () => {
      await teamPage.cancelRotateApiKey();
      await expect(teamPage.page.getByText('not reversible')).toBeHidden();
    });
  });

  test('should create and delete a webhook', async () => {
    test.setTimeout(90000);
    const ts = Date.now();
    const webhookName = `E2E Webhook ${ts}`;
    const webhookUrl = `https://example.com/e2e-webhook-${ts}`;

    await test.step('Scroll to integrations and create webhook', async () => {
      await teamPage.openIntegrationsTab();
      await teamPage.integrations.scrollIntoViewIfNeeded();
      await teamPage.createWebhook({
        serviceType: 'Generic',
        name: webhookName,
        url: webhookUrl,
      });
    });

    await test.step('Verify webhook created successfully', async () => {
      await expect(
        teamPage.page.getByText('Webhook created successfully'),
      ).toBeVisible();
      await expect(teamPage.integrations.getByText(webhookName)).toBeVisible();

      // URL should be masked (not showing the original)
      await expect(teamPage.integrations.getByText(webhookUrl)).toBeHidden();
      await expect(
        teamPage.integrations.getByText(/example\.com\/\*{4}/),
      ).toBeVisible();
    });

    await test.step('Delete the webhook', async () => {
      await teamPage.deleteWebhookByName(webhookName);
      await teamPage.confirmDialog();
    });

    await test.step('Verify webhook deleted successfully', async () => {
      await expect(
        teamPage.page.getByText('Webhook deleted successfully'),
      ).toBeVisible();
      await expect(teamPage.integrations.getByText(webhookName)).toBeHidden();
    });
  });

  test('should redact webhook secrets and preserve on edit', async ({
    page,
  }) => {
    test.setTimeout(90000);
    const ts = Date.now();
    const webhookName = `E2E Secret Webhook ${ts}`;
    const webhookUrl = `https://example.com/e2e-secret-${ts}`;
    const updatedName = `E2E Secret Renamed ${ts}`;
    const apiUrl = getApiUrl();

    await test.step('Create a Generic webhook with headers via API', async () => {
      const response = await page.request.post(`${apiUrl}/webhooks`, {
        data: {
          name: webhookName,
          service: 'generic',
          url: webhookUrl,
          description: 'E2E test webhook with secrets',
          headers: {
            Authorization: 'Bearer e2e-secret-token',
            'X-Api-Key': 'e2e-api-key-value',
          },
          body: '{"text": "test"}',
        },
      });
      expect(response.ok()).toBeTruthy();
    });

    await test.step('Navigate to integrations tab and verify masked URL', async () => {
      await teamPage.openIntegrationsTab();
      await teamPage.integrations.scrollIntoViewIfNeeded();

      // Webhook name should be visible
      await expect(teamPage.integrations.getByText(webhookName)).toBeVisible();

      // URL should be masked — original URL must NOT appear
      await expect(teamPage.integrations.getByText(webhookUrl)).toBeHidden();

      // Masked URL should be visible
      const maskedUrlLocator = teamPage.getWebhookUrlText(webhookName);
      await expect(maskedUrlLocator).toBeVisible();
    });

    await test.step('Edit webhook — verify masked URL in form', async () => {
      await teamPage.editWebhookByName(webhookName);
      await expect(teamPage.webhookUrlInput).toBeVisible();

      // URL input should contain the masked URL, not the original
      await expect(teamPage.webhookUrlInput).toHaveValue(/\*{4}/);
      await expect(teamPage.webhookUrlInput).not.toHaveValue(webhookUrl);
    });

    await test.step('Update only the name and save', async () => {
      await teamPage.webhookNameInput.clear();
      await teamPage.webhookNameInput.fill(updatedName);
      await teamPage.submitWebhookForm();
    });

    await test.step('Verify update succeeded', async () => {
      await expect(
        teamPage.page.getByText('Webhook updated successfully'),
      ).toBeVisible();
      await expect(teamPage.integrations.getByText(updatedName)).toBeVisible();
    });

    await test.step('Verify stored URL was preserved via API', async () => {
      const response = await page.request.get(
        `${apiUrl}/webhooks?service=generic`,
      );
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      const webhook = body.data.find(
        (w: { name: string }) => w.name === updatedName,
      );
      expect(webhook).toBeDefined();

      // API response should have masked URL
      expect(webhook.url).toContain('****');
      expect(webhook.url).not.toBe(webhookUrl);

      // API response should have redacted header values but preserved keys
      expect(webhook.headers).toBeDefined();
      expect(Object.keys(webhook.headers)).toContain('Authorization');
      expect(Object.keys(webhook.headers)).toContain('X-Api-Key');
      expect(webhook.headers.Authorization).toBe('****');
      expect(webhook.headers['X-Api-Key']).toBe('****');
    });

    await test.step('Clean up — delete webhook', async () => {
      await teamPage.deleteWebhookByName(updatedName);
      await teamPage.confirmDialog();
      await expect(
        teamPage.page.getByText('Webhook deleted successfully'),
      ).toBeVisible();
    });
  });

  test('should invite a team member and delete the invitation', async () => {
    test.setTimeout(90000);
    const email = `e2e-test-${Date.now()}@example.com`;

    await test.step('Verify current user is displayed', async () => {
      await teamPage.openTeamTab();
      await teamPage.members.scrollIntoViewIfNeeded();
      await expect(teamPage.members.getByText('You')).toBeVisible();
    });

    await test.step('Open invite modal and send invitation', async () => {
      await teamPage.clickInviteMember();
      await expect(
        teamPage.page.getByRole('dialog').getByText('Invite Team Member'),
      ).toBeVisible();
      await teamPage.fillInviteEmail(email);
      await teamPage.submitInvite();
    });

    await test.step('Verify invitation appears with pending badge', async () => {
      const row = teamPage.getInvitationRow(email);
      await expect(row).toBeVisible({ timeout: 10000 });
      await expect(row.getByText(email)).toBeVisible();
      await expect(row.getByText('Pending Invite')).toBeVisible();
    });

    await test.step('Delete the invitation', async () => {
      await teamPage.deleteInvitationByEmail(email);
      await teamPage.confirmDeleteMember();
    });

    await test.step('Verify invitation deleted successfully', async () => {
      await expect(
        teamPage.page.getByText('Deleted team invite'),
      ).toBeVisible();
      await expect(teamPage.members.getByText(email)).toBeHidden();
    });
  });

  test('should display connection information', async () => {
    await test.step('Verify connections section is visible', async () => {
      await teamPage.openDataTab();
      await expect(teamPage.connections).toBeVisible();
    });

    await test.step('Verify connection details are visible', async () => {
      await expect(teamPage.connections.getByText('Host:')).toBeVisible();
      await expect(teamPage.connections.getByText('Username:')).toBeVisible();
    });
  });
});
