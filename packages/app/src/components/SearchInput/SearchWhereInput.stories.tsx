import React from 'react';
import { useForm } from 'react-hook-form';
import { Stack } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import SearchWhereInput from './SearchWhereInput';

export default {
  title: 'Components/SearchWhereInput',
  component: SearchWhereInput,
};

const queryClient = new QueryClient();

// Mock table connection for stories
const mockTableConnection = {
  databaseName: 'default',
  tableName: 'otel_logs',
  connectionId: 'default',
};

function SearchWhereInputWrapper({
  defaultLanguage = 'lucene',
  width,
  showLabel,
  allowMultiline,
}: {
  defaultLanguage?: 'sql' | 'lucene';
  width?: string;
  showLabel?: boolean;
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
          tableConnection={mockTableConnection}
          control={control}
          name="where"
          enableHotkey
          width={width}
          showLabel={showLabel}
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

export const NoLabel = () => (
  <SearchWhereInputWrapper defaultLanguage="sql" showLabel={false} />
);
NoLabel.storyName = 'SQL Without Label';

export const NoMultiline = () => (
  <SearchWhereInputWrapper defaultLanguage="sql" allowMultiline={false} />
);
NoMultiline.storyName = 'SQL Without Multiline';
