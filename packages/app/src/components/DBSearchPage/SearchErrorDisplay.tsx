import { Fragment } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { SearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import { Box, Button, Code, Grid, Paper, Text } from '@mantine/core';
import CodeMirror from '@uiw/react-codemirror';

import { SQLPreview } from '@/components/ChartSQLPreview';
import { Suggestion } from '@/hooks/useSqlSuggestions';

type SearchErrorDisplayProps = {
  chartConfig: SearchChartConfig;
  queryError: Error | ClickHouseQueryError;
  whereSuggestions: Suggestion[] | undefined;
  onAcceptSuggestion: (corrected: string) => void;
};

export function SearchErrorDisplay({
  chartConfig,
  queryError,
  whereSuggestions,
  onAcceptSuggestion,
}: SearchErrorDisplayProps) {
  return (
    <div className="h-100 w-100 px-4 mt-4 align-items-center justify-content-center text-muted overflow-auto">
      {whereSuggestions && whereSuggestions.length > 0 && (
        <Box mb="xl">
          <Text size="lg">
            <b>Query Helper</b>
          </Text>
          <Grid>
            {whereSuggestions.map(s => (
              <Fragment key={s.corrected()}>
                <Grid.Col span={10}>
                  <Text>{s.userMessage('where')}</Text>
                </Grid.Col>
                <Grid.Col span={2}>
                  <Button onClick={() => onAcceptSuggestion(s.corrected())}>
                    Accept
                  </Button>
                </Grid.Col>
              </Fragment>
            ))}
          </Grid>
        </Box>
      )}
      <Box mt="sm">
        <Text my="sm" size="sm">
          Error encountered for query with inputs:
        </Text>
        <Paper
          flex="auto"
          p={'sm'}
          shadow="none"
          radius="sm"
          style={{ overflow: 'hidden' }}
        >
          <Grid>
            <Grid.Col span={2}>
              <Text>SELECT</Text>
            </Grid.Col>
            <Grid.Col span={10}>
              <SQLPreview
                data={`${chartConfig.select as string}`}
                formatData={false}
              />
            </Grid.Col>
            <Grid.Col span={2}>
              <Text>ORDER BY</Text>
            </Grid.Col>
            <Grid.Col span={10}>
              <SQLPreview data={`${chartConfig.orderBy}`} formatData={false} />
            </Grid.Col>
            <Grid.Col span={2}>
              <Text>
                {chartConfig.whereLanguage === 'lucene'
                  ? 'Searched For'
                  : 'WHERE'}
              </Text>
            </Grid.Col>
            <Grid.Col span={10}>
              {chartConfig.whereLanguage === 'lucene' ? (
                <CodeMirror
                  indentWithTab={false}
                  value={chartConfig.where}
                  theme="dark"
                  basicSetup={{
                    lineNumbers: false,
                    foldGutter: false,
                    highlightActiveLine: false,
                    highlightActiveLineGutter: false,
                  }}
                  editable={false}
                />
              ) : (
                <SQLPreview data={`${chartConfig.where}`} />
              )}
            </Grid.Col>
          </Grid>
        </Paper>
      </Box>
      <Box mt="lg">
        <Text my="sm" size="sm">
          Error Message:
        </Text>
        <Code
          block
          style={{
            whiteSpace: 'pre-wrap',
          }}
        >
          {queryError.message}
        </Code>
      </Box>
      {queryError instanceof ClickHouseQueryError && (
        <Box mt="lg">
          <Text my="sm" size="sm">
            Original Query:
          </Text>
          <Code
            block
            style={{
              whiteSpace: 'pre-wrap',
            }}
          >
            <SQLPreview data={queryError.query} formatData enableLineWrapping />
          </Code>
        </Box>
      )}
    </div>
  );
}
