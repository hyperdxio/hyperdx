import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { acceptCompletion } from '@codemirror/autocomplete';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { Paper, useMantineColorScheme } from '@mantine/core';
import CodeMirror, {
  Compartment,
  EditorView,
  keymap,
  Prec,
  ReactCodeMirrorRef,
} from '@uiw/react-codemirror';

import { useMultipleAllFields } from '@/hooks/useMetadata';
import { clickhouseSql } from '@/utils/codeMirror';

import {
  createCodeMirrorSqlDialect,
  createCodeMirrorStyleTheme,
  DEFAULT_CODE_MIRROR_BASIC_SETUP,
  type SQLCompletion,
} from './utils';

type SQLEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  height?: string;
  enableLineWrapping?: boolean;
  tableConnections?: TableConnection[];
  additionalCompletions?: SQLCompletion[];
  dateRange?: [Date, Date];
  timestampValueExpression?: string;
  onSubmit?: () => void;
  /** Gutter line numbers, for editors long enough to navigate by line. */
  showLineNumbers?: boolean;
  /** Applied to the surrounding surface, so callers can restyle it. */
  className?: string;
};

export const createRunQueryKeyBinding = (onSubmit: () => void) => ({
  key: 'Mod-Enter',
  run: () => {
    onSubmit();
    return true;
  },
});

export default function SQLEditor({
  onChange,
  placeholder,
  value,
  height,
  enableLineWrapping = false,
  tableConnections,
  additionalCompletions,
  dateRange,
  timestampValueExpression,
  onSubmit,
  showLineNumbers = false,
  className,
}: SQLEditorProps) {
  const { colorScheme } = useMantineColorScheme();
  const ref = useRef<ReactCodeMirrorRef>(null);
  const compartmentRef = useRef<Compartment>(new Compartment());

  // The gutter shares the editor's fill and is set off only by its rule, so
  // the numbers read as part of the block rather than a second panel.
  const lineNumberTheme = useMemo(
    () =>
      showLineNumbers
        ? [
            EditorView.theme({
              '.cm-gutters': {
                background: 'transparent',
                borderRight: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
              },
              '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px' },
            }),
          ]
        : [],
    [showLineNumbers],
  );

  const runQueryKeymap = useMemo(
    () =>
      onSubmit == null
        ? []
        : [Prec.highest(keymap.of([createRunQueryKeyBinding(onSubmit)]))],
    [onSubmit],
  );

  const { data: fields } = useMultipleAllFields(tableConnections ?? [], {
    dateRange,
    timestampValueExpression,
  });

  const updateAutocompleteColumns = useCallback(
    (viewRef: EditorView) => {
      const identifiers: string[] = [
        // Suggest database and table names for autocompletion
        ...new Set(tableConnections?.map(tc => tc.tableName) ?? []),
        ...new Set(tableConnections?.map(tc => tc.databaseName) ?? []),
        ...new Set(
          tableConnections?.map(tc => `${tc.databaseName}.${tc.tableName}`) ??
            [],
        ),

        // Suggest column names for autocompletion, including Map keys
        ...(fields?.map(column => {
          if (column.path.length > 1) {
            return `${column.path[0]}['${column.path[1]}']`;
          }
          return column.path[0];
        }) ?? []),
      ];

      viewRef.dispatch({
        effects: compartmentRef.current.reconfigure(
          createCodeMirrorSqlDialect({
            identifiers,
            additionalCompletions,
            includeAggregateFunctions: true,
            includeRegularFunctions: true,
          }),
        ),
      });
    },
    [additionalCompletions, fields, tableConnections],
  );

  useEffect(() => {
    if (ref.current != null && ref.current.view != null) {
      updateAutocompleteColumns(ref.current.view);
    }
  }, [updateAutocompleteColumns]);

  return (
    <Paper className={className} style={{ width: '100%' }}>
      <CodeMirror
        indentWithTab={false}
        ref={ref}
        value={value}
        onChange={onChange}
        onCreateEditor={updateAutocompleteColumns}
        theme={colorScheme === 'dark' ? 'dark' : 'light'}
        height={height}
        minHeight={'100px'}
        extensions={[
          createCodeMirrorStyleTheme(),
          ...lineNumberTheme,
          // eslint-disable-next-line react-hooks/refs
          compartmentRef.current.of(
            clickhouseSql({
              upperCaseKeywords: true,
            }),
          ),
          ...runQueryKeymap,
          keymap.of([
            {
              key: 'Tab',
              run: acceptCompletion,
            },
          ]),
          ...(enableLineWrapping ? [EditorView.lineWrapping] : []),
        ]}
        basicSetup={{
          ...DEFAULT_CODE_MIRROR_BASIC_SETUP,
          lineNumbers: showLineNumbers,
        }}
        placeholder={placeholder}
      />
    </Paper>
  );
}

export function SQLEditorControlled({
  onValueChange,
  ...props
}: Omit<SQLEditorProps, 'value' | 'onChange'> &
  UseControllerProps<any> & {
    /**
     * Fired alongside the form update, for callers that need to react to the
     * user editing (rather than to the value changing, which also happens when
     * the field is set programmatically).
     */
    onValueChange?: (value: string) => void;
  }) {
  const { field } = useController(props);

  return (
    <SQLEditor
      {...props}
      value={field.value}
      onChange={value => {
        field.onChange(value);
        onValueChange?.(value);
      }}
    />
  );
}
