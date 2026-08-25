import {
  autocompletion,
  Completion,
  CompletionSource,
} from '@codemirror/autocomplete';
import {
  HighlightStyle,
  StreamLanguage,
  type StreamParser,
} from '@codemirror/language';
import { type Extension } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';
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
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px' },
});

/**
 * Explicit, high-priority highlight style shared by SQL and Lucene. The @uiw
 * `basicSetup` only registers CodeMirror's `defaultHighlightStyle` as a
 * fallback, which leaves identifiers and operators uncolored.
 */
export const queryHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: '#8b5cf6' },
  { tag: [t.string, t.special(t.string)], color: '#37b24d' },
  { tag: [t.number, t.bool, t.null], color: '#e8590c' },
  { tag: [t.typeName], color: '#0ca678' },
  {
    tag: [t.standard(t.name), t.function(t.variableName)],
    color: '#4dabf7',
  },
  { tag: [t.propertyName], color: '#4dabf7' },
  { tag: [t.operator, t.punctuation], color: '#adb5bd' },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: '#868e96',
    fontStyle: 'italic',
  },
]);

const luceneStreamParser: StreamParser<unknown> = {
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^[-+]?[\w.$*?]+(?=\s*:)/)) return 'propertyName';
    if (stream.match(/^(?:AND|OR|NOT|TO)\b/)) return 'keyword';
    if (stream.match(/^\d+(?:\.\d+)?\b/)) return 'number';
    if (stream.match(/^[:+\-!^~*?(){}[\]]/)) return 'operator';
    if (stream.match(/^[^\s:()]+/)) return null;
    stream.next();
    return null;
  },
};

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
  return [
    StreamLanguage.define(luceneStreamParser),
    autocompletion({ override: [luceneCompletions(fields)] }),
  ];
}
