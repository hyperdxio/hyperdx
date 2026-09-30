import { Completion, CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';

import { createVariableCompletionSource } from '@/components/PromQLEditor/variableCompletionSource';

const TEST_COMPLETIONS: Completion[] = [
  { label: '$env', type: 'variable' },
  { label: '${env}', type: 'variable' },
  { label: '${env:regex}', type: 'variable' },
  { label: '${env:csv}', type: 'variable' },
];

/**
 * Runs the source and returns what CodeMirror acts on: the replacement range
 * and the filter pattern. CodeMirror filters options against — and on accept
 * replaces — the whole [from, to] span, so `pattern` is `doc.slice(from, to)`,
 * not just the text behind the cursor.
 */
function getResult(
  doc: string,
  pos: number,
): { from: number; to: number; pattern: string } | null {
  const source = createVariableCompletionSource(TEST_COMPLETIONS);
  const state = EditorState.create({ doc });
  const result = source(new CompletionContext(state, pos, false));
  if (result == null || typeof result !== 'object' || !('from' in result)) {
    return null;
  }
  const to = result.to ?? pos;
  return { from: result.from, to, pattern: doc.slice(result.from, to) };
}

describe('createVariableCompletionSource', () => {
  it.each([
    {
      name: 'cursor before the closing brace stops at it',
      doc: '${env}_total',
      pos: 5, // ${env|}_total
      expected: { from: 0, to: 6, pattern: '${env}' },
    },
    {
      name: 'half-typed braced name consumes the auto-closed brace',
      doc: '${en}',
      pos: 4, // ${en|}
      expected: { from: 0, to: 5, pattern: '${en}' },
    },
    {
      name: 'braced form consumes the format suffix and closing brace',
      doc: '${en:csv}',
      pos: 4, // ${en|:csv}
      expected: { from: 0, to: 9, pattern: '${en:csv}' },
    },
    {
      name: '$ typed before a label selector leaves the selector alone',
      doc: 'metric${a="1"}',
      pos: 7, // metric$|{a="1"}
      expected: { from: 6, to: 7, pattern: '$' },
    },
    {
      name: 'bare name inside a subquery stops before the step',
      doc: 'rate(x[$i:1m])',
      pos: 9, // rate(x[$i|:1m])
      expected: { from: 7, to: 9, pattern: '$i' },
    },
    {
      name: 'cursor mid-way through a bare name covers the whole name',
      doc: '$env',
      pos: 2, // $e|nv
      expected: { from: 0, to: 4, pattern: '$env' },
    },
    {
      name: 'bare reference followed by an adjacent reference stops at it',
      doc: '$env$other',
      pos: 4, // $env|$other
      expected: { from: 0, to: 4, pattern: '$env' },
    },
  ])('$name', ({ doc, pos, expected }) => {
    expect(getResult(doc, pos)).toEqual(expected);
  });

  it.each([
    { name: 'no $ under the cursor', doc: 'metric_name', pos: 11 },
    // `.` terminates a bare reference, so the token under the cursor
    // (`other`) contains no `$` and the source yields to the other sources.
    { name: 'after a dot following a reference', doc: '$svc.other', pos: 10 },
    { name: 'empty document', doc: '', pos: 0 },
  ])('returns null with $name', ({ doc, pos }) => {
    expect(getResult(doc, pos)).toBeNull();
  });
});
