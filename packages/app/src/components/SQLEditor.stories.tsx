import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import SQLEditor from './SQLEditor';

const story = {
  title: 'Components/SQLEditor',
  component: SQLEditor,
};
export default story;

export const Default = () => {
  const [value, setValue] = useState('SELECT * FROM users');
  const queryClient = new QueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <SQLEditor
        value={value}
        onChange={setValue}
        placeholder="Type your SQL query..."
      />
    </QueryClientProvider>
  );
};
