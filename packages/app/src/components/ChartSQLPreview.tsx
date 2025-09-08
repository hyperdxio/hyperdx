import { useState } from 'react';
import CopyToClipboard from 'react-copy-to-clipboard';
import { sql } from '@codemirror/lang-sql';
import { format } from '@hyperdx/common-utils/dist/sqlFormatter';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Button, Paper } from '@mantine/core';
import CodeMirror from '@uiw/react-codemirror';

import { useRenderedSqlChartConfig } from '@/hooks/useChartConfig';

function tryFormat(data?: string) {
  try {
    if (data != null) {
      return format(data);
    }
    return data;
  } catch (_) {
    return data;
  }
}

function CopyButton({ text = '' }: { text?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <CopyToClipboard text={text ?? ''} onCopy={() => setCopied(true)}>
      <Button
        variant={copied ? 'light' : 'outline'}
        color="gray"
        className="position-absolute top-0 end-0"
      >
        {copied ? (
          <i className="bi bi-check-lg me-2" />
        ) : (
          <i className="bi bi-clipboard-fill me-2" />
        )}
        {copied ? 'Copied!' : 'Copy'}
      </Button>
    </CopyToClipboard>
  );
}

export function SQLPreview({
  data,
  formatData = true,
  enableCopy = false,
}: {
  data?: string;
  formatData?: boolean;
  enableCopy?: boolean;
}) {
  const displayed = formatData ? tryFormat(data) : data;

  return (
    <div className="position-relative">
      <CodeMirror
        indentWithTab={false}
        value={displayed}
        theme="dark"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
        extensions={[sql()]}
        editable={false}
      />
      {enableCopy && <CopyButton text={displayed} />}
    </div>
  );
}

// TODO: Support clicking in to view matched events
export default function ChartSQLPreview({
  config,
}: {
  config: ChartConfigWithDateRange;
}) {
  const { data } = useRenderedSqlChartConfig(config);

  return (
    <Paper flex="auto" shadow="none" radius="sm" style={{ overflow: 'hidden' }}>
      <SQLPreview data={data} formatData={false} />
    </Paper>
  );
}
