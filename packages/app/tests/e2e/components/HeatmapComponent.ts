/**
 * HeatmapComponent - a heatmap rendered by DBHeatmapChart, on the search
 * page's event deltas view or in a dashboard tile.
 */
import { expect, Locator, Page } from '@playwright/test';

export class HeatmapComponent {
  readonly page: Page;
  private readonly root: Page | Locator;

  /**
   * @param root - Scope that contains the chart. The "not enough data" message
   * replaces the plot container, so this must be wider than the plot itself.
   */
  constructor(page: Page, root: Page | Locator = page) {
    this.page = page;
    this.root = root;
  }

  get container() {
    return this.root.locator('.heatmap-selection-container');
  }

  get canvas() {
    return this.container.locator('canvas');
  }

  get notEnoughDataText() {
    return this.root.getByText('Not enough data points to render heatmap');
  }

  /**
   * The hover tooltip, which only appears for a cell with a non-zero count.
   * Series-axis heatmaps label the cell's series instead of its count.
   */
  get tooltip() {
    return this.container.getByText(/^(Count Value|Series):$/);
  }

  /**
   * Sweep the cursor over the plot until the tooltip appears, proving at least
   * one populated cell was drawn. A zero-filled grid still mounts a canvas, so
   * checking the canvas alone does not.
   */
  async hoverPopulatedCell() {
    // A refresh keeps the previous grid on screen while it pulses; wait for
    // the fresh data so the hover tests what the current query drew.
    await expect(this.container).not.toHaveClass(/effect-pulse/, {
      timeout: 20000,
    });
    const plot = this.container.locator('.u-over');
    await expect(plot).toBeVisible();
    const box = await plot.boundingBox();
    if (!box) {
      throw new Error('Heatmap plot area not found');
    }
    // The tooltip fires within 20px of a cell center; a 25px grid keeps every
    // point of the plot within ~18px of a sample.
    const step = 25;
    for (let y = step / 2; y < box.height; y += step) {
      for (let x = step / 2; x < box.width; x += step) {
        await this.page.mouse.move(box.x + x, box.y + y);
        if (await this.tooltip.isVisible()) {
          return;
        }
      }
    }
    await expect(this.tooltip).toBeVisible();
  }

  /** The series named by the open cell tooltip of a series-axis heatmap. */
  async hoveredSeriesName() {
    const row = this.container
      .getByText('Series:', { exact: true })
      .locator('..');
    await expect(row).toBeVisible();
    return ((await row.textContent()) ?? '').replace(/^Series:\s*/, '').trim();
  }

  /**
   * Hover the top series-axis label, which the canvas draws, so its DOM
   * tooltip opens. Returns that tooltip.
   */
  async hoverSeriesAxisLabel() {
    const box = await this.container.locator('.u-over').boundingBox();
    if (!box) {
      throw new Error('Heatmap plot area not found');
    }
    await this.page.mouse.move(box.x - 10, box.y + 2);
    await expect(
      this.container.getByTestId('heatmap-series-axis-tooltip-target'),
    ).toBeAttached();
    return this.page.locator('.mantine-Tooltip-tooltip');
  }

  /**
   * Drag a rectangle over the inner area of the heatmap plot. Targets uPlot's
   * `.u-over` overlay, which receives the drag events and excludes the axes.
   */
  async dragSelect(
    start: { x: number; y: number } = { x: 0.3, y: 0.2 },
    end: { x: number; y: number } = { x: 0.7, y: 0.8 },
  ) {
    const plot = this.container.locator('.u-over');
    await expect(plot).toBeVisible();
    const box = await plot.boundingBox();
    if (!box) {
      throw new Error('Heatmap plot area not found');
    }
    await this.page.mouse.move(
      box.x + box.width * start.x,
      box.y + box.height * start.y,
    );
    await this.page.mouse.down();
    await this.page.mouse.move(
      box.x + box.width * end.x,
      box.y + box.height * end.y,
      { steps: 10 },
    );
    await this.page.mouse.up();
  }
}
