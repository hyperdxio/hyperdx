import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  Completion,
  CompletionSection,
  startCompletion,
} from '@codemirror/autocomplete';
import { sql, SQLDialect } from '@codemirror/lang-sql';
import { Field, TableConnection } from '@hyperdx/common-utils/dist/metadata';
import { Paper, Text } from '@mantine/core';
import CodeMirror, {
  Compartment,
  EditorView,
  keymap,
  Prec,
  ReactCodeMirrorRef,
} from '@uiw/react-codemirror';

import { useAllFields } from '@/hooks/useMetadata';
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
  tableConnections?: TableConnection | TableConnection[];
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
  additionalSuggestions?: string[];
  queryHistoryType?: string;
};

const styleTheme = EditorView.baseTheme({
  '&.cm-editor.cm-focused': {
    outline: '0px solid transparent',
  },
  '&.cm-editor': {
    background: 'transparent !important',
  },
  '& .cm-scroller': {
    overflowX: 'hidden',
  },
});

export default function SQLInlineEditor({
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
  additionalSuggestions = [],
  queryHistoryType,
}: SQLInlineEditorProps) {
  const { data: fields } = useAllFields(tableConnections ?? [], {
    enabled:
      !!tableConnections &&
      (Array.isArray(tableConnections) ? tableConnections.length > 0 : true),
  });
  const filteredFields = useMemo(() => {
    return filterField ? fields?.filter(filterField) : fields;
  }, [fields, filterField]);

  // query search history
  const [queryHistory, setQueryHistory] = useQueryHistory(queryHistoryType);

  const onSelectSearchHistory = (
    view: EditorView,
    from: number,
    to: number,
    q: string,
  ) => {
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
  };

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
  }, [queryHistory]);

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
    [filteredFields, additionalSuggestions, queryHistory],
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

  return (
    <Paper
      flex="auto"
      shadow="none"
      bg="dark.6"
      style={{
        border: `1px solid ${error ? 'var(--mantine-color-red-7)' : 'var(--mantine-color-gray-7)'}`,
        display: 'flex',
        alignItems: 'center',
        minHeight: size === 'xs' ? 30 : 36,
      }}
      ps="4px"
    >
      {label != null && (
        <Text
          c="gray.4"
          mx="4px"
          size="xs"
          fw="bold"
          style={{ whiteSpace: 'nowrap' }}
        >
          {label}
        </Text>
      )}
      <div style={{ minWidth: 10, width: '100%' }}>
        <CodeMirror
          indentWithTab={false}
          ref={ref}
          value={value}
          onChange={onChange}
          theme={'dark'}
          onFocus={() => {
            setIsFocused(true);
          }}
          onBlur={() => {
            setIsFocused(false);
          }}
          extensions={[
            styleTheme,
            compartmentRef.current.of(
              sql({
                upperCaseKeywords: true,
              }),
            ),
            Prec.highest(
              keymap.of([
                {
                  key: 'Enter',
                  run: () => {
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
              ]),
            ),
            keymap.of([
              {
                key: 'Tab',
                run: acceptCompletion,
              },
            ]),
          ]}
          onCreateEditor={view => {
            updateAutocompleteColumns(view);
          }}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
          }}
          placeholder={placeholder}
          onClick={() => {
            if (ref?.current?.view) {
              startCompletion(ref.current.view);
            }
          }}
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
}: Omit<SQLInlineEditorProps, 'value' | 'onChange'> & UseControllerProps<any>) {
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
