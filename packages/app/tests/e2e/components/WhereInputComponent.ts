/**
 * WhereInputComponent - the WHERE control rendered by `SearchWhereInput`:
 * a language switch sitting flush against a SQL or Lucene input.
 *
 * Shared by every page that renders one (search, dashboards, sessions), so the
 * traversal to the input — which carries no visible label and, in SQL, no test
 * id — lives here rather than in each page object or spec.
 */
import { expect, Locator, Page } from '@playwright/test';

import { borderedBox, replaceEditorText } from '../utils/locators';
import { switchWhereLanguage } from '../utils/lucene-autocomplete';
import type { MultilineField } from '../utils/multiline-input';

export type QueryLanguage = 'SQL' | 'Lucene';

/** One half of the seam, as the user sees it. */
type SeamHalf = {
  height: number;
  borderColor: string;
};

export type WhereSeam = {
  languageSwitch: SeamHalf;
  input: SeamHalf;
};

/**
 * Sub-pixel rounding makes exact height equality one layout change away from
 * flaking; the overhang this guards against was 2px.
 */
const SEAM_TOLERANCE_PX = 1;

export class WhereInputComponent {
  readonly page: Page;

  /**
   * The control as a whole, located from its language switch — the one part
   * present in both languages.
   */
  readonly row: Locator;

  /**
   * `pick` chooses among several WHERE inputs under the same `root` (a chart
   * editor renders one per series, then the chart-level input).
   */
  constructor(
    page: Page,
    root: Page | Locator = page,
    pick: 'first' | 'last' = 'first',
  ) {
    this.page = page;
    const languageSwitch = root.getByTestId('where-language-switch');
    this.row = (
      pick === 'last' ? languageSwitch.last() : languageSwitch.first()
    ).locator('xpath=..');
  }

  get languageSwitch(): Locator {
    return this.row.getByTestId('where-language-switch');
  }

  /** The CodeMirror editor rendered in SQL mode. */
  get sqlEditor(): Locator {
    return this.row.locator('.cm-editor').first();
  }

  /** The autosizing textarea rendered in Lucene mode. */
  get luceneInput(): Locator {
    return this.row.locator('textarea').first();
  }

  async selectLanguage(language: QueryLanguage): Promise<void> {
    await switchWhereLanguage(this.languageSwitch, language);
    // Wait for the dropdown to close so it can't cover the input.
    await this.page
      .getByRole('option', { name: language, exact: true })
      .waitFor({ state: 'hidden', timeout: 5000 });
  }

  /** Replace the SQL editor's contents. The input must already be in SQL mode. */
  async fillSql(expression: string): Promise<void> {
    await replaceEditorText(
      this.page,
      this.sqlEditor.locator('.cm-content').first(),
      expression,
    );
  }

  /**
   * Type into the Lucene textarea, leaving the suggestion dropdown open.
   * The input must already be in Lucene mode.
   */
  async typeLucene(text: string): Promise<void> {
    await this.luceneInput.click();
    await this.luceneInput.fill(text);
  }

  /** The warning icon this WHERE input shows about the variables it references. */
  get variableWarning(): Locator {
    return this.row.getByTestId('variable-validation');
  }

  /** The input for `language`, as the growth assertions need it. */
  field(language: QueryLanguage): MultilineField {
    if (language === 'Lucene') {
      const input = this.luceneInput;
      return { focusTarget: input, growthBox: input, visibleBox: input };
    }
    // `.cm-editor` can stay fixed while `.cm-content` tracks the line count,
    // and the Paper around the editor is the box that would clip it.
    const content = this.sqlEditor.locator('.cm-content').first();
    return {
      focusTarget: content,
      growthBox: content,
      visibleBox: borderedBox(this.sqlEditor),
    };
  }

  /** Move focus into the input, whichever language it is rendering. */
  async focus(): Promise<void> {
    const sqlContent = this.sqlEditor.locator('.cm-content').first();
    if ((await sqlContent.count()) > 0) {
      await sqlContent.focus();
      return;
    }
    await this.luceneInput.focus();
  }

  /**
   * Heights and border colors of the two halves of the control. They sit flush
   * against each other, so a height mismatch leaves the switch overhanging the
   * input, and a focus color on only one reads as half-focused.
   */
  async readSeam(): Promise<WhereSeam> {
    return this.row.evaluate(el => {
      const addon = el.querySelector('[data-testid="where-language-switch"]');
      // The box the user sees a border around: the SQL editor's Paper, or the
      // Lucene textarea's wrapper.
      const input = Array.from(el.querySelectorAll('*')).find(
        node =>
          addon?.contains(node) === false &&
          parseFloat(getComputedStyle(node).borderTopWidth) > 0,
      );
      const read = (node?: Element | null) => ({
        height: node?.getBoundingClientRect().height ?? 0,
        borderColor: node ? getComputedStyle(node).borderTopColor : '',
      });
      return { languageSwitch: read(addon), input: read(input) };
    });
  }

  /**
   * The switch and the input are sized independently — the switch from its own
   * SCSS, the input from whichever editor the language selects — so an editor
   * that reserves a taller row than its bordered box leaves the switch
   * overhanging it.
   */
  async expectSeamFlush(): Promise<void> {
    await expect
      .poll(async () => {
        const seam = await this.readSeam();
        if (seam.languageSwitch.height <= 0 || seam.input.height <= 0) {
          return Number.POSITIVE_INFINITY;
        }
        return Math.abs(seam.languageSwitch.height - seam.input.height);
      })
      .toBeLessThanOrEqual(SEAM_TOLERANCE_PX);
  }

  async borderColors(): Promise<{ languageSwitch: string; input: string }> {
    const seam = await this.readSeam();
    return {
      languageSwitch: seam.languageSwitch.borderColor,
      input: seam.input.borderColor,
    };
  }
}
