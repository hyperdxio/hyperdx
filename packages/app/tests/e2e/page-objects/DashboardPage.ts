/**
 * DashboardPage - Page object for dashboard pages
 * Encapsulates interactions with dashboard creation, editing, and tile management
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { expect, Locator, Page } from '@playwright/test';

import { ChartEditorComponent } from '../components/ChartEditorComponent';
import { TimePickerComponent } from '../components/TimePickerComponent';
import { getSqlEditor } from '../utils/locators';

/**
 * Config format tile config, as accepted by the external dashboard API.
 * Used with verifyTileFormFromConfig
 */
export type TileConfig = {
  displayType: Exclude<DisplayType, 'heatmap'>;
  sourceId?: string;
  select?:
    | {
        aggFn?: string;
        where?: string;
        whereLanguage?: 'sql' | 'lucene';
        alias?: string;
        valueExpression?: string;
      }[]
    | string;
  where?: string;
  whereLanguage?: 'sql' | 'lucene';
  groupBy?: string;
  markdown?: string;
};
type SeriesType =
  | 'time'
  | 'number'
  | 'table'
  | 'search'
  | 'markdown'
  | 'pie'
  | 'event_patterns'
  | 'bar';

/**
 * Series data structure for chart verification
 * Supports all chart types: time, number, table, search, markdown
 */
export type SeriesData = {
  type: SeriesType;
  sourceId?: string;
  aggFn?: string;
  field?: string;
  where?: string;
  whereLanguage?: 'sql' | 'lucene';
  groupBy?: string[];
  alias?: string;
  displayType?: 'line' | 'stacked_bar';
  sortOrder?: 'desc' | 'asc';
  fields?: string[]; // For search type
  content?: string; // For markdown type
  numberFormat?: Record<string, unknown>;
  metricDataType?: string;
  metricName?: string;
  level?: number;
};

export class DashboardPage {
  readonly page: Page;
  readonly timePicker: TimePickerComponent;
  readonly chartEditor: ChartEditorComponent;
  readonly granularityPicker: Locator;
  readonly searchInput: Locator;

  private readonly createDashboardButton: Locator;
  private readonly addDropdownButton: Locator;
  private readonly addTileMenuItem: Locator;
  private readonly addGroupMenuItem: Locator;
  private readonly dashboardNameHeading: Locator;
  private readonly searchSubmitButton: Locator;
  private readonly liveButton: Locator;
  private readonly tempDashboardBanner: Locator;
  private readonly editFiltersButton: Locator;
  private readonly filtersListModal: Locator;
  private readonly emptyFiltersListModal: Locator;
  private readonly addFiltersButton: Locator;
  private readonly closeFiltersModalButton: Locator;
  private readonly filtersSourceSelector: Locator;
  private readonly saveButton: Locator;
  private readonly tileSourceSelector: Locator;
  private readonly aliasInput: Locator;
  private readonly aggFnSelect: Locator;
  private readonly markdownTextarea: Locator;
  private readonly confirmModal: Locator;
  private readonly confirmCancelButton: Locator;
  private readonly confirmConfirmButton: Locator;
  private readonly dashboardMenuButton: Locator;
  private readonly deleteDashboardMenuItem: Locator;
  private readonly saveDefaultQueryAndFiltersMenuItem: Locator;
  private readonly removeDefaultQueryAndFiltersMenuItem: Locator;
  private readonly exportDashboardMenuItem: Locator;
  private readonly enterKioskModeMenuItem: Locator;
  private readonly exitKioskModeBtn: Locator;
  private readonly kioskHeaderContainer: Locator;
  private readonly kioskLiveStatusBadge: Locator;
  readonly appNav: Locator;

  constructor(page: Page) {
    this.page = page;
    this.timePicker = new TimePickerComponent(page);
    this.chartEditor = new ChartEditorComponent(page);

    this.createDashboardButton = page.locator(
      '[data-testid="create-dashboard-button"]',
    );
    this.addDropdownButton = page.locator(
      '[data-testid="add-dropdown-button"]',
    );
    this.addTileMenuItem = page.locator(
      '[data-testid="add-new-tile-menu-item"]',
    );
    this.addGroupMenuItem = page.getByTestId('add-new-group-menu-item');
    this.searchInput = page.locator('[data-testid="search-input"]');
    this.searchSubmitButton = page.locator(
      '[data-testid="search-submit-button"]',
    );
    this.liveButton = page.locator('button:has-text("Live")');
    this.dashboardNameHeading = page.getByRole('heading', { level: 3 });
    this.granularityPicker = page.getByTestId('granularity-picker');
    this.tempDashboardBanner = page.locator(
      '[data-testid="temporary-dashboard-banner"]',
    );
    this.editFiltersButton = page.getByTestId('edit-filters-button');
    this.filtersListModal = page.getByTestId('dashboard-filters-list');
    this.emptyFiltersListModal = page.getByTestId(
      'dashboard-filters-empty-state',
    );
    this.addFiltersButton = page.getByTestId('add-filter-button');
    this.closeFiltersModalButton = page.getByTestId('close-filters-button');
    this.filtersSourceSelector = page.getByTestId('source-selector');
    this.saveButton = page.getByTestId('chart-save-button');

    // Tile editor selectors
    this.tileSourceSelector = page.getByTestId('source-selector');
    this.aliasInput = page.getByTestId('series-alias-input');
    this.aggFnSelect = page.getByTestId('agg-fn-select');
    this.markdownTextarea = page.locator('textarea[name="markdown"]');
    this.confirmModal = page.getByTestId('confirm-modal');
    this.confirmCancelButton = page.getByTestId('confirm-cancel-button');
    this.confirmConfirmButton = page.getByTestId('confirm-confirm-button');
    this.dashboardMenuButton = page.getByTestId('dashboard-menu-button');
    this.deleteDashboardMenuItem = page.getByRole('menuitem', {
      name: 'Delete Dashboard',
    });
    this.saveDefaultQueryAndFiltersMenuItem = page.getByTestId(
      'save-default-query-filters-menu-item',
    );
    this.removeDefaultQueryAndFiltersMenuItem = page.getByTestId(
      'remove-default-query-filters-menu-item',
    );
    this.exportDashboardMenuItem = page.getByTestId(
      'export-dashboard-menu-item',
    );
    this.enterKioskModeMenuItem = page.getByTestId(
      'enter-kiosk-mode-menu-item',
    );
    this.exitKioskModeBtn = page.getByTestId('exit-kiosk-mode-button');
    this.kioskHeaderContainer = page.getByTestId('kiosk-header');
    this.kioskLiveStatusBadge = page.getByTestId('kiosk-live-status');
    this.appNav = page.getByTestId('app-nav');
  }

  /**
   * Navigate to the temporary dashboards page
   */
  async goto() {
    await this.page.goto('/dashboards', { waitUntil: 'networkidle' });
  }

  /**
   * Navigate to specific dashboard by ID
   */
  async gotoDashboard(dashboardId: string) {
    await this.page.goto(`/dashboards/${dashboardId}`);
  }

  /**
   * Extract the current dashboard's ID from the URL. Throws if the current
   * URL isn't on a /dashboards/<id> page.
   */
  getCurrentDashboardId(): string {
    const url = this.page.url();
    const match = url.match(/\/dashboards\/([^/?#]+)/);
    if (!match) throw new Error(`Not on a dashboard page: ${url}`);
    return match[1];
  }

  /**
   * Create a new dashboard
   */
  async createNewDashboard() {
    await this.createDashboardButton.click();
    await this.page.waitForURL(/\/dashboards\/.+/);
  }

  async changeGranularity(granularity: string) {
    await this.granularityPicker.click();

    // Wait for dropdown options to appear and click the desired option
    await this.page
      .locator('[role="option"]', { hasText: granularity })
      .click();
  }

  /**
   * Edit dashboard name
   */
  async editDashboardName(newName: string) {
    // Wait for initial dashboard name to load
    const defaultNameHeading = this.page.getByRole('heading', {
      name: 'My Dashboard',
      level: 3,
    });
    await defaultNameHeading.waitFor({ state: 'visible', timeout: 5000 });

    // Double-click to enter edit mode
    await defaultNameHeading.dblclick();

    // Fill in new name
    const nameInput = this.page.locator('input[placeholder="Name"]');
    await nameInput.fill(newName);
    await this.page.keyboard.press('Enter');

    // Wait for the name to be saved
    const updatedHeading = this.page.getByRole('heading', {
      name: newName,
      level: 3,
    });
    await updatedHeading.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Rename a dashboard from a known current name to a new name. Use when the
   * heading is no longer the "My Dashboard" default (e.g. already renamed
   * earlier in the same test).
   */
  async renameDashboard(currentName: string, newName: string) {
    const currentHeading = this.page.getByRole('heading', {
      name: currentName,
      level: 3,
    });
    await currentHeading.waitFor({ state: 'visible', timeout: 10000 });

    await currentHeading.dblclick();

    const nameInput = this.page.locator('input[placeholder="Name"]');
    await nameInput.fill(newName);
    await this.page.keyboard.press('Enter');

    const updatedHeading = this.page.getByRole('heading', {
      name: newName,
      level: 3,
    });
    await updatedHeading.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Add a new tile to the dashboard
   */
  async addTile() {
    await this.addDropdownButton.click();
    await this.addTileMenuItem.click();
  }

  /**
   * Add a new group (container) to the dashboard via the "+ Add" dropdown.
   */
  async addGroup() {
    await this.addDropdownButton.click();
    await this.addGroupMenuItem.click();
  }

  /**
   * Get the group container element by its container id.
   */
  getGroup(containerId: string): Locator {
    return this.page.getByTestId(`group-container-${containerId}`);
  }

  /**
   * Get all rendered group containers in DOM order.
   */
  getGroups(): Locator {
    return this.page.locator('[data-testid^="group-container-"]');
  }

  /**
   * Read the container ids of all groups in DOM order. Each id is parsed
   * out of the `group-container-${id}` testid. Drops empty entries to
   * surface DOM regressions (a group rendered without the testid prefix
   * would otherwise show as `""` and silently pass equality checks).
   */
  async getGroupOrder(): Promise<string[]> {
    const groups = this.getGroups();
    const ids = await groups.evaluateAll(elements =>
      elements.map(el => {
        const testId = el.getAttribute('data-testid') ?? '';
        return testId.replace(/^group-container-/, '');
      }),
    );
    return ids.filter(id => id.length > 0);
  }

  /**
   * Wait for the dashboard page shell to be visible. Used after reload /
   * cross-page navigation to a single point of synchronisation.
   */
  async waitForLoaded() {
    await expect(this.page.getByTestId('dashboard-page')).toBeVisible();
  }

  /** Locator for a group's collapse/expand chevron. */
  getGroupChevron(containerId: string): Locator {
    return this.page.getByTestId(`group-chevron-${containerId}`);
  }

  /** Locator for the bordered toggle menu item inside a group's overflow menu. */
  getGroupBorderedToggle(containerId: string): Locator {
    return this.page.getByTestId(`group-toggle-bordered-${containerId}`);
  }

  /** Locator for the visible tabs inside a group's tab bar. */
  getGroupTabs(containerId: string): Locator {
    return this.getGroup(containerId).getByRole('tab');
  }

  /**
   * Read the inline border state of a group via the `data-bordered`
   * attribute. Reading the attribute (rather than inspecting inline
   * `style.border`) keeps the spec decoupled from how borders happen to
   * be applied.
   */
  getGroupBorderedAttr(containerId: string): Promise<string | null> {
    return this.getGroup(containerId).getAttribute('data-bordered');
  }

  /**
   * Wait for a backend dashboard PATCH (the fire-and-forget mutation that
   * `setDashboard` issues) to land before navigating away. Required between
   * any state mutation that the round-trip test relies on and the next
   * `goto`/reload, because `setDashboard` is fire-and-forget and a fast
   * navigation drops the in-flight request.
   */
  async waitForDashboardPatch() {
    await this.page.waitForResponse(
      r =>
        r.url().includes('/api/dashboards/') &&
        r.request().method() === 'PATCH' &&
        r.ok(),
      { timeout: 15000 },
    );
  }

  /**
   * Hover the group then open its overflow ("...") menu so subsequent
   * menu-item helpers can click into it.
   *
   * The menu trigger lives behind `pointer-events: none` until the React
   * `hovered` state commits (DashboardContainer.tsx:106-109,
   * `hoverControlStyle`). Playwright's auto-wait checks visibility but
   * not `pointer-events`, so the click can land on a hidden-from-input
   * element. Wait for `pointer-events` to clear before clicking.
   */
  async openGroupMenu(containerId: string) {
    const group = this.getGroup(containerId);
    await group.hover();
    const trigger = this.page.getByTestId(`group-menu-${containerId}`);
    await expect(trigger).not.toHaveCSS('pointer-events', 'none');
    await trigger.click();
  }

  /**
   * Toggle the bordered visual style via the overflow menu.
   */
  async toggleGroupBordered(containerId: string) {
    await this.openGroupMenu(containerId);
    await this.page.getByTestId(`group-toggle-bordered-${containerId}`).click();
  }

  /**
   * Add a new tab to the group via the overflow menu.
   */
  async addTabToGroup(containerId: string) {
    await this.openGroupMenu(containerId);
    await this.page.getByTestId(`group-add-tab-${containerId}`).click();
  }

  /**
   * Read the `?activeTabs` query param as a `{ containerId: tabId }` map.
   * Returns an empty object when the param is missing or malformed.
   *
   * The serializer is `parseAsJsonEncoded` (see
   * `packages/app/src/utils/queryParsers.ts`), which double-encodes its
   * value to survive the Microsoft-Teams `+` -> `%2B` re-encoding. nuqs
   * writes `encodeURIComponent(JSON.stringify(value))` AND then nuqs's
   * URL machinery encodes the resulting `%XX` sequences a second time.
   * `searchParams.get(...)` decodes one level, so we have to decode the
   * second level ourselves before `JSON.parse` to recover the object.
   * The fallback to plain `JSON.parse` keeps us compatible with the
   * old single-encoded format, mirroring the parser.
   */
  getActiveTabsParam(): Record<string, string> {
    const url = new URL(this.page.url());
    const raw = url.searchParams.get('activeTabs');
    if (!raw) return {};
    const tryParse = (value: string): unknown => {
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    };
    let parsed: unknown;
    try {
      parsed = tryParse(decodeURIComponent(raw));
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined) parsed = tryParse(raw);
    // `JSON.parse` returns `any`. Anything other than a non-array object
    // (e.g. `"123"`, `null`, `[…]`) would lie to callers and silently
    // fail downstream `expect.poll(() => …[id])` checks.
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    // Build the result explicitly so the `string` value type is enforced
    // at runtime (and we don't trust JSON.parse's `any` return).
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') result[key] = value;
    }
    return result;
  }

  /**
   * Read the `?collapsed` query param as an array of container ids. nuqs
   * serializes arrays as comma-separated values (`?collapsed=id1,id2`).
   * Returns an empty array when the param is missing.
   */
  getCollapsedParam(): string[] {
    const raw = new URL(this.page.url()).searchParams.get('collapsed');
    return raw ? raw.split(',') : [];
  }

  /**
   * Read the `?expanded` query param as an array of container ids. Mirrors
   * `getCollapsedParam` semantics.
   */
  getExpandedParam(): string[] {
    const raw = new URL(this.page.url()).searchParams.get('expanded');
    return raw ? raw.split(',') : [];
  }

  /**
   * Drag a group's drag handle onto another group, reordering them.
   *
   * @dnd-kit's MouseSensor uses `activationConstraint: { distance: 8 }`
   * (see DashboardDndContext.tsx). The handle has to traverse 8+ pixels
   * before the drag activates, so a single-shot drop never registers.
   * The multi-step `mouse.move` mirrors the existing histogram-brush
   * pattern in SearchPage.ts.
   *
   * Stability notes:
   *  - Pointerdown is preceded by a `mouse.move(startX, startY)` so the
   *    pointerdown coalesces deterministically.
   *  - The activation nudge is 10px (just past the 8px threshold) and
   *    stays inside the drag handle's bounds so we never leave the hit
   *    area before activation registers.
   *  - The target's `boundingBox()` is recomputed immediately before the
   *    final move, because @dnd-kit applies a 250ms sortable-item
   *    transform that shifts neighbouring containers while the drag is
   *    in flight.
   */
  async dragGroupTo(fromContainerId: string, toContainerId: string) {
    const handle = this.page.getByTestId(
      `group-drag-handle-${fromContainerId}`,
    );
    const target = this.getGroup(toContainerId);
    await handle.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();

    const handleBox = await handle.boundingBox();
    if (!handleBox) {
      throw new Error('Drag source not visible');
    }

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    await this.page.mouse.move(startX, startY);
    await this.page.mouse.move(startX, startY); // stabilise pointerdown coalescing
    await this.page.mouse.down();
    // Nudge to cross the 8px activation threshold while staying inside
    // the handle's hit area.
    await this.page.mouse.move(startX + 10, startY, { steps: 5 });

    // Recompute the target box after activation; @dnd-kit shifts
    // sibling containers during the drag and a stale box can land the
    // pointer on the wrong neighbour.
    const targetBox = await target.boundingBox();
    if (!targetBox) {
      await this.page.mouse.up();
      throw new Error('Drag target not visible after activation');
    }
    const endX = targetBox.x + targetBox.width / 2;
    const endY = targetBox.y + targetBox.height / 2;

    await this.page.mouse.move(endX, endY, { steps: 15 });
    await this.page.mouse.up();
  }

  /**
   * save tile to the dashboard
   */
  async saveTile() {
    await this.saveButton.click();
  }

  /**
   * Create a new dashboard and open the tile editor (add tile), waiting for it to be ready.
   * Use when testing the chart/tile editor modal in isolation.
   */
  async openNewTileEditor() {
    await this.createDashboardButton.click();
    await this.page.waitForURL(/\/dashboards\/.+/);
    await this.addDropdownButton.click();
    await this.addTileMenuItem.click();
    await expect(this.chartEditor.nameInput).toBeVisible();
    await this.chartEditor.waitForDataToLoad();
  }

  /**
   * Add a tile with specific configuration
   */
  async addTileWithConfig(chartName: string) {
    await this.addTile();

    const chartNameInput = this.page.locator(
      '[data-testid="chart-name-input"]',
    );
    await chartNameInput.fill(chartName);

    const runQueryButton = this.page.locator(
      '[data-testid="chart-run-query-button"]',
    );
    await runQueryButton.click();

    // Wait for query to complete
    await this.page.waitForResponse(
      resp => resp.url().includes('/clickhouse-proxy') && resp.status() === 200,
    );
    // Wait for tile to be added
    await this.saveTile();
  }

  /**
   * Add a tile bound to an explicit source. Unlike addTileWithConfig (which
   * relies on the editor's default source), this selects a known source so the
   * exported tile carries a deterministic source name that auto-maps on import.
   */
  async addTileWithSource(chartName: string, sourceName: string) {
    await this.addTile();
    await expect(this.chartEditor.nameInput).toBeVisible();
    await this.chartEditor.waitForDataToLoad();
    await this.chartEditor.setChartName(chartName);
    await this.chartEditor.selectSource(sourceName);
    await this.chartEditor.runQuery(false);
    await this.chartEditor.save();
    await expect(this.getTiles()).toHaveCount(1, { timeout: 10000 });
  }

  /**
   * Get all dashboard tiles
   */
  getTiles() {
    return this.page.locator('[data-testid^="dashboard-tile-"]');
  }

  /**
   * Get specific tile by index
   */
  getTile(index: number) {
    return this.getTiles().nth(index);
  }

  /**
   * Hover over a tile to reveal action buttons
   */
  async hoverOverTile(index: number) {
    await this.getTile(index).hover();
  }

  /**
   * Get tile action button
   */
  getTileButton(action: 'edit' | 'duplicate' | 'delete' | 'alerts') {
    return this.page.locator(`[data-testid^="tile-${action}-button-"]`).first();
  }

  /**
   * Open a tile's actions (kebab) menu, revealing the Duplicate / View
   * fullscreen / Edit / Delete items (which now live inside the menu).
   */
  async openTileActionsMenu(tileIndex: number) {
    await this.page
      .locator('[data-testid^="tile-actions-button-"]')
      .nth(tileIndex)
      .click();
  }

  /**
   * Edit a tile
   */
  async editTile(tileIndex: number) {
    await this.openTileActionsMenu(tileIndex);
    await this.getTileButton('edit').click();
  }

  /**
   * Duplicate a tile
   */
  async duplicateTile(tileIndex: number) {
    await this.openTileActionsMenu(tileIndex);
    await this.getTileButton('duplicate').click();

    const confirmButton = this.page.locator(
      '[data-testid="confirm-confirm-button"]',
    );
    await confirmButton.click();
  }

  /**
   * Delete a tile
   */
  async deleteTile(tileIndex: number) {
    await this.openTileActionsMenu(tileIndex);
    await this.getTileButton('delete').click();

    const confirmButton = this.page.locator(
      '[data-testid="confirm-confirm-button"]',
    );
    await confirmButton.click();
  }

  /**
   * Set global dashboard filter
   */
  async setGlobalFilter(filter: string) {
    await this.searchInput.fill(filter);
    await this.searchSubmitButton.click();
  }

  async saveQueryAndFiltersAsDefault() {
    await this.dashboardMenuButton.click();
    await this.saveDefaultQueryAndFiltersMenuItem.click();
  }

  async removeSavedQueryAndFiltersDefaults() {
    await this.dashboardMenuButton.click();
    await this.removeDefaultQueryAndFiltersMenuItem.click();
  }

  async deleteDashboard() {
    await this.dashboardMenuButton.click();
    await this.deleteDashboardMenuItem.click();
  }

  /**
   * Export the current dashboard via the dashboard menu and return the parsed
   * JSON that was downloaded. The export triggers a client-side anchor download
   * (see `downloadObjectAsJson` in DBDashboardPage), so we capture the
   * Playwright download event and read its stream.
   */
  async exportDashboard(): Promise<Record<string, any>> {
    await this.dashboardMenuButton.click();
    const downloadPromise = this.page.waitForEvent('download');
    await this.exportDashboardMenuItem.click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  }

  /**
   * Toggle live mode
   */
  async toggleLiveMode() {
    await this.liveButton.click();
  }

  /**
   * Navigate to a dashboard by name from the list
   */
  async goToDashboardByName(name: string) {
    const dashboardLink = this.page.locator(`text="${name}"`);
    await dashboardLink.click();
    await this.page.waitForURL('**/dashboards/**');
  }

  /**
   * Get dashboard name heading by name
   */
  getDashboardHeading(name: string) {
    return this.page.getByRole('heading', { name, level: 3 });
  }

  /**
   * Get chart containers (recharts)
   */
  getChartContainers() {
    return this.page.locator('.recharts-responsive-container');
  }

  /**
   * Read the trimmed text of all th cells in the first thead tr of the
   * given tile's rendered table. Waits for the table to be visible first.
   */
  async getTileTableHeaders(tileIndex: number): Promise<string[]> {
    const tile = this.getTile(tileIndex);
    const table = tile.locator('table').first();
    await table.waitFor({ state: 'visible', timeout: 15000 });
    const headers = await table.locator('thead tr th').allTextContents();
    return headers.map(h => h.trim());
  }

  /** Open the Edit Filters Modal */
  async openEditFiltersModal() {
    await this.editFiltersButton.click();
  }

  /** Close the Edit Filters Modal */
  async closeFiltersModal() {
    await this.closeFiltersModalButton.click();
  }

  async fillFilterForm(
    name: string,
    sourceName: string,
    expression: string,
    metricType?: string,
    appliesToSourceNames?: string[],
  ) {
    const filterNameInput = this.page.getByTestId('filter-name-input');
    await filterNameInput.fill(name);

    await this.filtersSourceSelector.click();
    await this.page
      .getByRole('option', { name: sourceName, exact: true })
      .click();

    const editor = getSqlEditor(this.page, 'expression');
    await editor.click();
    await this.page.keyboard.type(expression);

    if (metricType) {
      await this.page
        .getByRole('radio', { name: metricType, exact: true })
        .click();
    }

    if (appliesToSourceNames && appliesToSourceNames.length > 0) {
      const appliesToSelector = this.page.getByTestId(
        'applies-to-source-selector',
      );
      for (const appliesName of appliesToSourceNames) {
        await appliesToSelector.click();
        await this.page
          .getByRole('option', { name: appliesName, exact: true })
          .click();
      }
      // Close the dropdown so the save button is clickable.
      await this.page.keyboard.press('Escape');
    }

    const saveFilterButton = this.page.getByTestId('save-filter-button');
    await saveFilterButton.click();
  }

  async addFilterToDashboard(
    name: string,
    sourceName: string,
    expression: string,
    metricType?: string,
    appliesToSourceNames?: string[],
  ) {
    await this.addFiltersButton.click();

    await this.fillFilterForm(
      name,
      sourceName,
      expression,
      metricType,
      appliesToSourceNames,
    );
  }

  getFilterLabel(name: string) {
    return this.page.getByTestId(`dashboard-filter-help-${name}`);
  }

  async deleteFilterFromDashboard(name: string) {
    const deleteButton = this.page.getByTestId(`delete-filter-button-${name}`);
    await deleteButton.click();
  }

  async editFilter(
    currentName: string,
    name: string,
    sourceName: string,
    expression: string,
    metricType?: string,
  ) {
    const editButton = this.page.getByTestId(
      `edit-filter-button-${currentName}`,
    );
    await editButton.click();

    await this.fillFilterForm(name, sourceName, expression, metricType);
  }

  getFilterItemByName(name: string) {
    return this.page.getByTestId(`dashboard-filter-item-${name}`);
  }

  getFilterSelectByName(name: string) {
    return this.page.getByTestId(`dashboard-filter-select-${name}`);
  }

  /**
   * Locator for the freeform search/text field inside a dashboard filter's
   * select (the underlying Mantine `PillsInput.Field`). Scoped to the
   * filter's select test id so it stays unambiguous across multiple filters.
   */
  getFilterSearchInput(filterName: string): Locator {
    return this.getFilterSelectByName(filterName).getByRole('textbox');
  }

  /**
   * Locator for the pill rendered for `value` inside a dashboard filter's
   * select. Pills (Mantine `Pill`) render the selected value as their text
   * content; scoping to the filter select keeps this from matching an
   * equally-named dropdown option or another filter's pill.
   */
  getFilterPill(filterName: string, value: string): Locator {
    return this.getFilterSelectByName(filterName).getByText(value, {
      exact: true,
    });
  }

  /**
   * Locator for the "Nothing found..." Combobox.Empty state rendered when a
   * dashboard filter's search text matches no dropdown option. This renders
   * in a portaled Combobox.Dropdown outside the filter select's DOM subtree,
   * so it's located at the page level. `.first()` guards against multiple
   * (mostly-hidden) dropdown portals coexisting in the DOM.
   */
  getFilterEmptyDropdownState(): Locator {
    return this.page.getByText('Nothing found...').first();
  }

  /**
   * Click into a dashboard filter's select and type `value` into its search
   * field without submitting. Used to drive the freeform-filter-value flow,
   * where the caller asserts the "Nothing found..." empty dropdown state
   * before pressing Enter (see `submitFilterSearchValue`) to add the typed
   * value as a pill.
   */
  async typeFilterSearchValue(filterName: string, value: string) {
    const select = this.getFilterSelectByName(filterName);
    await select.click();
    const input = this.getFilterSearchInput(filterName);
    await input.click();
    await input.fill(value);
  }

  /**
   * Press Enter in a dashboard filter's search field. When no dropdown
   * option is keyboard-highlighted, `VirtualMultiSelect` treats this as
   * "add the typed value as a pill" rather than submitting a highlighted
   * option (see `handleKeyDown` in VirtualMultiSelect.tsx).
   */
  async submitFilterSearchValue(filterName: string) {
    await this.getFilterSearchInput(filterName).press('Enter');
  }

  /**
   * Focus a dashboard filter's (empty) search field and press Backspace,
   * removing the most recently added pill. Mirrors `handleKeyDown`'s
   * "Backspace with empty search removes the last value" behavior.
   */
  async removeLastFilterPillViaBackspace(filterName: string) {
    const input = this.getFilterSearchInput(filterName);
    await input.click();
    await input.press('Backspace');
  }

  /**
   * Create a Number tile that counts events from `sourceName`. The tile editor's
   * default aggregation is "Count of Events", so no agg configuration is needed.
   * Leaves exactly one tile on the dashboard.
   */
  async addNumberTile(name: string, sourceName: string) {
    await this.addTile();
    await expect(this.chartEditor.nameInput).toBeVisible();
    await this.chartEditor.waitForDataToLoad();
    await this.chartEditor.setChartType(DisplayType.Number);
    await this.chartEditor.setChartName(name);
    await this.chartEditor.selectSource(sourceName);
    await this.chartEditor.runQuery(false);
    await this.chartEditor.save();
    await expect(this.getTiles()).toHaveCount(1, { timeout: 10000 });
  }

  /** Locator for the rendered value of a Number tile. */
  getNumberTileValue(tileIndex = 0): Locator {
    return this.getTile(tileIndex).getByTestId('number-chart-value');
  }

  /** Locator for a tile's error state (rendered by ChartErrorState). */
  getTileError(tileIndex = 0): Locator {
    return this.getTile(tileIndex).getByText(/Error loading/i);
  }

  /**
   * Add a dashboard filter whose key is an arbitrary column expression. Unlike
   * `fillFilterForm`, the expression is inserted via `insertText` so CodeMirror's
   * bracket/quote auto-closing does not corrupt expressions containing `[`, `'`,
   * or backticks. Assumes the Edit Filters modal is already open; leaves it open
   * (on the filters list) so multiple filters can be added in sequence.
   */
  async addCustomFilter(name: string, sourceName: string, expression: string) {
    await this.addFiltersButton.click();
    const nameInput = this.page.getByTestId('filter-name-input');
    await nameInput.waitFor({ state: 'visible', timeout: 10000 });
    await nameInput.fill(name);
    await this.filtersSourceSelector.click();
    await this.page
      .getByRole('option', { name: sourceName, exact: true })
      .click();
    const editor = getSqlEditor(this.page, 'expression');
    await editor.click();
    await this.page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
    );
    await this.page.keyboard.press('Backspace');
    await this.page.keyboard.insertText(expression);
    // Blur the SQL editor before saving so its CodeMirror autocomplete tooltip
    // closes — left open it overlaps the save button and makes the click flake
    // on "element is not stable".
    await nameInput.click();
    const saveButton = this.page.getByTestId('save-filter-button');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    // Wait for the filter to actually land in the list before returning, so a
    // slow save doesn't race the next add (which would silently drop a filter).
    await this.getFilterItemByName(name).waitFor({
      state: 'visible',
      timeout: 10000,
    });
  }

  /**
   * Toggle a value in a dashboard filter's multi-select. Selecting an unselected
   * value applies it; calling again with the same value clears it. Closes the
   * dropdown afterward so the rest of the dashboard is interactable.
   */
  async toggleFilterValue(filterName: string, value: string) {
    const select = this.getFilterSelectByName(filterName);
    await select.waitFor({ state: 'visible', timeout: 15000 });
    await select.scrollIntoViewIfNeeded();
    await select.click();
    const option = this.page.getByRole('option', { name: value, exact: true });
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click();
    await this.page.keyboard.press('Escape');
  }

  async clickFilterOption(filterName: string, option: string) {
    const serviceFilter = this.getFilterSelectByName(filterName);
    serviceFilter.click();
    const optionLocator = this.page.getByRole('option', {
      name: option,
      exact: true,
    });
    await optionLocator.click();
  }

  /**
   * Get CodeMirror editor by filtering for specific text content
   */
  getCodeMirrorEditor(text: string) {
    return this.page.locator('.cm-content').filter({ hasText: text });
  }

  getChartTypeTab(type: SeriesType) {
    if (type === 'time') {
      return this.page.getByRole('tab', { name: /time series/i });
    }
    return this.page.getByRole('tab', { name: new RegExp(type, 'i') });
  }

  /**
   * Convert a config-format tile config to SeriesData for form verification.
   */
  private configToSeriesData(config: TileConfig): SeriesData[] {
    if (config.displayType === 'markdown') {
      return [{ type: 'markdown', content: config.markdown }];
    }

    if (config.displayType === 'search') {
      return [
        {
          type: 'search',
          sourceId: config.sourceId,
          where: config.where,
          whereLanguage: config.whereLanguage ?? 'lucene',
        },
      ];
    }

    const type: SeriesData['type'] =
      config.displayType === 'line' || config.displayType === 'stacked_bar'
        ? 'time'
        : config.displayType;

    const groupBy = config.groupBy ? [config.groupBy] : undefined;
    const selectItems = Array.isArray(config.select) ? config.select : [];

    return selectItems.map(item => ({
      type,
      sourceId: config.sourceId,
      aggFn: item.aggFn,
      where: item.where,
      whereLanguage: item.whereLanguage ?? 'lucene',
      alias: item.alias,
      field: item.valueExpression,
      groupBy,
    }));
  }

  /**
   * Verify tile edit form using the config-format tile config directly,
   * avoiding the need for a separate SeriesData verification array.
   */
  async verifyTileFormFromConfig(
    config: TileConfig,
    expectedSourceName?: string,
  ) {
    await this.verifyTileForm(
      this.configToSeriesData(config),
      expectedSourceName,
    );
  }

  /**
   * Verify tile edit form matches the given series data
   * @param series - Array of series data from the API request
   * @param expectedSourceName - Optional expected source name for verification
   */
  async verifyTileForm(series: SeriesData[], expectedSourceName?: string) {
    for (let i = 0; i < series.length; i++) {
      const seriesData = series[i];

      // Verify markdown content for markdown tiles
      if (seriesData.content) {
        const content = await this.markdownTextarea.first().inputValue();
        expect(content).toContain(seriesData.content);
      }

      const chartTypeTab = this.getChartTypeTab(seriesData.type);
      await expect(chartTypeTab).toHaveAttribute('aria-selected', 'true');

      // Verify source selector for charts with sources
      if (seriesData.sourceId && expectedSourceName) {
        await expect(this.tileSourceSelector).toBeVisible();
        await expect(this.tileSourceSelector).toHaveValue(expectedSourceName);
      }

      // Verify alias
      if (seriesData.alias) {
        await expect(this.aliasInput.nth(i)).toBeVisible();
        await expect(this.aliasInput.nth(i)).toHaveValue(seriesData.alias);
      }

      // Verify aggregation function
      if (seriesData.aggFn) {
        await expect(this.aggFnSelect.nth(i)).toBeVisible();
        await expect(this.aggFnSelect.nth(i)).toHaveValue(
          new RegExp(seriesData.aggFn, 'i'),
        );
      }

      // Verify field expression
      if (seriesData.field) {
        const fieldEditor = this.getCodeMirrorEditor(seriesData.field);
        const fieldValue = await fieldEditor.first().textContent();
        expect(fieldValue).toContain(seriesData.field);
      }

      // Verify where clause (handles both Lucene textarea and SQL CodeMirror)
      if (seriesData.where) {
        if (seriesData.whereLanguage === 'sql') {
          const whereEditor = this.getCodeMirrorEditor(seriesData.where);
          const whereValue = await whereEditor.first().textContent();
          expect(whereValue).toContain(seriesData.where);
        } else {
          const whereTextarea = this.page.locator('textarea').filter({
            hasText: seriesData.where,
          });
          await expect(whereTextarea).toBeVisible();
        }
      }

      // Verify group by
      if (seriesData.groupBy && seriesData.groupBy.length > 0) {
        const groupByEditor = this.getCodeMirrorEditor(seriesData.groupBy[0]);
        const groupByValue = await groupByEditor.first().textContent();
        expect(groupByValue).toContain(seriesData.groupBy[0]);
      }
    }
  }

  // ---- Table tile helpers ----

  /**
   * Wait for the table tile at the given index to render at least one data row.
   */
  async waitForTableTileRows(tileIndex = 0) {
    await this.getTile(tileIndex)
      .locator('table tbody tr')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * Get the `title` attribute of a cell (by column index) in the first row of
   * a table tile. The <td> title mirrors the cell's stringified value, useful
   * for extracting column values (e.g. a ServiceName) for later assertions.
   */
  async getFirstTableRowValue(tileIndex = 0, columnIndex = 0): Promise<string> {
    const cell = this.getTile(tileIndex)
      .locator('table tbody tr')
      .first()
      .locator('td')
      .nth(columnIndex);
    return (await cell.getAttribute('title')) ?? '';
  }

  /**
   * Return the trimmed text of every td at `columnIndex` across all visible
   * data rows of the given tile's first table. Scopes to `tr[data-index]` so
   * the row virtualizer's padding rows (which contain a single colSpan td)
   * are skipped. Waits for at least one data row before reading.
   */
  async getTileTableCellTexts(
    tileIndex: number,
    columnIndex: number,
  ): Promise<string[]> {
    const tile = this.getTile(tileIndex);
    const table = tile.locator('table').first();
    await table.waitFor({ state: 'visible', timeout: 15000 });
    await table
      .locator('tbody tr[data-index]')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
    const cells = await table
      .locator(`tbody tr[data-index] td:nth-child(${columnIndex + 1})`)
      .allTextContents();
    return cells.map(c => c.trim());
  }

  /**
   * Click the first row's first cell of a table tile. Each cell carries
   * `data-testid="dashboard-table-row-action"` on either the success
   * anchor (Next.js Link) or the failure button, so a single selector
   * matches both branches.
   */
  async clickFirstTableRow(tileIndex = 0) {
    await this.getTile(tileIndex)
      .locator('table tbody tr')
      .first()
      .locator('[data-testid="dashboard-table-row-action"]')
      .first()
      .click();
  }

  /**
   * Return the first row's action element (anchor or button) of a table
   * tile. Carries `data-testid="dashboard-table-row-action"`. Useful for
   * asserting on rendered link attributes (href / target / rel / data-shape)
   * without triggering navigation — e.g. external links open a new tab.
   */
  getFirstRowActionLink(tileIndex = 0): Locator {
    return this.getTile(tileIndex)
      .locator('table tbody tr')
      .first()
      .locator('[data-testid="dashboard-table-row-action"]')
      .first();
  }

  /**
   * Return the first data row (<tr data-index>) of the table in the
   * given tile. Used for hover-based interactions (e.g. tooltip tests).
   */
  getFirstTableRow(tileIndex = 0): Locator {
    return this.getTile(tileIndex)
      .locator('table tbody tr[data-index]')
      .first();
  }

  /**
   * Locator for the trailing arrow hint element rendered in the last
   * cell of clickable rows. The icon (arrow-up-right) carries
   * `data-testid="row-action-hint"` and is the trigger element for the
   * anchored Mantine Tooltip describing the row's onClick destination.
   */
  getRowActionHint(tileIndex = 0): Locator {
    return this.getTile(tileIndex)
      .locator('table tbody tr[data-index]')
      .first()
      .getByTestId('row-action-hint');
  }

  /**
   * Hover the first data row of a table tile, then hover its trailing
   * arrow hint so the anchored Mantine Tooltip opens. Returns the
   * tooltip locator so callers can assert on the description text.
   *
   * The arrow icon (`data-testid="row-action-hint"`) is hidden
   * (`opacity: 0`) until the row is hovered. Hovering the row reveals
   * the icon via the `.tableRow:hover .rowActionHint` CSS rule. The
   * Mantine Tooltip wrapping the icon then opens when the cursor moves
   * to the icon itself, rendering its label in a portal at the body.
   *
   * The returned locator narrows the role match by name so the assertion
   * does not collide with header-cell or resize-handle tooltips that
   * may also live in the portal at the moment of the check
   * (Search-suggestion onClick wording, dashboard-open wording, etc.).
   */
  async hoverFirstTableRowAndGetTooltip(tileIndex = 0): Promise<Locator> {
    const row = this.getFirstTableRow(tileIndex);
    await row.hover();
    const hint = this.getRowActionHint(tileIndex);
    // Hover the icon directly so the anchored Tooltip's mouseEnter
    // listener fires; row-hover alone only fades the icon in.
    await hint.hover();
    const tooltip = this.page.getByRole('tooltip', { name: /Search|Open/ });
    await tooltip.waitFor({ state: 'visible', timeout: 5000 });
    return tooltip;
  }

  /**
   * Locator for the Mantine toast raised by useOnClickLinkBuilder when the
   * configured onClick action fails (unknown source, missing row column, etc).
   */
  getLinkErrorNotification() {
    return this.page
      .locator('.mantine-Notification-root')
      .filter({ hasText: 'Link error' });
  }

  /**
   * Banner shown on the dashboard page when the URL's `filters=` param
   * references expressions that don't correspond to any declared dashboard
   * filter. Users can dismiss it with the close button.
   */
  get ignoredUrlFiltersBanner() {
    return this.page.getByTestId('ignored-url-filters-banner');
  }

  /**
   * Dismiss the ignored-URL-filters banner by clicking its close button.
   * Mantine's Alert renders the close button with `aria-label="Dismiss"`.
   */
  async dismissIgnoredUrlFiltersBanner() {
    await this.ignoredUrlFiltersBanner
      .getByRole('button', { name: 'Dismiss' })
      .click();
  }

  // ---- Kiosk mode helpers ----

  /**
   * Open the dashboard overflow menu and click "Enter kiosk mode".
   * Expects the menu item with data-testid="enter-kiosk-mode-menu-item".
   */
  async enterKioskMode() {
    await this.dashboardMenuButton.click();
    await this.enterKioskModeMenuItem.click();
  }

  /**
   * Click the "Exit kiosk mode" button (data-testid="exit-kiosk-mode-button")
   * that is rendered as part of the kiosk chrome.
   */
  async exitKioskMode() {
    await this.exitKioskModeBtn.click();
  }

  /**
   * Locator scoped to the kiosk header bar that contains `name` as text.
   * Used to verify the saved dashboard name is displayed in kiosk mode.
   */
  getKioskHeading(name: string): Locator {
    return this.kioskHeaderContainer.getByText(name, { exact: false });
  }

  /** The full kiosk header bar (data-testid="kiosk-header"). */
  get kioskHeader(): Locator {
    return this.kioskHeaderContainer;
  }

  /**
   * The "Live" read-only status badge shown in kiosk mode
   * (data-testid="kiosk-live-status").
   */
  get kioskLiveStatus(): Locator {
    return this.kioskLiveStatusBadge;
  }

  /**
   * The first tile actions (kebab) button. In kiosk mode this should be absent
   * or hidden, confirming that tile edit affordances are locked.
   */
  get firstTileActionsButton(): Locator {
    return this.page.locator('[data-testid^="tile-actions-button-"]').first();
  }

  /**
   * The dashboard overflow ("...") menu button. Exposed so specs can assert
   * it is hidden in kiosk mode without needing to open it.
   */
  get menuButton(): Locator {
    return this.dashboardMenuButton;
  }

  // Getters for assertions

  get createButton() {
    return this.createDashboardButton;
  }

  get addButton() {
    return this.addDropdownButton;
  }

  get dashboardName() {
    return this.dashboardNameHeading;
  }

  get filterInput() {
    return this.searchInput;
  }

  get filterSubmitButton() {
    return this.searchSubmitButton;
  }

  get temporaryDashboardBanner() {
    return this.tempDashboardBanner;
  }

  get filtersList() {
    return this.filtersListModal;
  }

  get emptyFiltersList() {
    return this.emptyFiltersListModal;
  }

  get unsavedChangesConfirmModal() {
    return this.confirmModal;
  }

  get unsavedChangesConfirmCancelButton() {
    return this.confirmCancelButton;
  }

  get unsavedChangesConfirmDiscardButton() {
    return this.confirmConfirmButton;
  }

  // ---- Fullscreen tile helpers ----

  /**
   * The Mantine Modal body that hosts the fullscreen tile view.
   * Scoped by the presence of a time-picker-input so it stays unambiguous
   * even when other modals (e.g. the chart editor) are open simultaneously.
   */
  get fullscreenModalBody() {
    return this.page
      .locator('.mantine-Modal-body')
      .filter({ has: this.page.getByTestId('time-picker-input') });
  }

  /**
   * The time-picker-input inside the fullscreen modal.
   * Scoped to fullscreenModalBody so it never matches the dashboard's
   * main time picker when both exist in the DOM.
   */
  get fullscreenTimePickerInput() {
    return this.fullscreenModalBody.getByTestId('time-picker-input');
  }

  /**
   * Hover over the tile at `index` and click its fullscreen button
   * (`data-testid="tile-fullscreen-button-<chartId>"`).
   * Waits for the fullscreen modal's TimePicker to appear before returning.
   */
  async openFullscreenForTile(index: number) {
    await this.openTileActionsMenu(index);
    const fullscreenBtn = this.page
      .locator('[data-testid^="tile-fullscreen-button-"]')
      .first();
    await fullscreenBtn.click();
    await this.fullscreenTimePickerInput.waitFor({
      state: 'visible',
      timeout: 10000,
    });
  }

  /**
   * Select a relative time interval from the TimePicker inside the fullscreen
   * modal (e.g. "Last 15 minutes").
   * Opens the picker popover first if it is not already visible.
   */
  async selectFullscreenRelativeTime(label: string) {
    const input = this.fullscreenTimePickerInput;
    const popover = this.page.getByTestId('time-picker-popover');
    const isOpen = await popover.isVisible();
    if (!isOpen) {
      await input.click();
      await popover.waitFor({ state: 'visible', timeout: 5000 });
    }
    const intervalButton = popover.getByRole('button', { name: label });
    await intervalButton.waitFor({ state: 'visible', timeout: 5000 });
    await intervalButton.click({ timeout: 10000 });
  }

  /**
   * Close the fullscreen modal by pressing Escape and wait for it to disappear.
   */
  async closeFullscreen() {
    await this.page.keyboard.press('Escape');
    await this.fullscreenTimePickerInput.waitFor({
      state: 'hidden',
      timeout: 5000,
    });
  }
}
