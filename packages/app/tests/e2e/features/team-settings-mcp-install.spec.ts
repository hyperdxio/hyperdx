// e2e walk-through for the new "Connect your AI assistant" section
// on the Team Settings page (Integrations tab). The section lives
// directly above the API Keys card and lets a user install the
// ClickStack MCP server in Claude Code, Cursor, VS Code + Copilot,
// Codex CLI, or any MCP-compatible host without hand-rolling JSON.

import { expect, Page, test } from '@playwright/test';

const ACCESS_KEY = 'k_test_demo';

async function mockTeamSettingsApis(page: Page) {
  const team = {
    _id: 'team-1',
    name: 'Acme',
    apiKey: 'team-api-key',
  };
  await page.route(/\/api\/(me|team)\b/, async route => {
    const url = route.request().url();
    if (url.includes('/api/me')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'user-1',
          email: 'admin@example.com',
          name: 'Admin User',
          accessKey: ACCESS_KEY,
          createdAt: '2026-05-01T00:00:00Z',
          team,
          teams: [
            {
              id: 'team-1',
              name: 'Acme',
            },
          ],
          usageStatsEnabled: false,
          aiAssistantEnabled: false,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(team),
    });
  });
}

test.describe(
  'Team Settings - Connect your AI assistant',
  { tag: ['@team-settings-mcp'] },
  () => {
    // The e2e webServer in `playwright.config.ts` runs with
    // `NEXT_PUBLIC_IS_LOCAL_MODE=true`, which short-circuits
    // `useMe`/`useTeam` to `return null` in `packages/app/src/api.ts`
    // before the React Query cache can pick up the `page.route`
    // mocks. Skip in local mode until the e2e build flag is wired
    // up; component coverage in `__tests__/McpServerSection.test.tsx`
    // exercises the render branches in the meantime.
    test.fixme(
      true,
      'Requires the full-stack e2e build (non-local mode); component tests cover the render branches today.',
    );

    test.beforeEach(async ({ page }) => {
      page.on('console', msg => {
        if (msg.type() === 'error') {
          console.log('browser error:', msg.text());
        }
      });
      await mockTeamSettingsApis(page);
      await page
        .context()
        .grantPermissions(['clipboard-read', 'clipboard-write']);
    });

    test('renders the section above API Keys on the Integrations tab', async ({
      page,
    }) => {
      await page.goto('/team?tab=integrations');

      const section = page.getByTestId('mcp-server-section');
      await expect(section).toBeVisible();

      // Assert document order rather than viewport geometry: the
      // section element should be followed (anywhere in the tree)
      // by the API Keys section element. A Mantine spacing tweak
      // can't flip this without flipping source order.
      const apiKeysAfterSection = section.locator(
        'xpath=following::*[@data-testid="api-keys-section"]',
      );
      await expect(apiKeysAfterSection).toHaveCount(1);
    });

    test('exposes a copyable JSON config under the Other host', async ({
      page,
    }) => {
      await page.goto('/team?tab=integrations');

      // Mantine SegmentedControl is a radiogroup with one radio per
      // option; clicking the visible label flips the active item.
      // Scope to the section to avoid colliding with similarly
      // named text elsewhere on the page.
      const section = page.getByTestId('mcp-server-section');
      await section.getByText('Other', { exact: true }).click();

      await section.getByRole('button', { name: /^Copy$/ }).click();

      const clipboardText = await page.evaluate(() =>
        navigator.clipboard.readText(),
      );
      const parsed = JSON.parse(clipboardText);
      expect(parsed).toMatchObject({
        mcpServers: {
          clickstack: {
            type: 'http',
            headers: { Authorization: `Bearer ${ACCESS_KEY}` },
          },
        },
      });
      expect(parsed.mcpServers.clickstack.url).toMatch(/\/api\/mcp$/);
    });

    test('builds a Cursor deep link with the access key embedded', async ({
      page,
    }) => {
      await page.goto('/team?tab=integrations');

      const section = page.getByTestId('mcp-server-section');
      await section.getByText('Cursor', { exact: true }).click();

      const addToCursor = section.getByRole('link', { name: /Add to Cursor/i });
      const href = await addToCursor.getAttribute('href');
      expect(href).toMatch(
        /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=clickstack&config=/,
      );

      const encoded = href!.split('config=')[1];
      const decoded = JSON.parse(
        Buffer.from(encoded, 'base64').toString('utf8'),
      );
      expect(decoded).toMatchObject({
        type: 'http',
        headers: { Authorization: `Bearer ${ACCESS_KEY}` },
      });
    });

    test('emits a Codex CLI one-liner', async ({ page }) => {
      await page.goto('/team?tab=integrations');

      const section = page.getByTestId('mcp-server-section');
      await section.getByText('Codex CLI', { exact: true }).click();

      // The codex CLI snippet renders inline; assert the documented
      // form is visible to the user with the fixed server name.
      await expect(
        section.getByText(/codex mcp add clickstack /),
      ).toBeVisible();
    });
  },
);
