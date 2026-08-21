/**
 * Helpers for asserting Lucene autocomplete works in a `SearchWhereInput` /
 * `SearchInputV2`.
 *
 * Suggestions are worth asserting on end to end (rather than only in unit
 * tests) because they come from a real ClickHouse field-discovery query: the
 * regression these guard against was every non-search-page input passing a
 * table connection but no source id, which left the query with nothing to run
 * against and the dropdown permanently empty. That query sits behind a 300ms
 * debounce, so these wait well past the default assertion timeout.
 */
import { expect, Locator } from '@playwright/test';

const SUGGESTION_TIMEOUT = 15_000;

/**
 * Switch a WHERE input's query language via its language select.
 *
 * Takes the input's own `where-language-switch` rather than looking it up on
 * the page, because a page commonly renders several: the trace waterfall has
 * one per filter, and the dashboard's tile editor overlays the dashboard's own.
 */
export async function switchWhereLanguage(
  languageSwitch: Locator,
  language: 'SQL' | 'Lucene',
) {
  await languageSwitch.getByLabel('Query language').click();
  // The Select's dropdown is portalled out of the switch, so go via the page.
  await languageSwitch
    .page()
    .getByRole('option', { name: language, exact: true })
    .click();
}

/** Switch a WHERE input to Lucene. */
export async function switchWhereToLucene(languageSwitch: Locator) {
  await switchWhereLanguage(languageSwitch, 'Lucene');
}

/**
 * Type `prefix` into a Lucene input and assert the dropdown offers `field`.
 */
export async function expectFieldSuggestion(
  input: Locator,
  { prefix, field }: { prefix: string; field: string },
) {
  await input.click();
  await input.fill(prefix);

  await expect(suggestions(input, field).first()).toBeVisible({
    timeout: SUGGESTION_TIMEOUT,
  });
}

/**
 * Complete a field name with a colon and assert its values are suggested
 * (`Field:"value"`), which only happens once the value query has also run.
 */
export async function expectValueSuggestion(
  input: Locator,
  { field }: { field: string },
) {
  await input.click();
  await input.fill(`${field}:`);

  await expect(
    suggestions(input, new RegExp(`^${field}:"`)).first(),
  ).toBeVisible({ timeout: SUGGESTION_TIMEOUT });
}

/**
 * Clear a Lucene input and close its dropdown, so an open suggestion list can't
 * overlay whatever the test clicks next. Blurs rather than pressing Escape,
 * which inside a modal would close the modal itself — see
 * `dismissSqlAutocomplete` for the same trap in the SQL editor.
 */
export async function clearLuceneInput(input: Locator) {
  await input.fill('');
  await input.blur();
}

/**
 * Suggestions are looked up from the page rather than from the input's own
 * container: the dropdown is portalled to the document body, so it is never a
 * descendant of whatever modal or drawer the input sits in. Only the focused
 * input has an open dropdown, so there is nothing to disambiguate.
 */
function suggestions(input: Locator, text: string | RegExp) {
  return input
    .page()
    .getByTestId('autocomplete-suggestion')
    .filter({ hasText: text });
}
