import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
import { acceptCompletion, startCompletion } from '@codemirror/autocomplete';
import { sql, SQLDialect } from '@codemirror/lang-sql';
import { Paper, Text } from '@mantine/core';
import CodeMirror, {
  Compartment,
  EditorView,
  keymap,
  Prec,
  ReactCodeMirrorRef,
} from '@uiw/react-codemirror';

import { useAllFields } from '@/hooks/useMetadata';
import { Field } from '@/metadata';

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
  database?: string | undefined;
  table?: string | undefined;
  filterField?: (field: Field) => boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onLanguageChange?: (language: 'sql' | 'lucene') => void;
  language?: 'sql' | 'lucene';
  onSubmit?: () => void;
  size?: string;
  label?: React.ReactNode;
  disableKeywordAutocomplete?: boolean;
  connectionId: string | undefined;
  enableHotkey?: boolean;
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
  database,
  filterField,
  onChange,
  placeholder,
  onLanguageChange,
  language,
  onSubmit,
  table,
  value,
  size,
  label,
  disableKeywordAutocomplete,
  connectionId,
  enableHotkey,
}: SQLInlineEditorProps) {
  const { data: fields } = useAllFields(
    {
      databaseName: database ?? '',
      tableName: table ?? '',
      connectionId: connectionId ?? '',
    },
    {
      enabled: !!database && !!table && !!connectionId,
    },
  );

  const filteredFields = useMemo(() => {
    return filterField ? fields?.filter(filterField) : fields;
  }, [fields, filterField]);

  const [isFocused, setIsFocused] = useState(false);

  const ref = useRef<ReactCodeMirrorRef>(null);

  const compartmentRef = useRef<Compartment>(new Compartment());

  const updateAutocompleteColumns = useCallback(
    (viewRef: EditorView) => {
      const keywords =
        filteredFields?.map(column => {
          if (column.path.length > 1) {
            return `${column.path[0]}['${column.path[1]}']`;
          }
          return column.path[0];
        }) ?? [];

      viewRef.dispatch({
        effects: compartmentRef.current.reconfigure(
          sql({
            defaultTable: table ?? '',
            // schema, // FIXME: maybe we want to use schema. need to figure out the identifier issue
            dialect: SQLDialect.define({
              keywords:
                keywords.join(' ') +
                (disableKeywordAutocomplete ? '' : AUTOCOMPLETE_LIST_STRING),
              // identifierQuotes: '`',
            }),
          }),
        ),
      });
    },
    [filteredFields, table],
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
        border: '1px solid var(--mantine-color-gray-7)',
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
      <div style={{ width: '100%' }}>
        <CodeMirror
          indentWithTab={false}
          ref={ref}
          value={value}
          onChange={onChange}
          theme={'dark'}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
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
          onUpdate={update => {
            // Always open completion window as much as possible
            if (
              update.focusChanged &&
              update.view.hasFocus &&
              ref.current?.view
            ) {
              startCompletion(ref.current?.view);
            }
          }}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
          }}
          placeholder={placeholder}
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

export function SQLInlineEditorControlled({
  database,
  table,
  placeholder,
  filterField,
  connectionId,
  ...props
}: Omit<SQLInlineEditorProps, 'value' | 'onChange'> & UseControllerProps<any>) {
  const { field } = useController(props);

  return (
    <SQLInlineEditor
      database={database}
      filterField={filterField}
      onChange={field.onChange}
      placeholder={placeholder}
      table={table}
      value={field.value || props.defaultValue}
      connectionId={connectionId}
      {...props}
    />
  );
}
