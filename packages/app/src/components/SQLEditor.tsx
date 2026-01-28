import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { acceptCompletion, startCompletion } from '@codemirror/autocomplete';
import { sql, SQLDialect } from '@codemirror/lang-sql';
import { Flex, Group, Paper, Text, useMantineColorScheme } from '@mantine/core';
import CodeMirror, {
  Compartment,
  EditorView,
  keymap,
  Prec,
  ReactCodeMirrorRef,
} from '@uiw/react-codemirror';

type SQLInlineEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
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

export default function SQLEditor({
  onChange,
  placeholder,
  value,
}: SQLInlineEditorProps) {
  const { colorScheme } = useMantineColorScheme();
  const ref = useRef<ReactCodeMirrorRef>(null);

  const compartmentRef = useRef<Compartment>(new Compartment());

  return (
    <Paper
      flex="auto"
      shadow="none"
      style={{
        bg: 'var(--color-bg-field)',
        display: 'flex',
        alignItems: 'center',
      }}
      ps="4px"
    >
      <div style={{ width: '100%' }}>
        <CodeMirror
          indentWithTab={false}
          ref={ref}
          value={value}
          onChange={onChange}
          theme={colorScheme === 'dark' ? 'dark' : 'light'}
          minHeight={'100px'}
          extensions={[
            styleTheme,
            // eslint-disable-next-line react-hooks/refs
            compartmentRef.current.of(
              sql({
                upperCaseKeywords: true,
              }),
            ),
          ]}
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
    </Paper>
  );
}

export function SQLEditorControlled({
  placeholder,
  ...props
}: Omit<SQLInlineEditorProps, 'value' | 'onChange'> & UseControllerProps<any>) {
  const { field } = useController(props);

  return (
    <SQLEditor
      onChange={field.onChange}
      placeholder={placeholder}
      value={field.value}
      {...props}
    />
  );
}
