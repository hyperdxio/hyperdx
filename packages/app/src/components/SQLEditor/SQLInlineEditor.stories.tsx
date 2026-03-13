import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import SQLInlineEditor from './SQLInlineEditor';

export default {
  title: 'Components/SQLInlineEditor',
  component: SQLInlineEditor,
};

export const Default = () => {
  const [value, setValue] = useState('SELECT * FROM table');
  const queryClient = new QueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <SQLInlineEditor
        value={value}
        onChange={setValue}
        placeholder="Type your SQL query..."
        label="SQL Query"
      />
    </QueryClientProvider>
  );
};
