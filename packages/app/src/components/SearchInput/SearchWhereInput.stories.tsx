import React from 'react';
import { useForm } from 'react-hook-form';
import { SourceKind, TLogSource } from '@hyperdx/common-utils/dist/types';
import { Stack } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import SearchWhereInput from './SearchWhereInput';

export default {
  title: 'Components/SearchWhereInput',
  component: SearchWhereInput,
};

const queryClient = new QueryClient();

const mockSource = {
  id: 'logs',
  name: 'Logs',
  kind: SourceKind.Log,
  connection: 'default',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
} satisfies TLogSource;

function SearchWhereInputWrapper({
  defaultLanguage = 'lucene',
  width,
  allowMultiline,
}: {
  defaultLanguage?: 'sql' | 'lucene';
  width?: string;
  allowMultiline?: boolean;
}) {
  const { control } = useForm({
    defaultValues: {
      where: '',
      whereLanguage: defaultLanguage,
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <Stack gap="md">
        <SearchWhereInput
          source={mockSource}
          control={control}
          name="where"
          enableHotkey
          width={width}
          allowMultiline={allowMultiline}
        />
      </Stack>
    </QueryClientProvider>
  );
}

export const DefaultLucene = () => (
  <SearchWhereInputWrapper defaultLanguage="lucene" />
);
DefaultLucene.storyName = 'Default (Lucene Mode)';

export const SqlMode = () => <SearchWhereInputWrapper defaultLanguage="sql" />;
SqlMode.storyName = 'SQL Mode';

export const CustomWidth = () => (
  <SearchWhereInputWrapper defaultLanguage="sql" width="50%" />
);
CustomWidth.storyName = 'Custom Width (50%)';

export const NoMultiline = () => (
  <SearchWhereInputWrapper defaultLanguage="sql" allowMultiline={false} />
);
NoMultiline.storyName = 'SQL Without Multiline';
