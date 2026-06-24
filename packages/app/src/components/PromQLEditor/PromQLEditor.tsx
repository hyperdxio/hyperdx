import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import {
  acceptCompletion,
  autocompletion,
  Completion,
  startCompletion,
} from '@codemirror/autocomplete';
import { Paper, useMantineColorScheme } from '@mantine/core';
import { PromQLExtension } from '@prometheus-io/codemirror-promql';
import CodeMirror, {
  Compartment,
  EditorView,
  keymap,
  Prec,
  ReactCodeMirrorRef,
} from '@uiw/react-codemirror';

import {
  createCodeMirrorStyleTheme,
  DEFAULT_CODE_MIRROR_BASIC_SETUP,
} from '@/components/SQLEditor/utils';

import styles from '@/components/SQLEditor/SQLInlineEditor.module.scss';

const promqlExtension = new PromQLExtension();

type PromQLEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  metricNames?: string[];
};

const MAX_EDITOR_HEIGHT = '150px';

export default function PromQLEditor({
  value,
  onChange,
  placeholder,
  onSubmit,
  metricNames,
}: PromQLEditorProps) {
  const { colorScheme } = useMantineColorScheme();
  const ref = useRef<ReactCodeMirrorRef>(null);
  const compartmentRef = useRef<Compartment>(new Compartment());
  const [isFocused, setIsFocused] = useState(false);

  const metricCompletions = useMemo<Completion[]>(
    () =>
      (metricNames ?? []).map(name => ({
        label: name,
        type: 'variable' as const,
      })),
    [metricNames],
  );

  const updateAutocomplete = useCallback(
    (viewRef: EditorView) => {
      if (metricCompletions.length > 0) {
        viewRef.dispatch({
          effects: compartmentRef.current.reconfigure(
            autocompletion({
              override: [
                context => {
                  const word = context.matchBefore(/[\w.:]+/);
                  if (!word && !context.explicit) return null;
                  return {
                    from: word?.from ?? context.pos,
                    options: metricCompletions,
                  };
                },
              ],
            }),
          ),
        });
      }
    },
    [metricCompletions],
  );

  useEffect(() => {
    if (ref.current?.view) {
      updateAutocomplete(ref.current.view);
    }
  }, [updateAutocomplete]);

  const cmExtensions = useMemo(
    () => [
      createCodeMirrorStyleTheme(MAX_EDITOR_HEIGHT),
      EditorView.lineWrapping,

      // PromQL syntax highlighting
      promqlExtension.asExtension(),

      // Metric name autocomplete (via compartment for hot-swapping)
      // eslint-disable-next-line react-hooks/refs
      compartmentRef.current.of([]),

      // Enter to submit, Shift+Enter for newline
      Prec.highest(
        keymap.of([
          {
            key: 'Enter',
            run: () => {
              onSubmit?.();
              return true;
            },
          },
          {
            key: 'Shift-Enter',
            run: () => false,
          },
        ]),
      ),
      keymap.of([
        {
          key: 'Tab',
          run: acceptCompletion,
        },
      ]),
    ],
    [onSubmit],
  );

  const onClickCodeMirror = useCallback(() => {
    if (ref?.current?.view) {
      startCompletion(ref.current.view);
    }
  }, []);

  const isExpanded = isFocused;
  const baseHeight = 36;

  return (
    <div
      className={styles.wrapper}
      style={{ ['--editor-base-height' as string]: `${baseHeight}px` }}
      data-expanded={isExpanded ? 'true' : undefined}
    >
      {isExpanded && <div className={styles.placeholder} aria-hidden="true" />}
      <Paper
        shadow="none"
        className={cx(
          styles.paper,
          isExpanded ? styles.expanded : undefined,
          !isExpanded ? styles.collapseFade : undefined,
        )}
        ps="4px"
      >
        <div
          className={cx(
            styles.cmWrapper,
            !isExpanded ? styles.collapsed : undefined,
            isExpanded ? 'cm-editor-multiline' : undefined,
          )}
        >
          <CodeMirror
            indentWithTab={false}
            ref={ref}
            value={value}
            onChange={onChange}
            theme={colorScheme === 'dark' ? 'dark' : 'light'}
            onFocus={useCallback(() => setIsFocused(true), [])}
            onBlur={useCallback(() => setIsFocused(false), [])}
            extensions={cmExtensions}
            onCreateEditor={updateAutocomplete}
            basicSetup={DEFAULT_CODE_MIRROR_BASIC_SETUP}
            placeholder={placeholder ?? 'Enter PromQL expression...'}
            onClick={onClickCodeMirror}
          />
        </div>
      </Paper>
    </div>
  );
}
