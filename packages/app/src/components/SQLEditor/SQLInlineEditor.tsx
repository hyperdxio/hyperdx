import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import { useController, UseControllerProps } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  Completion,
  startCompletion,
} from '@codemirror/autocomplete';
import {
  Field,
  TableConnectionChoice,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  Flex,
  Paper,
  Text,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import CodeMirror, {
  Compartment,
  EditorView,
  keymap,
  Prec,
  ReactCodeMirrorRef,
  tooltips,
} from '@uiw/react-codemirror';

import { EDITOR_INPUT_HEIGHTS } from '@/components/editorInputHeights';
import EditorMultilineToggle from '@/components/EditorMultilineToggle';
import { useMultipleAllFields } from '@/hooks/useMetadata';
import { useStableCallback } from '@/hooks/useStableCallback';
import { useSource } from '@/source';
import { useQueryHistory } from '@/utils';
import { clickhouseSql } from '@/utils/codeMirror';

import { KEYWORDS_FOR_WHERE_OR_ORDER_BY } from './constants';
import {
  createCodeMirrorSqlDialect,
  createCodeMirrorStyleTheme,
  DEFAULT_CODE_MIRROR_BASIC_SETUP,
} from './utils';
import { useSqlVariableCompletions } from './variableCompletions';
import {
  useVariableValidation,
  VariableIssueIndicator,
  variableValidationState,
} from './variableValidation';

import styles from './SQLInlineEditor.module.scss';

type SQLInlineEditorProps = {
  filterField?: (field: Field) => boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  error?: React.ReactNode;
  size?: string;
  label?: React.ReactNode;
  disableKeywordAutocomplete?: boolean;
  enableHotkey?: boolean;
  tooltipText?: string;
  additionalSuggestions?: string[];
  queryHistoryType?: string;
  parentRef?: HTMLElement | null;
  allowMultiline?: boolean;
  /**
   * Whether an open editor floats over the content below. Set false when an
   * ancestor floats the whole field instead, so its own chrome (the
   * SearchWhereInput language picker) grows with the editor.
   */
  floatOnOpen?: boolean;
  dateRange?: [Date, Date];
  sourceId?: string;
  // With multiple tableConnections, offer only fields present in ALL of them
  // (intersection) rather than the union — for an expression that must be valid
  // against every connection, e.g. a chart-level Group By over multiple series.
  intersectFields?: boolean;
  // Whether the dashboard variables in scope apply to this expression: offer
  // them as completions, and warn about the references that won't work.
  enableVariables?: boolean;
};

const MAX_EDITOR_HEIGHT = '150px';

export default function SQLInlineEditor({
  tableConnection,
  tableConnections,
  filterField,
  onChange,
  placeholder,
  onSubmit,
  error,
  value,
  size,
  label,
  disableKeywordAutocomplete,
  enableHotkey,
  tooltipText,
  additionalSuggestions,
  queryHistoryType,
  parentRef,
  allowMultiline = true,
  floatOnOpen = true,
  dateRange,
  sourceId,
  intersectFields,
  enableVariables = false,
}: SQLInlineEditorProps & TableConnectionChoice) {
  const { colorScheme } = useMantineColorScheme();
  const _tableConnections = tableConnection
    ? [tableConnection]
    : tableConnections;
  const { data: source } = useSource({ id: sourceId });
  const { data: fields } = useMultipleAllFields(_tableConnections ?? [], {
    dateRange,
    timestampValueExpression: source?.timestampValueExpression,
    intersect: intersectFields,
  });
  const filteredFields = useMemo(() => {
    return filterField ? fields?.filter(filterField) : fields;
  }, [fields, filterField]);

  // query search history
  const [queryHistory, setQueryHistory] = useQueryHistory(queryHistoryType);

  const onSelectSearchHistory = useCallback(
    (view: EditorView, from: number, to: number, q: string) => {
      // update history into search bar
      view.dispatch({
        changes: { from, to, insert: q },
      });
      // close history bar;
      closeCompletion(view);
      // update history order
      setQueryHistory(q);
      // execute search
      if (onSubmit) onSubmit();
    },
    [onSubmit, setQueryHistory],
  );

  const createHistoryList = useMemo(() => {
    return () => {
      return {
        from: 0,
        options: queryHistory.map(q => {
          return {
            label: q,
            section: 'Search History',
            type: 'keyword',
            apply: (
              view: EditorView,
              _completion: Completion,
              from: number,
              to: number,
            ) => {
              onSelectSearchHistory(view, from, to, q);
            },
          };
        }),
      };
    };
  }, [queryHistory, onSelectSearchHistory]);

  // Dashboard variables in scope, offered alongside the column identifiers,
  // and checked for the references that won't expand.
  const variableCompletions = useSqlVariableCompletions({
    enabled: enableVariables,
  });
  const variableIssues = useVariableValidation(value, {
    enabled: enableVariables,
    language: 'sql',
  });

  const [isFocused, setIsFocused] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  // Focus peeks at the query: the editor spills over the content below so the
  // layout still holds one row. Expanding is deliberate, so it reflows instead,
  // growing the row and pushing the content down.
  const isOpen = allowMultiline && (isFocused || isExpanded);
  const isFloating = isOpen && floatOnOpen && !isExpanded;

  const ref = useRef<ReactCodeMirrorRef>(null);

  // Opening from collapsed should start at the first line. CodeMirror otherwise
  // keeps a mid-document scroll (from a previous caret), which made the overlay
  // open on a middle line instead of the start of the query.
  useEffect(() => {
    if (!isOpen) return;
    const scroller = ref.current?.view?.scrollDOM;
    if (scroller) scroller.scrollTop = 0;
  }, [isOpen]);

  const compartmentRef = useRef<Compartment>(new Compartment());

  const hasNonEmptyValue = value.trim().length > 0;

  const updateAutocompleteColumns = useCallback(
    (viewRef: EditorView) => {
      const identifiers = [
        ...(filteredFields?.map(column => {
          if (column.path.length > 1) {
            return `${column.path[0]}['${column.path[1]}']`;
          }
          return column.path[0];
        }) ?? []),
        ...(additionalSuggestions ?? []),
      ];

      const auto = createCodeMirrorSqlDialect({
        identifiers,
        keywords: KEYWORDS_FOR_WHERE_OR_ORDER_BY,
        includeRegularFunctions: !disableKeywordAutocomplete,
        additionalCompletions: variableCompletions,
      });

      const queryHistoryList = autocompletion({
        compareCompletions: () => {
          return 0;
        }, // don't sort the history search
        override: [createHistoryList],
      });
      viewRef.dispatch({
        effects: compartmentRef.current.reconfigure(
          hasNonEmptyValue ? auto : queryHistoryList,
        ),
      });
    },
    [
      filteredFields,
      additionalSuggestions,
      variableCompletions,
      disableKeywordAutocomplete,
      createHistoryList,
      hasNonEmptyValue,
    ],
  );

  useEffect(() => {
    if (ref.current != null && ref.current.view != null) {
      updateAutocompleteColumns(ref.current.view);
    }
    // Otherwise we'll update the columns in `onCreateEditor` hook
  }, [updateAutocompleteColumns]);

  useHotkeys(
    ['/', 's'],
    () => {
      if (enableHotkey) {
        ref.current?.view?.focus();
      }
    },
    {
      preventDefault: true,
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
    [enableHotkey],
  );

  /**
   * If the editor is inside a modal, we need to position the tooltip
   * relative to the modal. This ensures that the autocompletion results
   * are properly calculated off the correct element.
   */
  const tooltipExt = useMemo(() => {
    if (parentRef == null) {
      return [];
    }
    // A body-level parent is already outside every scroll container, so the
    // tooltip should be free to use the whole viewport — CodeMirror's default
    // space.
    if (parentRef === parentRef.ownerDocument.body) {
      return [tooltips({ parent: parentRef })];
    }
    return [
      tooltips({
        parent: parentRef,
        tooltipSpace: view => {
          const box = view.dom.getBoundingClientRect();
          const parentBox = parentRef.getBoundingClientRect();
          return {
            ...box,
            right: box.right ?? 0,
            left: parentBox.left ?? box.left,
            top: parentBox.top ?? box.top,
            bottom: parentBox.bottom ?? box.bottom,
          };
        },
      }),
    ];
  }, [parentRef]);

  // Stable so a new onSubmit identity (every live tail tick) doesn't reconfigure the editor.
  const submitFromEditor = useStableCallback(() => {
    if (onSubmit == null) {
      return false;
    }
    if (queryHistoryType && ref?.current?.view) {
      setQueryHistory(ref?.current?.view.state.doc.toString());
    }
    onSubmit();
    return true;
  });

  const cmExtensions = useMemo(
    () => [
      ...tooltipExt,
      createCodeMirrorStyleTheme(MAX_EDITOR_HEIGHT),

      // Enable line wrapping when multiline is allowed (regardless of focus)
      ...(allowMultiline ? [EditorView.lineWrapping] : []),

      // eslint-disable-next-line react-hooks/refs
      compartmentRef.current.of(
        clickhouseSql({
          upperCaseKeywords: true,
        }),
      ),

      // Configure Enter key to submit search, and Shift + Enter to insert new line when multiline is allowed
      Prec.highest(
        keymap.of([
          {
            key: 'Enter',
            run: submitFromEditor,
          },
          ...(allowMultiline
            ? [
                {
                  key: 'Shift-Enter',
                  run: () => {
                    // Allow default behavior (insert new line)
                    return false;
                  },
                },
              ]
            : []),
        ]),
      ),
      keymap.of([
        {
          key: 'Tab',
          run: acceptCompletion,
        },
      ]),
    ],
    [allowMultiline, submitFromEditor, tooltipExt],
  );

  const onClickCodeMirror = useCallback(() => {
    if (ref?.current?.view) {
      startCompletion(ref.current.view);
    }
  }, []);

  const validationState = variableValidationState(variableIssues, !!error);
  const baseHeight =
    size === 'xs' ? EDITOR_INPUT_HEIGHTS.xs : EDITOR_INPUT_HEIGHTS.sm;

  return (
    <div
      className={cx(
        styles.wrapper,
        isFloating ? styles.pinnedHeight : undefined,
      )}
      style={{ ['--editor-base-height' as string]: `${baseHeight}px` }}
      data-validation-state={validationState}
      data-multiline-expanded={allowMultiline ? isOpen : undefined}
      data-multiline-pinned={allowMultiline ? isExpanded : undefined}
    >
      <Paper
        shadow="none"
        className={cx(
          styles.paper,
          validationState === 'error' ? styles.error : undefined,
          validationState === 'warning' ? styles.warning : undefined,
          !isOpen ? styles.clamped : styles.open,
          isFloating ? styles.floating : undefined,
          isFloating && isFocused ? styles.elevated : undefined,
          isFocused ? styles.focused : undefined,
        )}
        // A label is an addon flush against the frame, so it supplies its own
        // inline padding instead of sitting inside the field's.
        ps={label != null ? 0 : '4px'}
      >
        {label != null && (
          <Text
            size="xs"
            fw="bold"
            className={cx(
              styles.label,
              size === 'xs' ? styles.sizeXs : undefined,
            )}
            component="div"
          >
            <Tooltip label={tooltipText} disabled={!tooltipText}>
              <Flex align="center" gap={2}>
                {label}
                {tooltipText && <IconInfoCircle size={16} />}
              </Flex>
            </Tooltip>
          </Text>
        )}
        <div
          className={cx(
            styles.cmWrapper,
            size === 'xs' ? styles.sizeXs : undefined,
            // Only an open editor scrolls its own content. Collapsed, it
            // renders at full height behind the clip so the first line shows.
            isOpen ? 'cm-editor-multiline' : undefined,
          )}
        >
          <CodeMirror
            indentWithTab={false}
            ref={ref}
            value={value}
            onChange={onChange}
            theme={colorScheme === 'dark' ? 'dark' : 'light'}
            onFocus={useCallback(() => {
              setIsFocused(true);
            }, [])}
            onBlur={useCallback(() => {
              setIsFocused(false);
            }, [])}
            extensions={cmExtensions}
            onCreateEditor={updateAutocompleteColumns}
            basicSetup={DEFAULT_CODE_MIRROR_BASIC_SETUP}
            placeholder={placeholder}
            onClick={onClickCodeMirror}
          />
        </div>
        <div className={styles.actions}>
          {allowMultiline && (
            <EditorMultilineToggle
              expanded={isExpanded}
              onToggle={() => setIsExpanded(expanded => !expanded)}
            />
          )}
          <VariableIssueIndicator issues={variableIssues} />
        </div>
      </Paper>
    </div>
  );
}

function SQLInlineEditorControlledComponent({
  placeholder,
  filterField,
  additionalSuggestions,
  queryHistoryType,
  ...props
}: Omit<SQLInlineEditorProps, 'value' | 'onChange'> &
  UseControllerProps<any> &
  TableConnectionChoice) {
  const { field, fieldState } = useController(props);

  // Guard against wrongly typed values
  const value = field.value || props.defaultValue;

  let stringValue = '';
  if (typeof value === 'string') {
    stringValue = value;
  } else if (value !== undefined) {
    console.error('SQLInlineEditor: value is not a string', value);
  }

  return (
    <SQLInlineEditor
      filterField={filterField}
      onChange={field.onChange}
      placeholder={placeholder}
      value={stringValue}
      error={fieldState.error?.message}
      additionalSuggestions={additionalSuggestions}
      queryHistoryType={queryHistoryType}
      {...props}
    />
  );
}
export const SQLInlineEditorControlled = memo(
  SQLInlineEditorControlledComponent,
);
