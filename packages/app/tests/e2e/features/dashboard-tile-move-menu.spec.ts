import { Page } from '@playwright/test';

import { DashboardPage } from '../page-objects/DashboardPage';
import { getApiUrl } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';

test.use({ viewport: { width: 1280, height: 720 } });

const TAB_NAMES = [
  'Services',
  'Bff',
  'Queues',
  'App',
  'Orders',
  'Guest',
  'Ops',
];
const LAST_TARGET = 'Plain group 11';

const markdownTile = (id: string, x: number, w: number) => ({
  id,
  x,
  y: 0,
  w,
  h: 4,
  containerId: 'plain-12',
  config: {
    name: id,
    source: 'Logs',
    displayType: 'markdown',
    select: [],
    where: '',
    whereLanguage: 'lucene',
    markdown: id,
  },
});

// Enough groups that the move list is far taller than the viewport, with
// the tiles under test in the last group at the bottom of the page.
async function seedDashboard(page: Page): Promise<string> {
  const containers = [
    ...Array.from({ length: 6 }, (_, g) => ({
      id: `tabbed-${g}`,
      title: `Tabbed ${g + 1}`,
      collapsed: false,
      tabs: TAB_NAMES.map((name, t) => ({
        id: `tabbed-${g}-${t}`,
        title: `${name} ${g + 1}`,
      })),
    })),
    ...Array.from({ length: 12 }, (_, g) => ({
      id: `plain-${g + 1}`,
      title: `Plain group ${g + 1}`,
      collapsed: false,
    })),
  ];
  const res = await page.request.post(`${getApiUrl()}/dashboards`, {
    data: {
      name: `E2E tile move menu ${Date.now()}`,
      containers,
      tiles: [
        markdownTile('wide-tile', 0, 12),
        markdownTile('narrow-tile', 12, 3),
      ],
      tags: [],
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.id ?? body._id;
}

test.describe(
  'Dashboard tile move menu',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.gotoDashboard(await seedDashboard(page));
    });

    async function expectMoveTargetsReachable() {
      const submenu = await dashboardPage.openMoveToGroupSubmenu();
      // Fully on screen, so the last target is reached by the submenu's own scroll
      await expect(submenu).toBeInViewport({ ratio: 1 });
      const last = dashboardPage.getTileMenuItem(LAST_TARGET);
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
    }

    test('keeps Edit on screen for a tile at the bottom of the page', async () => {
      await dashboardPage.openTileActionsMenuById('wide-tile');
      await expect(dashboardPage.getTileMenuItem('Edit')).toBeInViewport();
      await expectMoveTargetsReachable();
    });

    test('keeps Edit on screen in the narrow-tile menu', async () => {
      await dashboardPage.openTileActionsMenuById('narrow-tile', {
        narrow: true,
      });
      await expect(dashboardPage.getTileMenuItem('Edit')).toBeInViewport();
      await expectMoveTargetsReachable();
    });
  },
);
