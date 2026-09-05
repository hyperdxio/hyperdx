import { format } from '@hyperdx/common-utils/dist/sqlFormatter';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';
import { Paper, Text, useMantineColorScheme } from '@mantine/core';
import { keepPreviousData } from '@tanstack/react-query';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';

import PreviewCopyButton from '@/components/PreviewCopyButton';
import { useRenderedSqlChartConfig } from '@/hooks/useChartConfig';
import { clickhouseSql } from '@/utils/codeMirror';

function tryFormat(data?: string) {
  try {
    if (data != null) {
      return format(data);
    }
    return data;
  } catch {
    return data;
  }
}

export function SQLPreview({
  data,
  formatData = true,
  enableCopy = false,
  copyButtonSize = 'md',
  enableLineWrapping = false,
}: {
  data?: string;
  formatData?: boolean;
  enableCopy?: boolean;
  copyButtonSize?: 'xs' | 'md';
  enableLineWrapping?: boolean;
}) {
  const displayed = formatData ? tryFormat(data) : data;
  const { colorScheme } = useMantineColorScheme();

  return (
    <div className="position-relative">
      <CodeMirror
        indentWithTab={false}
        value={displayed}
        theme={colorScheme === 'dark' ? 'dark' : 'light'}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
        extensions={[
          clickhouseSql(),
          ...(enableLineWrapping ? [EditorView.lineWrapping] : []),
        ]}
        editable={false}
      />
      {enableCopy && (
        <PreviewCopyButton text={displayed} size={copyButtonSize} />
      )}
    </div>
  );
}

// TODO: Support clicking in to view matched events
export default function ChartSQLPreview({
  config,
  enableCopy,
}: {
  config: ChartConfigWithOptDateRange;
  enableCopy?: boolean;
}) {
  const { data, error, isLoading } = useRenderedSqlChartConfig(config, {
    // Keep the previously rendered SQL visible while a new one is generated so
    // the preview doesn't flicker when the config changes (e.g. live tail
    // refreshes the dateRange each poll).
    placeholderData: keepPreviousData,
  });

  return (
    <Paper
      flex="auto"
      shadow="none"
      radius="sm"
      style={{ overflow: 'hidden' }}
      p="xs"
      data-testid="chart-sql-preview"
    >
      {data ? (
        // Prefer showing the (possibly placeholder) SQL over the loading state
        // so the preview doesn't flicker when the query re-runs — e.g. live tail
        // refreshes the dateRange each poll, and builder configs briefly report
        // isLoading via the MV-optimization lookup.
        <SQLPreview data={data} formatData={false} enableCopy={enableCopy} />
      ) : isLoading ? (
        <Text className="text-muted" size="xs">
          Loading query preview...
        </Text>
      ) : error ? (
        <Text className="text-danger" size="xs">
          Unable to format query. {error.message}
        </Text>
      ) : (
        <SQLPreview data={data} formatData={false} enableCopy={enableCopy} />
      )}
    </Paper>
  );
}
