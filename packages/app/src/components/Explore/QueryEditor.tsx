import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { acceptCompletion, startCompletion } from '@codemirror/autocomplete';
import { syntaxHighlighting } from '@codemirror/language';
import { type Extension } from '@codemirror/state';
import {
  Box,
  Flex,
  SegmentedControl,
  Text,
  useMantineColorScheme,
} from '@mantine/core';
import CodeMirror, {
  EditorView,
  keymap,
  Prec,
  ReactCodeMirrorRef,
} from '@uiw/react-codemirror';

import { createCodeMirrorStyleTheme } from '@/components/SQLEditor/utils';

import {
  languageExtensions,
  queryEditorBaseTheme,
  queryHighlightStyle,
} from './queryEditorLanguage';
import { type QueryEditorMode, type QueryLanguage } from './queryModeSafety';

import styles from './QueryEditor.module.scss';

export type { QueryLanguage };
export type QueryConfigMode = 'builder' | 'sql';

const DEFAULT_LANGUAGES: QueryLanguage[] = ['lucene', 'sql'];
const EMPTY_FIELDS: string[] = [];

const MODE_LABELS: Record<QueryEditorMode, string> = {
  lucene: 'Search',
  sql: 'SQL',
  raw: 'Raw SQL',
};

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
  /**
   * Combined Search / SQL / Raw SQL control. When provided, the segmented
   * control calls this instead of flipping language/queryMode itself so the
   * parent can snapshot and confirm unsafe switches.
   */
  onModeChange?: (mode: QueryEditorMode) => void;
  /** Body override rendered instead of the WHERE editor when in SQL mode. */
  children?: React.ReactNode;
  /** Right-aligned header controls (date picker, Live, Run, ...). */
  rightSection?: React.ReactNode;
  /** Extra node next to the language tabs (e.g. a syntax-help button). */
  leftSection?: React.ReactNode;
  /** Toolbar under the input (add filter, examples, SQL preview). */
  toolbarSlot?: React.ReactNode;
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
  onModeChange,
  children,
  rightSection,
  leftSection,
  toolbarSlot,
  filtersSlot,
  fields = EMPTY_FIELDS,
  placeholder = 'Filter this source',
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
      queryEditorBaseTheme,
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

  // Combined authoring control: Search (Lucene) + SQL WHERE + Raw SQL, so the
  // value spans both `queryMode` and `language`.
  const modeValue: QueryEditorMode = isSqlMode ? 'raw' : language;
  const handleModeChange = (v: string) => {
    if (v !== 'lucene' && v !== 'sql' && v !== 'raw') {
      return;
    }
    const next: QueryEditorMode = v;
    if (onModeChange) {
      onModeChange(next);
      return;
    }
    if (next === 'raw') {
      onQueryModeChange?.('sql');
      return;
    }
    if (isSqlMode) onQueryModeChange?.('builder');
    onLanguageChange(next);
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
                  label: MODE_LABELS[l],
                })),
                { value: 'raw', label: MODE_LABELS.raw },
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
                  label: MODE_LABELS[l],
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
          <Text className={styles.badge} size="xs" c="dimmed">
            {MODE_LABELS[language]}
          </Text>
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
      {toolbarSlot != null && (
        <Box className={styles.toolbar}>{toolbarSlot}</Box>
      )}
      {filtersSlot != null && (
        <Box className={styles.filters}>{filtersSlot}</Box>
      )}
    </Box>
  );
}
