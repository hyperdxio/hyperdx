/**
 * Helpers for asserting a query input grows to fit a second line and keeps that
 * height after focus leaves it.
 *
 * The regression these guard against is a field that only reserves room for
 * extra lines while focused, so blurring it clips or overlays everything the
 * user typed past the first line.
 */
import { expect, Locator, Page } from '@playwright/test';

import { blurActiveElement } from './locators';

/** The three elements a growth assertion needs from one input. */
export type MultilineField = {
  /**
   * What the user focuses and types into: a `textarea`, or CodeMirror's
   * contenteditable `.cm-content` — never the `.cm-editor` wrapper, which never
   * holds focus.
   */
  focusTarget: Locator;
  /** The element whose height tracks the content. */
  growthBox: Locator;
  /** The bordered box the user sees, which must not clip the content. */
  visibleBox: Locator;
};

/** Consecutive equal reads before a height counts as settled. */
const SETTLED_READS = 3;
const SETTLE_INTERVAL_MS = 100;
const SETTLE_TIMEOUT_MS = 5_000;

const boxHeight = async (box: Locator): Promise<number> =>
  (await box.boundingBox())?.height ?? 0;

/**
 * The height of a box once it stops changing.
 *
 * A single `boundingBox()` read taken right after typing or blurring can land
 * before the re-render that follows it — `react-textarea-autosize` recomputes
 * its rows in an effect, CodeMirror re-measures on its own schedule — so a
 * collapse would arrive after the read and the assertion would pass on a stale
 * value. Polling for a stable window instead of sleeping keeps that
 * deterministic.
 */
export const settledHeight = async (box: Locator): Promise<number> => {
  let height = 0;
  let previous = -1;
  let stableReads = 0;

  await expect
    .poll(
      async () => {
        height = await boxHeight(box);
        stableReads = height === previous ? stableReads + 1 : 0;
        previous = height;
        return stableReads;
      },
      { intervals: [SETTLE_INTERVAL_MS], timeout: SETTLE_TIMEOUT_MS },
    )
    .toBeGreaterThanOrEqual(SETTLED_READS);

  return height;
};

/** Assert the field now holds two lines, whichever editor renders it. */
const expectTwoLines = async (focusTarget: Locator): Promise<void> => {
  const lines = focusTarget.locator('.cm-line');
  if ((await lines.count()) > 0) {
    await expect(lines).toHaveCount(2, { timeout: 2000 });
    return;
  }
  await expect(focusTarget).toHaveValue(/first line[\r\n]+second line/, {
    timeout: 2000,
  });
};

/**
 * Type two lines into a field, assert it grows to fit them, and assert it still
 * fits them once focus moves away.
 *
 * @param onSingleLine runs while the field holds one short line — its minimum
 * height, and the only state where a row reserving more space than its bordered
 * box shows up. An empty field is no good for that check: the placeholder wraps
 * at narrow widths and the content then drives the height.
 */
export const expectExpandsAndStaysExpanded = async (
  page: Page,
  { focusTarget, growthBox, visibleBox }: MultilineField,
  { onSingleLine }: { onSingleLine?: () => Promise<void> } = {},
): Promise<void> => {
  await focusTarget.scrollIntoViewIfNeeded();
  await focusTarget.focus();
  await page.keyboard.type('first line');

  await onSingleLine?.();

  const singleLineHeight = await settledHeight(growthBox);
  const singleLineVisibleHeight = await settledHeight(visibleBox);

  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('second line');
  await expectTwoLines(focusTarget);

  expect(await settledHeight(growthBox)).toBeGreaterThanOrEqual(
    singleLineHeight,
  );

  // The visible box has to actually grow, not clip the second line.
  await expect
    .poll(() => boxHeight(visibleBox), { timeout: SETTLE_TIMEOUT_MS })
    .toBeGreaterThan(singleLineVisibleHeight);
  const expandedVisibleHeight = await settledHeight(visibleBox);

  await blurActiveElement(page);
  await expect(focusTarget).not.toBeFocused();

  expect(await settledHeight(visibleBox)).toBeGreaterThanOrEqual(
    expandedVisibleHeight,
  );
};

/**
 * A value long enough that a wrapping editor would grow past one row at the
 * compact (`xs`) size used by the waterfall filters.
 */
export const WRAPPING_SINGLE_LINE_QUERY =
  'StatusCode:"Error" AND ServiceName:"checkout-service" AND SpanName:"GET /api/v1/checkout"';

/**
 * Type a long value with no newline and assert the field stays one row while
 * focused and after blur. Guards `allowMultiline={false}` against growing on
 * focus and clipping on blur.
 */
export const expectStaysOneRow = async (
  page: Page,
  { focusTarget, growthBox, visibleBox }: MultilineField,
): Promise<void> => {
  await focusTarget.scrollIntoViewIfNeeded();
  await focusTarget.focus();
  await page.keyboard.type('short');
  const oneRowHeight = await settledHeight(visibleBox);
  const oneRowContentHeight = await settledHeight(growthBox);

  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(WRAPPING_SINGLE_LINE_QUERY);

  // The bordered box alone can't carry this: a single-line SQL field clamps it
  // to one row with `overflow: hidden`, so it would hold even if the content
  // wrapped and the second line were clipped out of sight. Measuring the
  // content too is what pins the value to one row.
  await expectOneLine(focusTarget, growthBox, oneRowContentHeight);
  expect(await settledHeight(visibleBox)).toBeLessThanOrEqual(oneRowHeight + 1);

  await blurActiveElement(page);
  await expect(focusTarget).not.toBeFocused();

  await expectOneLine(focusTarget, growthBox, oneRowContentHeight);
  expect(await settledHeight(visibleBox)).toBeLessThanOrEqual(oneRowHeight + 1);
};

/** Assert the content itself still occupies one row, whichever editor renders it. */
const expectOneLine = async (
  focusTarget: Locator,
  growthBox: Locator,
  oneRowContentHeight: number,
): Promise<void> => {
  const lines = focusTarget.locator('.cm-line');
  if ((await lines.count()) > 0) {
    await expect(lines).toHaveCount(1, { timeout: 2000 });
    return;
  }
  expect(await settledHeight(growthBox)).toBeLessThanOrEqual(
    oneRowContentHeight + 1,
  );
};
