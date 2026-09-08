import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import {
  acceptCompletion,
  autocompletion,
  Completion,
  CompletionSource,
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
  tooltips,
} from '@uiw/react-codemirror';

import {
  createCodeMirrorStyleTheme,
  DEFAULT_CODE_MIRROR_BASIC_SETUP,
} from '@/components/SQLEditor/utils';
import { usePromqlVariableCompletions } from '@/components/SQLEditor/variableCompletions';
import {
  useVariableValidation,
  VariableIssueIndicator,
} from '@/components/SQLEditor/variableValidation';

import { createVariableCompletionSource } from './variableCompletionSource';

import styles from '@/components/SQLEditor/SQLInlineEditor.module.scss';

const promqlExtension = new PromQLExtension();

type PromQLEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  metricNames?: string[];
  /**
   * Where to render the completion popup. Set it to `document.body` inside a
   * modal or other scroll container, which would otherwise clip the popup.
   */
  parentRef?: HTMLElement | null;
};

const MAX_EDITOR_HEIGHT = '150px';

// Cap the number of completion options returned per query. With large
// Prometheus instances `metricNames` can be 1M+ entries; passing the whole
// list to CodeMirror's fuzzy filter on every keystroke causes severe typing
// latency.
const COMPLETION_LIMIT = 500;

// Wait this long after the last keystroke before scanning `metricNames`.
// `context.aborted` flips to true when CodeMirror starts a newer request, so
// any in-flight scan from a previous burst short-circuits and returns null.
const COMPLETION_DEBOUNCE_MS = 150;

const debounceAndPruneAutocompleteResults: (
  metricNames: string[],
) => CompletionSource = metricNames => {
  return async context => {
    const word = context.matchBefore(/[\w.:]+/);
    if (!word && !context.explicit) return null;

    if (!context.explicit) {
      // debounce so we don't do this expensive operation on every keystroke
      await new Promise(r => setTimeout(r, COMPLETION_DEBOUNCE_MS));
      if (context.aborted) return null;
    }

    const prefix = (word?.text ?? '').toLowerCase();
    // matches is a list with a max length of COMPLETION_LIMIT of search terms that match.
    // For large metrics deployments, this is necessary
    const matches: Completion[] = [];
    if (prefix === '') {
      for (
        let i = 0;
        i < metricNames.length && matches.length < COMPLETION_LIMIT;
        i++
      ) {
        matches.push({ label: metricNames[i], type: 'variable' });
      }
    } else {
      for (
        let i = 0;
        i < metricNames.length && matches.length < COMPLETION_LIMIT;
        i++
      ) {
        if (metricNames[i].toLowerCase().startsWith(prefix)) {
          matches.push({ label: metricNames[i], type: 'variable' });
        }
      }
    }

    return {
      from: word?.from ?? context.pos,
      options: matches,
    };
  };
};

export default function PromQLEditor({
  value,
  onChange,
  placeholder,
  onSubmit,
  metricNames,
  parentRef,
}: PromQLEditorProps) {
  const { colorScheme } = useMantineColorScheme();
  const ref = useRef<ReactCodeMirrorRef>(null);
  const compartmentRef = useRef<Compartment>(new Compartment());
  const [isFocused, setIsFocused] = useState(false);
  const variableCompletions = usePromqlVariableCompletions();
  const variableIssues = useVariableValidation(value, { language: 'promql' });

  const updateAutocomplete = useCallback(
    (viewRef: EditorView) => {
      const override: CompletionSource[] = [];

      if (variableCompletions.length > 0) {
        override.push(createVariableCompletionSource(variableCompletions));
      }

      if (metricNames?.length) {
        override.push(debounceAndPruneAutocompleteResults(metricNames));
      }

      // PromQL's own function/keyword completion, re-registered explicitly.
      // `PromQLExtension.asExtension()` registers it through
      // `language.data.of({ autocomplete })`, which an `override` array
      // replaces outright — so without this it is silently lost.
      override.push(context => promqlExtension.getComplete().promQL(context));

      viewRef.dispatch({
        effects: compartmentRef.current.reconfigure(
          autocompletion({ override }),
        ),
      });
    },
    [metricNames, variableCompletions],
  );

  useEffect(() => {
    if (ref.current?.view) {
      updateAutocomplete(ref.current.view);
    }
  }, [updateAutocomplete]);

  const cmExtensions = useMemo(
    () => [
      ...(parentRef ? [tooltips({ parent: parentRef })] : []),
      createCodeMirrorStyleTheme(MAX_EDITOR_HEIGHT),
      EditorView.lineWrapping,

      // PromQL syntax highlighting
      promqlExtension.asExtension(),

      // Autocomplete sources (via compartment for hot-swapping)
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
    [onSubmit, parentRef],
  );

  const onClickCodeMirror = useCallback(() => {
    if (ref?.current?.view) {
      startCompletion(ref.current.view);
    }
  }, []);

  const isExpanded = isFocused;
  const isVariableWarningOnly =
    variableIssues.errors.length === 0 && variableIssues.warnings.length > 0;
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
          variableIssues.errors.length > 0 ? styles.error : undefined,
          isVariableWarningOnly ? styles.warning : undefined,
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
        <VariableIssueIndicator issues={variableIssues} />
      </Paper>
    </div>
  );
}
