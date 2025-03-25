import { sql } from '@codemirror/lang-sql';
import { format } from '@hyperdx/common-utils/dist/sqlFormatter';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Paper } from '@mantine/core';
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

export function SQLPreview({
  data,
  formatData = true,
}: {
  data?: string;
  formatData?: boolean;
}) {
  const displayed = formatData ? tryFormat(data) : data;

  return (
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
