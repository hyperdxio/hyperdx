import {
  autocompletion,
  Completion,
  CompletionSource,
} from '@codemirror/autocomplete';
import { type Extension } from '@codemirror/state';
import { EditorView } from '@uiw/react-codemirror';

import { KEYWORDS_FOR_WHERE_OR_ORDER_BY } from '@/components/SQLEditor/constants';
import { createCodeMirrorSqlDialect } from '@/components/SQLEditor/utils';

import type { QueryLanguage } from './queryModeSafety';

export const queryEditorBaseTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px' },
});

function luceneCompletions(fields: string[]): CompletionSource {
  const fieldOpts: Completion[] = fields.map(label => ({
    label,
    type: 'variable',
    apply: `${label}:`,
  }));
  const keywordOpts: Completion[] = ['AND', 'OR', 'NOT', 'TO'].map(label => ({
    label,
    type: 'keyword',
  }));
  const all = [...fieldOpts, ...keywordOpts];

  return context => {
    const word = context.matchBefore(/[\w.$-]*/);
    if (!word) return null;
    if (word.from === word.to && !context.explicit) return null;
    return { from: word.from, options: all, validFor: /^[\w.$-]*$/ };
  };
}

export function languageExtensions(
  language: QueryLanguage,
  fields: string[],
): Extension[] {
  if (language === 'sql') {
    return createCodeMirrorSqlDialect({
      identifiers: fields,
      keywords: KEYWORDS_FOR_WHERE_OR_ORDER_BY,
      includeRegularFunctions: true,
    });
  }
  // Plaintext with completions, no grammar. Explore never asks for Lucene —
  // it discards a carried Lucene WHERE rather than render one — so this is
  // only here for other callers of the editor.
  return [autocompletion({ override: [luceneCompletions(fields)] })];
}
