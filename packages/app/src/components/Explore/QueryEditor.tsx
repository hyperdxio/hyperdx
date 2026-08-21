import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  acceptCompletion,
  autocompletion,
  Completion,
  CompletionSource,
  startCompletion,
} from '@codemirror/autocomplete';
import {
  HighlightStyle,
  StreamLanguage,
  type StreamParser,
  syntaxHighlighting,
} from '@codemirror/language';
import { type Extension } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';
import {
  Box,
  Flex,
  SegmentedControl,
  useMantineColorScheme,
} from '@mantine/core';
import CodeMirror, {
  EditorView,
  keymap,
  Prec,
  ReactCodeMirrorRef,
} from '@uiw/react-codemirror';

import { KEYWORDS_FOR_WHERE_OR_ORDER_BY } from '@/components/SQLEditor/constants';
import {
  createCodeMirrorSqlDialect,
  createCodeMirrorStyleTheme,
} from '@/components/SQLEditor/utils';

import styles from './QueryEditor.module.scss';

export type QueryLanguage = 'sql' | 'lucene';

/** Query authoring mode: builder edits WHERE only, sql is a full statement. */
export type QueryConfigMode = 'builder' | 'sql';

const DEFAULT_LANGUAGES: QueryLanguage[] = ['sql', 'lucene'];
const EMPTY_FIELDS: string[] = [];

export interface QueryEditorProps {
  /** Current query text (controlled). */
  value: string;
  onChange: (value: string) => void;
  /** Language (controlled). */
  language: QueryLanguage;
  onLanguageChange: (language: QueryLanguage) => void;
  /** Which languages appear in the toggle (also controls order). */
  languages?: QueryLanguage[];
  /**
   * Query authoring mode. When provided, a `Builder | SQL` toggle is shown at
   * the far left of the header. In `'sql'` mode the CodeMirror WHERE editor is
   * replaced by `children` (a raw-SQL editor) and the language toggle and
   * `leftSection` are hidden.
   */
  queryMode?: QueryConfigMode;
  onQueryModeChange?: (mode: QueryConfigMode) => void;
  /** Body override rendered instead of the WHERE editor when in SQL mode. */
  children?: React.ReactNode;
  /** Right-aligned header controls (date picker, Live, Run, ...). */
  rightSection?: React.ReactNode;
  /** Extra node next to the language tabs (e.g. a syntax-help button). */
  leftSection?: React.ReactNode;
  /** Active filter chips rendered inside the card, below the input. */
  filtersSlot?: React.ReactNode;
  /** Field names offered by autocomplete (both languages). */
  fields?: string[];
  placeholder?: string;
  /** Fired on Enter (Shift+Enter inserts a newline). */
  onSubmit?: () => void;
  /** Focus the editor on "/" or "s" when true. */
  enableHotkey?: boolean;
  /** Max body height (px) before the editor scrolls. Defaults to 200. */
  maxHeight?: number;
  'data-testid'?: string;
}

const baseTheme = EditorView.theme({
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
 * fallback, which leaves identifiers and operators uncolored and reads as "no
 * highlighting". These mid-tone hues are chosen to stay legible on both the
 * light and dark app backgrounds, so a single definition works in either
 * color scheme.
 */
const queryHighlightStyle = HighlightStyle.define([
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

/**
 * Minimal Lucene highlighter. `@codemirror/legacy-modes` has no Lucene mode, so
 * we tokenize the essentials here — quoted strings, `field:` names, boolean
 * keywords, numbers, and operators — using standard token names that the
 * default highlight style already colors.
 */
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

function languageExtensions(
  language: QueryLanguage,
  fields: string[],
): Extension[] {
  if (language === 'sql') {
    // Reuse the app's ClickHouse dialect + identifier/keyword/function
    // completion for consistency with the rest of the product.
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

/**
 * Presentational query editor: a bordered card with language tabs and header
 * controls on top of a CodeMirror body that renders SQL or Lucene with syntax
 * highlighting. The body auto-grows with its content (wrapping long lines) up
 * to `maxHeight` before scrolling. Fully controlled — value and language are
 * owned by the caller.
 */
export function QueryEditor({
  value,
  onChange,
  language,
  onLanguageChange,
  languages = DEFAULT_LANGUAGES,
  queryMode,
  onQueryModeChange,
  children,
  rightSection,
  leftSection,
  filtersSlot,
  fields = EMPTY_FIELDS,
  placeholder = 'Search your events…',
  onSubmit,
  enableHotkey,
  maxHeight = 200,
  'data-testid': dataTestId,
}: QueryEditorProps) {
  const { colorScheme } = useMantineColorScheme();
  const ref = useRef<ReactCodeMirrorRef>(null);

  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  useHotkeys(
    ['/', 's'],
    () => {
      if (enableHotkey) ref.current?.view?.focus();
    },
    {
      preventDefault: true,
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
    [enableHotkey],
  );

  const extensions = useMemo<Extension[]>(() => {
    const submitKeymap = Prec.highest(
      // The Enter handler reads `onSubmitRef.current`, but only when the key is
      // pressed (an event), never during render — the compiler can't tell the
      // CodeMirror `run` callback isn't a render-time ref read, so disable here.
      // eslint-disable-next-line react-hooks/refs
      keymap.of([
        {
          key: 'Enter',
          run: view => {
            if (!onSubmitRef.current) return false;
            onSubmitRef.current();
            // Keep the caret in the editor so the query can be tweaked while
            // results load, instead of losing focus on submit.
            queueMicrotask(() => view.focus());
            return true;
          },
        },
        // Shift+Enter inserts a newline (the editor auto-grows to fit).
        { key: 'Shift-Enter', run: () => false },
      ]),
    );
    return [
      baseTheme,
      createCodeMirrorStyleTheme(),
      syntaxHighlighting(queryHighlightStyle),
      submitKeymap,
      keymap.of([{ key: 'Tab', run: acceptCompletion }]),
      ...languageExtensions(language, fields),
      EditorView.lineWrapping,
    ];
  }, [language, fields]);

  // Surface field/variable suggestions as soon as the editor is focused, so
  // people can discover available fields without knowing exact names.
  // react-codemirror fires onFocus from an updateListener, so dispatching
  // startCompletion synchronously throws "Calls to EditorView.update are not
  // allowed while an update is in progress" (also hit when Enter re-focuses
  // the editor). Wait until this update finishes.
  const handleFocus = useCallback(() => {
    queueMicrotask(() => {
      const view = ref.current?.view;
      if (view) startCompletion(view);
    });
  }, []);

  const isSqlMode = queryMode === 'sql';
  const showToggle = languages.length > 1 && !isSqlMode;

  // Combined authoring control: builder WHERE languages plus an "Advanced"
  // option that maps to raw-SQL mode, so the value spans both `queryMode` and
  // `language` and "SQL" isn't repeated across two adjacent controls.
  const modeValue = isSqlMode ? 'advanced' : language;
  const handleModeChange = (v: string) => {
    if (v === 'advanced') {
      onQueryModeChange?.('sql');
      return;
    }
    if (isSqlMode) onQueryModeChange?.('builder');
    onLanguageChange(v as QueryLanguage);
  };

  return (
    <Box className={styles.card} data-testid="explore-query-editor">
      <Flex align="center" gap="sm" className={styles.header}>
        <Flex align="center" gap="xs" wrap="nowrap">
          {onQueryModeChange != null ? (
            <SegmentedControl
              size="xs"
              value={modeValue}
              onChange={handleModeChange}
              data={[
                ...languages.map(l => ({
                  value: l,
                  label: l === 'sql' ? 'SQL' : 'Lucene',
                })),
                { value: 'advanced', label: 'Advanced' },
              ]}
              aria-label="Query mode"
              data-testid="query-mode-toggle"
            />
          ) : (
            showToggle && (
              <SegmentedControl
                size="xs"
                value={language}
                onChange={v => onLanguageChange(v as QueryLanguage)}
                data={languages.map(l => ({
                  value: l,
                  label: l === 'sql' ? 'SQL' : 'Lucene',
                }))}
                aria-label="Query language"
              />
            )
          )}
          {!isSqlMode && leftSection}
        </Flex>
        <Flex
          align="center"
          gap="sm"
          ml="auto"
          wrap="nowrap"
          className={styles.controls}
        >
          {rightSection}
        </Flex>
      </Flex>
      {isSqlMode ? (
        <Box data-testid={dataTestId}>{children}</Box>
      ) : (
        <Box className={styles.body} data-testid={dataTestId}>
          <CodeMirror
            ref={ref}
            value={value}
            onChange={onChange}
            onFocus={handleFocus}
            placeholder={placeholder}
            theme={colorScheme === 'dark' ? 'dark' : 'light'}
            extensions={extensions}
            height="auto"
            minHeight="24px"
            maxHeight={`${maxHeight}px`}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              autocompletion: false,
              bracketMatching: true,
              closeBrackets: true,
              searchKeymap: false,
            }}
          />
        </Box>
      )}
      {filtersSlot != null && (
        <Box className={styles.filters}>{filtersSlot}</Box>
      )}
    </Box>
  );
}
