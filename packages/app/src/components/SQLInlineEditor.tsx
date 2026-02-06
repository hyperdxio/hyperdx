import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  Completion,
  startCompletion,
} from '@codemirror/autocomplete';
import { sql, SQLDialect } from '@codemirror/lang-sql';
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

import { useMultipleAllFields } from '@/hooks/useMetadata';
import { useQueryHistory } from '@/utils';

import InputLanguageSwitch from './InputLanguageSwitch';

const AUTOCOMPLETE_LIST_FOR_SQL_FUNCTIONS = [
  // used with WHERE
  'AND',
  'OR',
  'NOT',
  'IN',
  'LIKE',
  'ILIKE',
  'BETWEEN',
  'ASC',
  'DESC',
  // regular functions - arithmetic
  'intDiv',
  'intDivOrZero',
  'isNaN',
  'moduloOrZero',
  'abs',
  // regular functions - array
  'empty',
  'notEmpty',
  'length',
  'arrayConcat',
  'has',
  'hasAll',
  'hasAny',
  'indexOf',
  'arrayCount',
  'countEqual',
  'arrayUnion',
  'arrayIntersect',
  'arrayMap',
  'arrayFilter',
  'arraySort',
  'flatten',
  'arrayCompact',
  'arrayMin',
  'arrayMax',
  'arraySum',
  'arrayAvg',
  // regular functions - conditional
  'if',
  'multiIf',
  // regular functions - rounding
  'floor',
  'ceiling',
  'truncate',
  'round',
  // regular functions - dates and times
  'timestamp',
  'toTimeZone',
  'toYear',
  'toMonth',
  'toWeek',
  'toDayOfYear',
  'toDayOfMonth',
  'toDayOfWeek',
  'toUnixTimestamp',
  'toTime',
  // regular functions - string
  'lower',
  'upper',
  'substring',
  'trim',
  // regular functions - dictionaries
  'dictGet',
  'dictGetOrDefault',
  'dictGetOrNull',
];

const AUTOCOMPLETE_LIST_STRING = ` ${AUTOCOMPLETE_LIST_FOR_SQL_FUNCTIONS.join(' ')}`;

type SQLInlineEditorProps = {
  autoCompleteFields?: Field[];
  filterField?: (field: Field) => boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onLanguageChange?: (language: 'sql' | 'lucene') => void;
  language?: 'sql' | 'lucene';
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
};

const MAX_EDITOR_HEIGHT = '150px';

const createStyleTheme = () =>
  EditorView.baseTheme({
    '&.cm-editor.cm-focused': {
      outline: '0px solid transparent',
    },
    '&.cm-editor': {
      background: 'transparent !important',
    },
    '.cm-editor-multiline &.cm-editor': {
      maxHeight: MAX_EDITOR_HEIGHT,
    },
    '& .cm-tooltip-autocomplete': {
      whiteSpace: 'nowrap',
      wordWrap: 'break-word',
      maxWidth: '100%',
      backgroundColor: 'var(--color-bg-field) !important',
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
      backgroundColor: 'var(--color-bg-field-highlighted) !important',
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
    '.cm-editor-multiline & .cm-scroller': {
      maxHeight: MAX_EDITOR_HEIGHT,
      overflowY: 'auto',
    },
  });

const cmBasicSetup = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
};

export default function SQLInlineEditor({
  tableConnection,
  tableConnections,
  filterField,
  onChange,
  placeholder,
  onLanguageChange,
  language,
  onSubmit,
  error,
  value,
  size,
  label,
  disableKeywordAutocomplete,
  enableHotkey,
  tooltipText,
  additionalSuggestions = [],
  queryHistoryType,
  parentRef,
  allowMultiline = false,
}: SQLInlineEditorProps & TableConnectionChoice) {
  const { colorScheme } = useMantineColorScheme();
  const _tableConnections = tableConnection
    ? [tableConnection]
    : tableConnections;
  const { data: fields } = useMultipleAllFields(_tableConnections ?? []);
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

  const [isFocused, setIsFocused] = useState(false);

  const ref = useRef<ReactCodeMirrorRef>(null);

  const compartmentRef = useRef<Compartment>(new Compartment());

  const updateAutocompleteColumns = useCallback(
    (viewRef: EditorView) => {
      const currentText = viewRef.state.doc.toString();
      const keywords = [
        ...(filteredFields?.map(column => {
          if (column.path.length > 1) {
            return `${column.path[0]}['${column.path[1]}']`;
          }
          return column.path[0];
        }) ?? []),
        ...additionalSuggestions,
      ];

      const auto = sql({
        dialect: SQLDialect.define({
          keywords:
            keywords.join(' ') +
            (disableKeywordAutocomplete ? '' : AUTOCOMPLETE_LIST_STRING),
        }),
      });
      const queryHistoryList = autocompletion({
        compareCompletions: (a: any, b: any) => {
          return 0;
        }, // don't sort the history search
        override: [createHistoryList],
      });
      viewRef.dispatch({
        effects: compartmentRef.current.reconfigure(
          currentText.length > 0 ? auto : queryHistoryList,
        ),
      });
    },
    [
      filteredFields,
      additionalSuggestions,
      createHistoryList,
      disableKeywordAutocomplete,
    ],
  );

  useEffect(() => {
    if (ref.current != null && ref.current.view != null) {
      updateAutocompleteColumns(ref.current.view);
    }
    // Otherwise we'll update the columns in `onCreateEditor` hook
  }, [updateAutocompleteColumns]);

  useHotkeys(
    '/',
    () => {
      if (enableHotkey) {
        ref.current?.view?.focus();
      }
    },
    { preventDefault: true },
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

  const cmExtensions = useMemo(
    () => [
      ...tooltipExt,
      createStyleTheme(),
      ...(allowMultiline ? [EditorView.lineWrapping] : []),
      // eslint-disable-next-line react-hooks/refs
      compartmentRef.current.of(
        sql({
          upperCaseKeywords: true,
        }),
      ),
      Prec.highest(
        keymap.of([
          {
            key: 'Enter',
            run: view => {
              if (onSubmit == null) {
                return false;
              }
              if (queryHistoryType && ref?.current?.view) {
                setQueryHistory(ref?.current?.view.state.doc.toString());
              }
              onSubmit();
              return true;
            },
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
    [allowMultiline, onSubmit, queryHistoryType, setQueryHistory, tooltipExt],
  );

  const onClickCodeMirror = useCallback(() => {
    if (ref?.current?.view) {
      startCompletion(ref.current.view);
    }
  }, []);

  return (
    <Paper
      flex="auto"
      shadow="none"
      style={{
        backgroundColor: 'var(--color-bg-field)',
        border: `1px solid ${error ? 'var(--color-bg-danger)' : 'var(--color-border)'}`,
        display: 'flex',
        alignItems: 'center',
        minHeight: size === 'xs' ? 30 : 36,
      }}
      ps="4px"
    >
      {label != null && (
        <Text
          mx="4px"
          size="xs"
          fw="bold"
          style={{
            whiteSpace: 'nowrap',
          }}
          component="div"
        >
          <Tooltip label={tooltipText} disabled={!tooltipText}>
            <Flex align="center" gap={2}>
              {label}
              {tooltipText && <IconInfoCircle size={20} />}
            </Flex>
          </Tooltip>
        </Text>
      )}
      <div
        style={{ minWidth: 10, width: '100%' }}
        className={allowMultiline ? 'cm-editor-multiline' : ''}
      >
        <CodeMirror
          indentWithTab={false}
          ref={ref}
          value={value}
          onChange={onChange}
          theme={colorScheme === 'dark' ? 'dark' : 'light'}
          onFocus={useCallback(() => {
            setIsFocused(true);
          }, [setIsFocused])}
          onBlur={useCallback(() => {
            setIsFocused(false);
          }, [setIsFocused])}
          extensions={cmExtensions}
          onCreateEditor={updateAutocompleteColumns}
          basicSetup={cmBasicSetup}
          placeholder={placeholder}
          onClick={onClickCodeMirror}
        />
      </div>
      {onLanguageChange != null && language != null && (
        <InputLanguageSwitch
          showHotkey={enableHotkey && isFocused}
          language={language}
          onLanguageChange={onLanguageChange}
        />
      )}
    </Paper>
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
