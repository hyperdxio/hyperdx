import { Paper, useMantineColorScheme } from '@mantine/core';
import { PromQLExtension } from '@prometheus-io/codemirror-promql';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';

import PreviewCopyButton from '@/components/PreviewCopyButton';
import { DEFAULT_CODE_MIRROR_BASIC_SETUP } from '@/components/SQLEditor/utils';

// Highlighting only — this editor is never editable, so the extension's
// completion sources never run and it needs none of `PromQLEditor`'s wiring.
const promqlExtension = new PromQLExtension();

/**
 * A read-only view of a PromQL expression: the PromQL analogue of
 * `SQLPreview`, used to show the expression after variable substitution.
 */
export default function PromQLPreview({
  expression,
  enableCopy = true,
}: {
  expression: string;
  enableCopy?: boolean;
}) {
  const { colorScheme } = useMantineColorScheme();

  return (
    <Paper
      flex="auto"
      shadow="none"
      radius="sm"
      style={{ overflow: 'hidden' }}
      p="xs"
      data-testid="chart-promql-preview"
    >
      <div className="position-relative">
        <CodeMirror
          indentWithTab={false}
          value={expression}
          theme={colorScheme === 'dark' ? 'dark' : 'light'}
          basicSetup={DEFAULT_CODE_MIRROR_BASIC_SETUP}
          extensions={[promqlExtension.asExtension(), EditorView.lineWrapping]}
          editable={false}
        />
        {enableCopy && <PreviewCopyButton text={expression} size="xs" />}
      </div>
    </Paper>
  );
}
