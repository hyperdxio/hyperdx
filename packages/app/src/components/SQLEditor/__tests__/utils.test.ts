import { Completion, CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';

import { createIdentifierCompletionSource } from '../utils';

const TEST_COMPLETIONS: Completion[] = [
  { label: 'column1', type: 'variable' },
  { label: 'column2', type: 'variable' },
  { label: 'SELECT', type: 'keyword' },
  { label: 'count', type: 'function', apply: 'count(' },
];

/**
 * Simulates what CodeMirror shows the user: calls the completion source,
 * extracts the typed prefix (text from `result.from` to cursor), and
 * filters options by case-insensitive prefix match on the label.
 *
 * Returns the filtered labels, or null when the source suppresses completions.
 */
function getSuggestionLabels(
  doc: string,
  {
    pos,
    explicit = false,
    completions = TEST_COMPLETIONS,
  }: { pos?: number; explicit?: boolean; completions?: Completion[] } = {},
): string[] | null {
  const source = createIdentifierCompletionSource(completions);
  const state = EditorState.create({ doc });
  const cursorPos = pos ?? doc.length;
  const context = new CompletionContext(state, cursorPos, explicit);
  const result = source(context);

  if (result == null) return null;

  const typedPrefix = doc.slice(result.from, cursorPos).toLowerCase();
  return result.options
    .filter(o => o.label.toLowerCase().startsWith(typedPrefix))
    .map(o => o.label);
}

/**
 * Returns the range [from, to] that CodeMirror would replace when the user
 * accepts a suggestion. This lets us verify that the entire identifier
 * (including any trailing characters after the cursor) gets replaced.
 */
function getReplacementRange(
  doc: string,
  pos: number,
): { from: number; to: number } | null {
  const source = createIdentifierCompletionSource(TEST_COMPLETIONS);
  const state = EditorState.create({ doc });
  const context = new CompletionContext(state, pos, false);
  const result = source(context);
  if (result == null) return null;
  return { from: result.from, to: result.to ?? pos };
}

describe('Auto-Complete source', () => {
  it.each([
    { doc: 'SELECT col', expected: ['column1', 'column2'] },
    { doc: 'sel', expected: ['SELECT'] },
    { doc: 'SELECT xyz', expected: [] },
    { doc: 'SELECT count(*) AS total, col', expected: ['column1', 'column2'] },
  ])('suggests matching completions for "$doc"', ({ doc, expected }) => {
    expect(getSuggestionLabels(doc)).toEqual(expected);
  });

  it('returns all options when prefix is empty (Ctrl+Space)', () => {
    const labels = getSuggestionLabels('', { explicit: true });
    expect(labels).toEqual(['column1', 'column2', 'SELECT', 'count']);
  });

  it('returns null when there is no prefix and no Ctrl+Space', () => {
    expect(getSuggestionLabels('')).toBeNull();
  });

  it.each([
    {
      name: 'dots and brackets',
      doc: "ResourceAttributes['service.name']",
      completions: [
        { label: "ResourceAttributes['service.name']", type: 'variable' },
      ],
      expected: ["ResourceAttributes['service.name']"],
    },
    {
      name: '$ macros',
      doc: 'WHERE $__date',
      completions: [
        { label: '$__dateFilter', type: 'variable' },
        { label: 'column1', type: 'variable' },
      ],
      expected: ['$__dateFilter'],
    },
    {
      name: 'curly braces and colons',
      doc: 'WHERE {name:',
      completions: [
        { label: '{name:String}', type: 'variable' },
        { label: 'column1', type: 'variable' },
      ],
      expected: ['{name:String}'],
    },
  ])('supports identifiers with $name', ({ doc, completions, expected }) => {
    expect(getSuggestionLabels(doc, { completions })).toEqual(expected);
  });

  describe('AS keyword suppression', () => {
    it.each([
      { name: 'AS (uppercase)', doc: 'SELECT count(*) AS ali' },
      { name: 'as (lowercase)', doc: 'SELECT count(*) as ali' },
      { name: 'AS with extra whitespace', doc: 'SELECT count(*) AS   ali' },
    ])('returns null after $name', ({ doc }) => {
      expect(getSuggestionLabels(doc)).toBeNull();
    });

    it('does not suppress when AS is part of a larger word', () => {
      expect(getSuggestionLabels('SELECT CAST')).toEqual([]);
    });
  });

  describe('mid-identifier completion', () => {
    it.each([
      {
        name: "cursor before trailing ']",
        doc: "ResourceAttributes['host.']",
        pos: 25, // after 'host.'
        expectedRange: { from: 0, to: 27 },
      },
      {
        name: 'cursor in middle of a word',
        doc: 'SELECT column1',
        pos: 10, // after 'col'
        expectedRange: { from: 7, to: 14 },
      },
      {
        name: 'cursor at end of identifier (no trailing chars)',
        doc: 'SELECT column1',
        pos: 14,
        expectedRange: { from: 7, to: 14 },
      },
    ])(
      'replacement range covers full identifier when $name',
      ({ doc, pos, expectedRange }) => {
        expect(getReplacementRange(doc, pos)).toEqual(expectedRange);
      },
    );
  });
});
