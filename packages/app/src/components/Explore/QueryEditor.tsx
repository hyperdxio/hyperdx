import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { acceptCompletion, startCompletion } from '@codemirror/autocomplete';
import { type Extension } from '@codemirror/state';
import { Box, Flex, useMantineColorScheme } from '@mantine/core';
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
} from './queryEditorLanguage';
import { type QueryLanguage } from './queryModeSafety';

import styles from './QueryEditor.module.scss';

export type { QueryLanguage };
export type QueryConfigMode = 'builder' | 'sql';

const EMPTY_FIELDS: string[] = [];

export interface QueryEditorProps {
  /** Current query text (controlled). */
  value: string;
  onChange: (value: string) => void;
  /** Language (controlled) — drives syntax highlighting and autocomplete. */
  language: QueryLanguage;
  /** Left addon naming the expression language, flush inside the field. */
  addonSlot?: React.ReactNode;
  /**
   * Discloses the full-statement editor. Sits outside the field, because the
   * statement is the larger thing: the field is one clause inside it, spliced
   * in wherever `$__filters` appears. Nesting this control in the field would
   * have that backwards.
   */
  sqlToggle?: React.ReactNode;
  /**
   * SQL editor revealed under the search input. The search input stays visible
   * either way — SQL is an addition to the query, never a replacement for it.
   */
  sqlPanel?: React.ReactNode;
  /** Time picker, Live and Run, on the same row as the field. */
  rightSection?: React.ReactNode;
  /** Active filter chips rendered inside the bordered input, before the editor. */
  filtersSlot?: React.ReactNode;
  /** Trailing control inside the input, after the editor (e.g. "Add filter"). */
  addFilterSlot?: React.ReactNode;
  /**
   * Backspace at caret 0 with an empty selection removes the last filter
   * token. Return true when a token was removed so the editor does not also
   * delete text.
   */
  onRemoveLastFilter?: () => boolean;
  /** Field names offered by autocomplete (both languages). */
  fields?: string[];
  placeholder?: string;
  /** Fired on Enter (Shift+Enter inserts a newline). */
  onSubmit?: () => void;
  /** Fired when the CodeMirror editor loses focus. */
  onBlur?: () => void;
  /** Focus the editor on "/" or "s" when true. */
  enableHotkey?: boolean;
  /** Max body height (px) before the editor scrolls. Defaults to 200. */
  maxHeight?: number;
  'data-testid'?: string;
}

/**
 * Presentational query editor: one row holding a CodeMirror search field and
 * the time/run controls, with an optional full-statement editor disclosed
 * beneath. The field auto-grows with its content (wrapping long lines) up to
 * `maxHeight` before scrolling. Fully controlled — the caller owns the value.
 */
export function QueryEditor({
  value,
  onChange,
  language,
  addonSlot,
  sqlToggle,
  sqlPanel,
  rightSection,
  filtersSlot,
  addFilterSlot,
  onRemoveLastFilter,
  fields = EMPTY_FIELDS,
  placeholder = 'Filter this source',
  onSubmit,
  onBlur,
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

  const onRemoveLastFilterRef = useRef(onRemoveLastFilter);
  useEffect(() => {
    onRemoveLastFilterRef.current = onRemoveLastFilter;
  }, [onRemoveLastFilter]);

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
      // The Enter/Backspace handlers read refs, but only when the key is
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
        {
          key: 'Backspace',
          run: view => {
            const remove = onRemoveLastFilterRef.current;
            if (!remove) return false;
            const sel = view.state.selection.main;
            if (sel.from !== sel.to || sel.from !== 0) return false;
            return remove();
          },
        },
      ]),
    );
    return [
      queryEditorBaseTheme,
      createCodeMirrorStyleTheme(),
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

  return (
    <Box className={styles.card} data-testid="explore-query-editor">
      <Flex align="center" gap="sm" wrap="nowrap" className={styles.row}>
        <Box className={styles.field} data-testid={dataTestId}>
          {addonSlot}
          <Box className={styles.body}>
            {filtersSlot != null && (
              <Box className={styles.filters}>{filtersSlot}</Box>
            )}
            <Box className={styles.editor}>
              <CodeMirror
                ref={ref}
                value={value}
                onChange={onChange}
                onFocus={handleFocus}
                onBlur={onBlur}
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
                  // See queryEditorLanguage.ts — Lucene StreamLanguage
                  // highlighting throws `tags is not iterable`.
                  syntaxHighlighting: false,
                }}
              />
            </Box>
            <Box className={styles.actions}>{addFilterSlot}</Box>
          </Box>
        </Box>
        {sqlToggle}
        <Flex align="center" gap="sm" wrap="nowrap" className={styles.controls}>
          {rightSection}
        </Flex>
      </Flex>
      {sqlPanel}
    </Box>
  );
}
