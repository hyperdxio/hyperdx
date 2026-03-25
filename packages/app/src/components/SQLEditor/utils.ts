import {
  autocompletion,
  Completion,
  CompletionContext,
} from '@codemirror/autocomplete';
import { sql } from '@codemirror/lang-sql';
import { EditorView } from '@uiw/react-codemirror';

import {
  AGGREGATE_FUNCTIONS,
  ALL_KEYWORDS,
  REGULAR_FUNCTIONS,
} from './constants';

export type SQLCompletion = {
  label: string;
  apply?: string;
  detail?: string;
  type?: string;
};

// Characters that form SQL identifiers in our editor: word chars, dots,
// single quotes, brackets, $, {, }, and : — to support expressions like
// `ResourceAttributes['service.name']`, `$__dateFilter`, `{name:Type}`.
const IDENTIFIER_CHAR = "[\\w.'[\\]${}:]";
const IDENTIFIER_BEFORE = new RegExp(`${IDENTIFIER_CHAR}+`);
const IDENTIFIER_AFTER = new RegExp(`^${IDENTIFIER_CHAR}+`);
const IDENTIFIER_VALID_FOR = new RegExp(`^${IDENTIFIER_CHAR}*$`);

/**
 * Creates a custom CodeMirror completion source for SQL identifiers (column names, table
 * names, functions, etc.) that inserts them verbatim, without quoting.
 */
export function createIdentifierCompletionSource(completions: Completion[]) {
  return (context: CompletionContext) => {
    const prefix = context.matchBefore(IDENTIFIER_BEFORE);
    if (!prefix && !context.explicit) return null;

    // Suppress suggestions after AS keyword since the user is typing a custom alias
    const textBefore = context.state.doc
      .sliceString(0, prefix?.from ?? context.pos)
      .trimEnd();
    if (/\bAS$/i.test(textBefore)) return null;

    // Look forward from cursor to include trailing identifier characters
    // (e.g. the `']` in `ResourceAttributes['host.']`) so accepting a
    // suggestion replaces the entire identifier, not just up to the cursor.
    const docText = context.state.doc.sliceString(context.pos);
    const suffix = docText.match(IDENTIFIER_AFTER);
    const to = suffix ? context.pos + suffix[0].length : context.pos;

    return {
      from: prefix?.from ?? context.pos,
      to,
      options: completions,
      validFor: IDENTIFIER_VALID_FOR,
    };
  };
}

export const createCodeMirrorSqlDialect = ({
  identifiers,
  keywords = ALL_KEYWORDS,
  additionalCompletions = [],
  includeRegularFunctions = false,
  includeAggregateFunctions = false,
}: {
  identifiers: string[];
  keywords?: string[];
  additionalCompletions?: SQLCompletion[];
  includeRegularFunctions?: boolean;
  includeAggregateFunctions?: boolean;
}) => {
  const completions: Completion[] = [
    ...identifiers.map(id => ({ label: id, type: 'variable' as const })),
    ...keywords.map(kw => ({
      label: kw,
      type: 'keyword' as const,
    })),
    ...(includeRegularFunctions
      ? REGULAR_FUNCTIONS.map(fn => ({
          label: fn,
          type: 'function' as const,
          apply: `${fn}(`,
        }))
      : []),
    ...(includeAggregateFunctions
      ? AGGREGATE_FUNCTIONS.map(fn => ({
          label: fn,
          type: 'function' as const,
          apply: `${fn}(`,
        }))
      : []),
    ...additionalCompletions,
  ];

  return [
    // SQL language for syntax highlighting (completions are overridden below)
    sql({ upperCaseKeywords: true }),
    // Override built-in SQL completions with our custom source
    autocompletion({
      override: [createIdentifierCompletionSource(completions)],
    }),
  ];
};

export const DEFAULT_CODE_MIRROR_BASIC_SETUP = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
};

export const createCodeMirrorStyleTheme = (maxEditorHeight?: string) =>
  EditorView.baseTheme({
    '&.cm-editor.cm-focused': {
      outline: '0px solid transparent',
    },
    '&.cm-editor': {
      background: 'transparent !important',
    },
    '& .cm-tooltip-autocomplete': {
      whiteSpace: 'nowrap',
      wordWrap: 'break-word',
      maxWidth: '100%',
      backgroundColor: 'var(--color-bg-surface) !important',
      border: '1px solid var(--color-border) !important',
      borderRadius: '8px',
      boxShadow:
        '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      padding: '4px',
    },
    '& .cm-tooltip-autocomplete > ul': {
      fontFamily: 'inherit',
      maxHeight: '300px',
    },
    '& .cm-tooltip-autocomplete > ul > li': {
      padding: '4px 8px',
      borderRadius: '4px',
      cursor: 'pointer',
      color: 'var(--color-text)',
    },
    '& .cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--color-bg-highlighted) !important',
      color: 'var(--color-text-muted) !important',
    },
    '& .cm-tooltip-autocomplete .cm-completionLabel': {
      color: 'var(--color-text)',
    },
    '& .cm-tooltip-autocomplete .cm-completionDetail': {
      color: 'var(--color-text-muted)',
      fontStyle: 'normal',
      marginLeft: '8px',
    },
    '& .cm-tooltip-autocomplete .cm-completionInfo': {
      backgroundColor: 'var(--color-bg-field)',
      border: '1px solid var(--color-border)',
      borderRadius: '4px',
      padding: '8px',
      color: 'var(--color-text)',
    },
    '& .cm-completionIcon': {
      width: '16px',
      marginRight: '6px',
      opacity: 0.7,
    },
    '& .cm-scroller': {
      overflowX: 'hidden',
    },
    ...(maxEditorHeight
      ? {
          '.cm-editor-multiline &.cm-editor': {
            maxHeight: maxEditorHeight,
          },
          '.cm-editor-multiline & .cm-scroller': {
            maxHeight: maxEditorHeight,
            overflowY: 'auto',
          },
        }
      : {}),
  });
