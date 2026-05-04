import { useCallback, useEffect, useRef } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { acceptCompletion } from '@codemirror/autocomplete';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { Paper, useMantineColorScheme } from '@mantine/core';
import CodeMirror, {
  Compartment,
  EditorView,
  keymap,
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
};

export default function SQLEditor({
  onChange,
  placeholder,
  value,
  height,
  enableLineWrapping = false,
  tableConnections,
  additionalCompletions,
}: SQLEditorProps) {
  const { colorScheme } = useMantineColorScheme();
  const ref = useRef<ReactCodeMirrorRef>(null);
  const compartmentRef = useRef<Compartment>(new Compartment());

  const { data: fields } = useMultipleAllFields(tableConnections ?? []);

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
    <Paper style={{ width: '100%' }}>
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
          // eslint-disable-next-line react-hooks/refs
          compartmentRef.current.of(
            clickhouseSql({
              upperCaseKeywords: true,
            }),
          ),
          keymap.of([
            {
              key: 'Tab',
              run: acceptCompletion,
            },
          ]),
          ...(enableLineWrapping ? [EditorView.lineWrapping] : []),
        ]}
        basicSetup={DEFAULT_CODE_MIRROR_BASIC_SETUP}
        placeholder={placeholder}
      />
    </Paper>
  );
}

export function SQLEditorControlled({
  ...props
}: Omit<SQLEditorProps, 'value' | 'onChange'> & UseControllerProps<any>) {
  const { field } = useController(props);

  return <SQLEditor onChange={field.onChange} value={field.value} {...props} />;
}
